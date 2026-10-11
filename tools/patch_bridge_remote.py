"""One-off patch (2026-10-11): requests that arrive through the Cloudflare tunnel (iPad etc.) may only log in,
read/save records and use my library with the owner's session. No token pairing, no jobs, no sign-up from outside."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "bridge" / "bridge.py"
s = p.read_text(encoding="utf-8")


def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor x{s.count(old)}: {old[:70]!r}"
    s = s.replace(old, new)


PAIRS = [('''    def origin_ok(self):''', '''    # requests that came through the Cloudflare tunnel carry its headers; everything else is from this PC
    REMOTE_GET = ("/library", "/health")
    REMOTE_POST = ("/auth/login", "/auth/logout", "/auth/pin", "/records/save", "/records/list", "/library")

    def remote(self):
        return bool(self.headers.get("Cf-Ray") or self.headers.get("Cf-Connecting-Ip"))

    def remote_allowed(self, path, method):
        allowed = self.REMOTE_GET if method == "GET" else self.REMOTE_POST
        return any(path == a or (a == "/library" and path.startswith("/library/")) for a in allowed)

    def origin_ok(self):'''),
    ('''    def authorized(self):
        if not self.origin_ok():
            self.send(403, {"error": "허용되지 않은 페이지에서 온 요청"})
            return False
        if not secrets.compare_digest(self.headers.get("X-Bridge-Token", ""), token()):''', '''    def authorized(self, path="", method="GET"):
        if not self.origin_ok():
            self.send(403, {"error": "허용되지 않은 페이지에서 온 요청"})
            return False
        if self.remote():
            # from the internet: no token (pairing is only for this PC), only the login-protected parts
            if not self.remote_allowed(path, method):
                log(f"remote request refused: {method} {path} from {self.headers.get('Cf-Connecting-Ip')}")
                self.send(403, {"error": "밖에서는 로그인·기록·내 악보만 쓸 수 있음"})
                return False
            return True
        if not secrets.compare_digest(self.headers.get("X-Bridge-Token", ""), token()):'''),
    ('''            o = self.headers.get("Origin")
            if not o or not ALLOWED_ORIGIN.match(o):
                return self.send(403, {"error": "허용되지 않은 페이지에서 온 요청"})
            log(f"paired page {o}")''', '''            o = self.headers.get("Origin")
            if self.remote() or not o or not ALLOWED_ORIGIN.match(o):
                return self.send(403, {"error": "허용되지 않은 페이지에서 온 요청"})
            log(f"paired page {o}")'''),
    ('''            log(f"paired page {o}")
            return self.send(200, {"token": token(), "version": VERSION})
        if not self.authorized():
            return''', '''            log(f"paired page {o}")
            return self.send(200, {"token": token(), "version": VERSION})
        if not self.authorized(path, "GET"):
            return
        if self.remote() and path == "/health":
            return self.send(200, {"ok": True, "remote": True})'''),
    ('''    def do_POST(self):
        if not self.authorized():
            return
        path = self.path.split("?")[0].rstrip("/")''', '''    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        if not self.authorized(path, "POST"):
            return'''),
]
for a, b in PAIRS:
    rep(a, b)
p.write_text(s, encoding="utf-8")
print("ok")
