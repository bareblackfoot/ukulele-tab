"""One-off patch (2026-10-11): requests from the internet are also limited per address, so nobody can
burn this PC's CPU with PIN guesses (each guess costs one PBKDF2 run) or hammer the bridge."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "bridge" / "bridge.py"
s = p.read_text(encoding="utf-8")


def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor x{s.count(old)}: {old[:70]!r}"
    s = s.replace(old, new)


PAIRS = [
    ('''def acc_logout(tok):''', '''_remote_hits = {}   # address -> [times of requests]; login attempts are kept under "login:" + address


def remote_rate_ok(addr, kind="any"):
    """at most 120 requests a minute and 20 login attempts an hour from one internet address"""
    limit, window = (20, 3600) if kind == "login" else (120, 60)
    key = ("login:" if kind == "login" else "") + str(addr or "?")
    now = time.time()
    with _acc_lock:
        hits = [t for t in _remote_hits.get(key, []) if now - t < window]
        if len(hits) >= limit:
            _remote_hits[key] = hits
            return False
        hits.append(now)
        _remote_hits[key] = hits
        if len(_remote_hits) > 5000:
            _remote_hits.clear()
        return True


def acc_logout(tok):'''),
    ('''        if self.remote():
            # from the internet: no token (pairing is only for this PC), only the login-protected parts
            if not self.remote_allowed(path, method):''', '''        if self.remote():
            # from the internet: no token (pairing is only for this PC), only the login-protected parts
            addr = self.headers.get("Cf-Connecting-Ip")
            if not remote_rate_ok(addr) or (path == "/auth/login" and not remote_rate_ok(addr, "login")):
                log(f"remote rate limit: {method} {path} from {addr}")
                self.send(429, {"error": "요청이 너무 많음. 잠시 뒤에 다시 하세요"})
                return False
            if not self.remote_allowed(path, method):'''),
]
for a, b in PAIRS:
    rep(a, b)
p.write_text(s, encoding="utf-8")
print("ok")
