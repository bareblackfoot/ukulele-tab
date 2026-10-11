"""Transcribe one YouTube video into an ukulele-transcription JSON (runs on this PC, uses the nurilab GPU).

    python D:/codes/ukulele-tab/bridge/transcribe.py --video <11-char id> --job <job dir> [--lang ko] [--no-lyrics] [--no-inst]

Steps: yt-dlp audio -> wav -> upload to nurilab -> server/run.sh (separation, beats, pitch, chords, lyrics)
-> download transcription.json, asr.json, report.json -> <job>/result.json.
Prints one progress line per step. Exit code 0 only when result.json was written.
Only the standard library is used so it runs with any Python 3.9+.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
USER = Path(os.environ.get("USERPROFILE", str(Path.home())))
SSH_CONFIG = str(USER / ".ssh" / "config")
HOST = os.environ.get("UKE_SERVER", "nurilab")
REMOTE_DIR = "ukulele_transcribe"
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


PROGRESS = None  # <job>/progress.log, read by the bridge while this script runs


def say(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    if PROGRESS:
        with open(PROGRESS, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def tool(name, extra=()):
    p = shutil.which(name)
    if p:
        return p
    for pat in extra:
        hits = glob.glob(os.path.expandvars(pat))
        if hits:
            return hits[0]
    raise SystemExit(f"{name}을(를) 못 찾음")


def run(cmd, timeout=None, check=True, capture=False):
    r = subprocess.run(cmd, capture_output=capture, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout, creationflags=NOWIN)
    if check and r.returncode != 0:
        tail = ((r.stderr or "") + (r.stdout or ""))[-800:] if capture else ""
        raise SystemExit(f"명령 실패 ({r.returncode}): {' '.join(map(str, cmd[:3]))} ... {tail}")
    return r


def ssh(cmd, timeout=None, stream=False):
    base = ["ssh", "-F", SSH_CONFIG, "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", HOST, cmd]
    if not stream:
        return run(base, timeout=timeout, capture=True)
    p = subprocess.Popen(base, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                         errors="replace", creationflags=NOWIN)
    for line in p.stdout:
        line = line.rstrip()
        if not line or "Permanently added" in line or "Warning" in line or "warn(" in line or line.startswith("  "):
            continue
        say("서버: " + line)
    p.wait(timeout=timeout)
    if p.returncode != 0:
        raise SystemExit(f"서버 분석 실패 (종료 코드 {p.returncode})")


def scp(src, dst, timeout=600):
    run(["scp", "-F", SSH_CONFIG, "-o", "BatchMode=yes", "-q", src, dst], timeout=timeout, capture=True)


def sync_server_scripts():
    """Copy server/*.py|*.sh to the server with LF line endings (git on Windows may have turned them into CRLF)."""
    tmp = HERE / "logs" / "server_upload"
    tmp.mkdir(parents=True, exist_ok=True)
    files = []
    for f in (HERE / "server").glob("*"):
        if f.suffix in (".py", ".sh"):
            (tmp / f.name).write_bytes(f.read_bytes().replace(b"\r\n", b"\n"))
            files.append(str(tmp / f.name))
    ssh(f"mkdir -p ~/{REMOTE_DIR}/jobs", timeout=60)
    run(["scp", "-F", SSH_CONFIG, "-o", "BatchMode=yes", "-q", *files, f"{HOST}:{REMOTE_DIR}/"], timeout=120, capture=True)
    ssh(f"chmod +x ~/{REMOTE_DIR}/*.sh", timeout=60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--job", required=True)
    ap.add_argument("--lang", default="")
    ap.add_argument("--tuning", default="standard", choices=["standard", "low-g"])
    ap.add_argument("--no-lyrics", action="store_true")
    ap.add_argument("--no-inst", action="store_true")
    ap.add_argument("--reuse-audio", action="store_true", help="keep audio.wav from an earlier run of this job")
    ap.add_argument("--grid", default=None, help="beat grid JSON (stepsPerBeat, tempo, meter, columnCount, offsetMs) to use instead of beat tracking")
    args = ap.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", args.video):
        raise SystemExit("영상 ID 형식이 아님")
    if args.lang and not re.fullmatch(r"[a-z]{2}", args.lang):
        raise SystemExit("언어 코드 형식이 아님")
    job = Path(args.job).resolve()
    job.mkdir(parents=True, exist_ok=True)
    global PROGRESS
    PROGRESS = job / "progress.log"
    jid = job.name
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", jid):
        raise SystemExit("작업 폴더 이름 형식이 아님")
    url = f"https://www.youtube.com/watch?v={args.video}"
    wav = job / "audio.wav"

    # 1. audio and title
    ytdlp = tool("yt-dlp", [r"%USERPROFILE%\miniconda3\Scripts\yt-dlp.exe", r"%USERPROFILE%\anaconda3\Scripts\yt-dlp.exe"])
    ffmpeg = tool("ffmpeg", [r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin\ffmpeg.exe"])
    # YouTube needs a JavaScript runtime for some videos (HTTP 403 without one); yt-dlp only looks for deno by default
    node = shutil.which("node") or (r"C:\Program Files\nodejs\node.exe" if Path(r"C:\Program Files\nodejs\node.exe").exists() else None)
    js = ["--js-runtimes", f"node:{node}"] if node else []
    meta = {}
    r = run([ytdlp, *js, "--no-playlist", "--skip-download", "--dump-json", url], timeout=120, capture=True, check=False)
    if r.returncode == 0:
        try:
            d = json.loads(r.stdout.strip().splitlines()[-1])
            meta = {"title": d.get("track") or d.get("title") or "", "artist": d.get("artist") or d.get("creator") or d.get("channel") or "",
                    "videoTitle": d.get("title") or "", "channel": d.get("channel") or "", "duration": d.get("duration")}
        except Exception:
            pass
    if (meta.get("duration") or 0) > 15 * 60:
        raise SystemExit(f"영상이 너무 김 ({meta['duration']}초). 15분 넘는 영상은 받지 않음")
    say(f"영상: {meta.get('videoTitle') or args.video} ({meta.get('duration') or '?'}초)")
    if not (args.reuse_audio and wav.exists()):
        for f in job.glob("dl.*"):
            f.unlink()
        last_err = None
        # some videos answer HTTP 403 to the default player client but not to the mobile web one
        for extra in ([], ["--extractor-args", "youtube:player_client=mweb"]):
            try:
                run([ytdlp, *js, *extra, "--no-playlist", "-f", "bestaudio/best", "-o", str(job / "dl.%(ext)s"),
                     "--ffmpeg-location", str(Path(ffmpeg).parent), url], timeout=900, capture=True)
                last_err = None
                break
            except SystemExit as e:  # try the other format once (some videos refuse one of them with HTTP 403)
                last_err = e
                say("오디오 받기 실패, 다른 형식으로 다시 받음")
                for f in job.glob("dl.*"):
                    f.unlink()
        if last_err:
            raise last_err
        src = next(iter(job.glob("dl.*")), None)
        if not src:
            raise SystemExit("오디오를 못 받음")
        run([ffmpeg, "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(wav)], timeout=600, capture=True)
        src.unlink()
    say(f"오디오 받음 ({wav.stat().st_size // 1024 // 1024} MB)")

    # 2. server analysis
    sync_server_scripts()
    ssh(f"mkdir -p ~/{REMOTE_DIR}/jobs/{jid}", timeout=60)
    scp(str(wav), f"{HOST}:{REMOTE_DIR}/jobs/{jid}/audio.wav")
    say("서버로 올림, 분석 시작")
    opts = []
    if args.lang:
        opts += ["--lang", args.lang]
    if args.no_lyrics:
        opts.append("--no-lyrics")
    if args.no_inst:
        opts.append("--no-inst")
    if args.grid:
        # use a score's own beat grid (SPRED) so chords and lyrics land on its columns
        scp(str(Path(args.grid).resolve()), f"{HOST}:{REMOTE_DIR}/jobs/{jid}/grid.json")
        opts += ["--grid", f"jobs/{jid}/grid.json"]
    ssh(f"cd ~/{REMOTE_DIR} && ./run.sh --job jobs/{jid} {' '.join(opts)}", timeout=3600, stream=True)
    for name in ("transcription.json", "asr.json", "report.json"):
        scp(f"{HOST}:{REMOTE_DIR}/jobs/{jid}/{name}", str(job / name), timeout=120)
    ssh(f"rm -f ~/{REMOTE_DIR}/jobs/{jid}/audio.wav", timeout=60)

    # 3. result
    t = json.loads((job / "transcription.json").read_text(encoding="utf-8"))
    t["meta"] = {**t.get("meta", {}), "title": meta.get("title") or meta.get("videoTitle") or args.video,
                 "artist": meta.get("artist", ""), "source": f"YouTube {args.video} 자동 채보"}
    t["youtube"] = {"videoId": args.video, "offsetMs": t.get("youtube", {}).get("offsetMs", 0)}
    t["tuning"] = args.tuning
    (job / "result.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
    rep = json.loads((job / "report.json").read_text(encoding="utf-8"))
    say("결과 저장: result.json")
    say("요약: " + json.dumps({"tempo": rep["tempo"], "chords": rep["chords"]["changes"], "melody_notes": rep["melody"]["notes"],
                               "lyrics": rep["lyrics"].get("syllables"), "warnings": rep["warnings"]}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except subprocess.TimeoutExpired as e:
        say(f"시간 초과: {e.cmd[0] if e.cmd else ''}")
        sys.exit(2)
    except SystemExit as e:
        if e.code not in (None, 0):
            say(f"실패: {e.code}")
            sys.exit(1)
