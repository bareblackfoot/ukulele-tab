"""Opens this PC's bridge to the internet so the page works on other devices (iPad etc.).

Runs a Cloudflare quick tunnel (no account; the address changes on every start) to 127.0.0.1:47615 and
publishes the address in a public GitHub gist, which the page reads when it cannot reach the bridge directly.
The bridge itself only lets tunnel requests log in, save/read records and open my library (see Handler.remote).

Started by the scheduled task \\NuRILab\\Ukulele-Tunnel at logon and every 10 minutes; a second copy exits at
once. Log: logs/tunnel.log (appended). While the tunnel is down, logs/TUNNEL_FAILURE.txt says why.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOGS = HERE / "logs"
STATE_DIR = HERE / "state"
URL_FILE = STATE_DIR / "tunnel_url.txt"
FAIL_FILE = LOGS / "TUNNEL_FAILURE.txt"
PORT = int(os.environ.get("UKE_BRIDGE_PORT", "47615"))
LOCK_PORT = PORT + 2   # held while this script runs, so only one copy keeps a tunnel
GIST = "59b3543199621afb77be5116e4c9bbd0"
GIST_FILE = "uketab-backend.json"
CLOUDFLARED = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages" / \
    "Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe" / "cloudflared.exe"
GH = shutil.which("gh") or r"C:\Program Files\GitHub CLI\gh.exe"
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

LOGS.mkdir(parents=True, exist_ok=True)
STATE_DIR.mkdir(parents=True, exist_ok=True)


def log(msg):
    p = LOGS / "tunnel.log"
    with open(p, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    if p.stat().st_size > 1_000_000:   # keep the newest half
        p.write_bytes(p.read_bytes()[-500_000:])


def mark_failure(msg):
    FAIL_FILE.write_text(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n", encoding="utf-8")


def clear_failure():
    FAIL_FILE.unlink(missing_ok=True)


def publish(url):
    """write the tunnel address into the gist; True when GitHub accepted it"""
    body = {"files": {GIST_FILE: {"content": json.dumps({"url": url, "updated": int(time.time())}) + "\n"}}}
    tmp = STATE_DIR / "gist_patch.json"
    tmp.write_text(json.dumps(body), encoding="utf-8")
    for attempt in range(3):
        r = subprocess.run([GH, "api", "-X", "PATCH", f"gists/{GIST}", "--input", str(tmp)],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
        if r.returncode == 0:
            return True
        log(f"gist update failed (try {attempt + 1}): {(r.stderr or r.stdout).strip()[:300]}")
        time.sleep(10 * (attempt + 1))
    return False


def resolve(host):
    """look the name up at Cloudflare's DNS over HTTPS: Windows keeps a "no such name" answer for minutes,
    and the first lookup of a fresh tunnel name often comes before the name exists"""
    try:
        req = urllib.request.Request(f"https://cloudflare-dns.com/dns-query?name={host}&type=A",
                                     headers={"Accept": "application/dns-json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return [a["data"] for a in json.loads(r.read().decode("utf-8")).get("Answer", []) if a.get("type") == 1]
    except Exception:
        return []


last_check = {"why": ""}


def reachable(url):
    """the bridge answers through the tunnel (Cloudflare adds Cf-Ray, so the bridge sees a remote request)"""
    host = url.split("//", 1)[1]
    ips = resolve(host)
    if not ips:
        last_check["why"] = "DNS에 아직 없음"
        return False
    r = subprocess.run(["curl.exe", "-s", "--max-time", "20", "--resolve", f"{host}:443:{ips[0]}", url + "/health"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    try:
        ok = json.loads(r.stdout).get("remote") is True
    except ValueError:
        ok = False
    last_check["why"] = "" if ok else f"curl {r.returncode}: {(r.stdout or r.stderr).strip()[:120]}"
    return ok


def run_once():
    """start cloudflared, publish its address, watch it; returns when the tunnel is gone"""
    if not CLOUDFLARED.exists():
        mark_failure(f"cloudflared 없음: {CLOUDFLARED}")
        log(f"cloudflared not found at {CLOUDFLARED}")
        return
    proc = subprocess.Popen([str(CLOUDFLARED), "tunnel", "--url", f"http://127.0.0.1:{PORT}", "--protocol", "http2",
                             "--no-autoupdate"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            encoding="utf-8", errors="replace", creationflags=NOWIN)
    found = {"url": None}
    tail = []

    def read():
        for line in proc.stdout:
            tail.append(line.rstrip())
            del tail[:-20]
            m = URL_RE.search(line)
            if m and not found["url"]:
                found["url"] = m.group(0)

    threading.Thread(target=read, daemon=True).start()
    t0 = time.time()
    while not found["url"] and proc.poll() is None and time.time() - t0 < 90:
        time.sleep(1)
    url = found["url"]
    if not url:
        mark_failure("터널 주소를 못 받음: " + " / ".join(tail[-3:]))
        log("no tunnel address; cloudflared said: " + " | ".join(tail[-5:]))
        proc.kill()
        return
    log(f"tunnel address {url}, checking it")
    # the address answers only after the edge has registered it; give it two minutes
    ok = False
    for _ in range(24):
        time.sleep(5)
        if reachable(url):
            ok = True
            break
    if not ok:
        mark_failure(f"터널 주소 {url} 로 브리지에 안 닿음 (브리지가 꺼졌을 수 있음)")
        log(f"{url} does not reach the bridge ({last_check['why']})")
        proc.kill()
        return
    if not publish(url):
        mark_failure("gist에 주소를 못 올림 (gh 로그인 확인)")
        proc.kill()
        return
    URL_FILE.write_text(url + "\n", encoding="utf-8")
    clear_failure()
    log(f"tunnel up: {url}")
    misses = 0
    while proc.poll() is None:
        time.sleep(60)
        if reachable(url):
            misses = 0
            continue
        misses += 1
        if misses >= 3:   # cloudflared can stay alive while the edge has dropped the tunnel
            log(f"{url} stopped answering, restarting the tunnel")
            proc.kill()
            break
    mark_failure(f"터널이 끊김 ({url}), 다시 여는 중")
    log(f"tunnel ended (exit {proc.poll()}): " + " | ".join(tail[-3:]))
    URL_FILE.unlink(missing_ok=True)
    publish("")


def main():
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", LOCK_PORT))
    except OSError:
        return   # another copy keeps the tunnel
    log("tunnel keeper started")
    # a cloudflared left behind by a keeper that was killed would keep an unpublished tunnel open
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | "
                    f"Where-Object {{ $_.CommandLine -like '*127.0.0.1:{PORT}*' }} | "
                    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], capture_output=True, creationflags=NOWIN)
    fails = 0
    while True:
        t0 = time.time()
        run_once()
        fails = fails + 1 if time.time() - t0 < 300 else 0
        time.sleep(min(600, 15 * 2 ** min(fails, 5)))   # back off when it fails at once, again and again


if __name__ == "__main__":
    if sys.stdout:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    main()
