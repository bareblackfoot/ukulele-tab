"""One-off patch (2026-10-11): accounts (ID + PIN) and game records kept by the bridge on this PC,
instead of a separate web server. Files go to a Google Drive folder so they are backed up."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "bridge" / "bridge.py"
s = p.read_text(encoding="utf-8")


def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor x{s.count(old)}: {old[:70]!r}"
    s = s.replace(old, new)


rep('''import argparse
import json''', '''import argparse
import hashlib
import json''')

rep('''# ---------------------------------------------------------------- running Claude''', '''# ---------------------------------------------------------------- accounts and game records
# PINs are never stored: PBKDF2-SHA256 with a per-user salt. Five wrong PINs lock the id for 15 minutes,
# fifteen in a day for 24 hours. Sessions are random tokens; only their SHA-256 is stored, 90 days.

RECORDS = Path(os.environ.get("UKE_RECORDS", r"G:\\내 드라이브\\2.취미생활\\우쿨렐레\\기록"))
PBKDF2_ITER = 200_000
SESSION_DAYS = 90
_acc_lock = threading.Lock()
_signups = []


def _jload(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def _jsave(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _pin_hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), PBKDF2_ITER).hex()


def _check_id(uid):
    uid = str(uid or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{3,20}", uid):
        raise ValueError("아이디는 영문 소문자·숫자·밑줄 3~20자")
    return uid


def _check_pin(pin):
    pin = str(pin or "")
    if not re.fullmatch(r"\\d{4,8}", pin):
        raise ValueError("PIN은 숫자 4~8자리")
    if len(set(pin)) == 1 or pin in "0123456789" or pin in "9876543210":
        raise ValueError("같은 숫자나 연속 숫자만으로 된 PIN은 쓸 수 없음")
    return pin


def _new_session(uid):
    tok = secrets.token_hex(32)
    sessions = _jload(RECORDS / "sessions.json", {})
    now = time.time()
    sessions = {k: v for k, v in sessions.items() if v["expires"] > now}
    sessions[hashlib.sha256(tok.encode()).hexdigest()] = {"id": uid, "expires": now + SESSION_DAYS * 86400}
    _jsave(RECORDS / "sessions.json", sessions)
    return tok


def _auth(tok):
    tok = str(tok or "")
    if not re.fullmatch(r"[0-9a-f]{64}", tok):
        raise PermissionError("다시 로그인하세요")
    sessions = _jload(RECORDS / "sessions.json", {})
    v = sessions.get(hashlib.sha256(tok.encode()).hexdigest())
    if not v or v["expires"] < time.time():
        raise PermissionError("다시 로그인하세요")
    return v["id"]


def acc_signup(uid, pin):
    uid, pin = _check_id(uid), _check_pin(pin)
    with _acc_lock:
        now = time.time()
        _signups[:] = [t for t in _signups if now - t < 60]
        if len(_signups) >= 10:
            raise ValueError("잠시 뒤에 다시 하세요")
        _signups.append(now)
        users = _jload(RECORDS / "users.json", {})
        if uid in users:
            raise ValueError("이미 있는 아이디")
        salt = secrets.token_hex(16)
        users[uid] = {"salt": salt, "hash": _pin_hash(pin, salt), "created": now, "fails": 0, "failDay": "", "dayFails": 0, "lockUntil": 0}
        _jsave(RECORDS / "users.json", users)
        return {"id": uid, "session": _new_session(uid)}


def acc_login(uid, pin):
    uid, pin = str(uid or "").strip().lower(), str(pin or "")
    fail = ValueError("아이디나 PIN이 맞지 않음")
    if not re.fullmatch(r"[a-z0-9_]{3,20}", uid) or not re.fullmatch(r"\\d{4,8}", pin):
        raise fail
    with _acc_lock:
        users = _jload(RECORDS / "users.json", {})
        u = users.get(uid)
        if not u:
            _pin_hash(pin, "00" * 16)  # same work either way, so timing does not tell which ids exist
            raise fail
        now = time.time()
        if u.get("lockUntil", 0) > now:
            raise ValueError(f"PIN을 여러 번 틀려서 잠김. {int((u['lockUntil'] - now) // 60) + 1}분 뒤에 다시 하세요")
        if secrets.compare_digest(_pin_hash(pin, u["salt"]), u["hash"]):
            u.update(fails=0, lockUntil=0)
            _jsave(RECORDS / "users.json", users)
            return {"id": uid, "session": _new_session(uid)}
        today = time.strftime("%Y-%m-%d")
        u["dayFails"] = (u.get("dayFails", 0) if u.get("failDay") == today else 0) + 1
        u["failDay"] = today
        u["fails"] = u.get("fails", 0) + 1
        if u["dayFails"] >= 15:
            u["lockUntil"] = now + 24 * 3600
        elif u["fails"] >= 5:
            u["lockUntil"] = now + 15 * 60
            u["fails"] = 0
        _jsave(RECORDS / "users.json", users)
        log(f"login failed for {uid} (today {u['dayFails']})")
        if u.get("lockUntil", 0) > now:
            raise ValueError("PIN을 여러 번 틀려서 잠김. 나중에 다시 하세요")
        raise fail


def acc_logout(tok):
    with _acc_lock:
        sessions = _jload(RECORDS / "sessions.json", {})
        sessions.pop(hashlib.sha256(str(tok or "").encode()).hexdigest(), None)
        _jsave(RECORDS / "sessions.json", sessions)


def acc_change_pin(tok, old, new):
    uid = _auth(tok)
    new = _check_pin(new)
    with _acc_lock:
        users = _jload(RECORDS / "users.json", {})
        u = users[uid]
        if not secrets.compare_digest(_pin_hash(str(old or ""), u["salt"]), u["hash"]):
            raise ValueError("지금 PIN이 맞지 않음")
        u["salt"] = secrets.token_hex(16)
        u["hash"] = _pin_hash(new, u["salt"])
        _jsave(RECORDS / "users.json", users)


RESULT_FIELDS = ["time", "song", "title", "artist", "mode", "target", "rate", "score", "acc", "tacc", "maxCombo",
                 "perfect", "ok", "bad", "miss", "early", "late", "n", "total", "fullCombo"]


def rec_save(tok, results):
    uid = _auth(tok)
    if not isinstance(results, list) or not results or len(results) > 50:
        raise ValueError("기록 형식이 아님")
    clean = []
    for r in results:
        if not isinstance(r, dict) or not r.get("song"):
            continue
        o = {}
        for k in RESULT_FIELDS:
            v = r.get(k)
            if isinstance(v, bool):
                o[k] = v
            elif isinstance(v, (int, float)):
                o[k] = round(float(v), 3)
            elif v is not None:
                o[k] = str(v)[:120]
        clean.append(o)
    with _acc_lock:
        path = RECORDS / "results" / f"{uid}.json"
        have = _jload(path, [])
        seen = {(x.get("time"), x.get("song")) for x in have}
        new = [x for x in clean if (x.get("time"), x.get("song")) not in seen]
        _jsave(path, (have + new)[-5000:])
    return len(new)


def rec_list(tok):
    uid = _auth(tok)
    return uid, _jload(RECORDS / "results" / f"{uid}.json", [])


# ---------------------------------------------------------------- running Claude''')

rep('''        if path == "/library":
            if n > 5_000_000:''', '''        if path.startswith("/auth/") or path.startswith("/records/"):
            if n > 200_000:
                return self.send(413, {"error": "요청이 너무 큼"})
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
                if path == "/auth/signup":
                    return self.send(200, acc_signup(body.get("id"), body.get("pin")))
                if path == "/auth/login":
                    return self.send(200, acc_login(body.get("id"), body.get("pin")))
                if path == "/auth/logout":
                    acc_logout(body.get("session"))
                    return self.send(200, {"ok": True})
                if path == "/auth/pin":
                    acc_change_pin(body.get("session"), body.get("oldPin"), body.get("newPin"))
                    return self.send(200, {"ok": True})
                if path == "/records/save":
                    return self.send(200, {"saved": rec_save(body.get("session"), body.get("results"))})
                if path == "/records/list":
                    uid, res = rec_list(body.get("session"))
                    return self.send(200, {"id": uid, "results": res})
                return self.send(404, {"error": "없는 주소"})
            except PermissionError as e:
                return self.send(401, {"error": str(e), "relogin": True})
            except (ValueError, KeyError, OSError) as e:
                return self.send(400, {"error": str(e)})
        if path == "/library":
            if n > 5_000_000:''')

p.write_text(s, encoding="utf-8")
print("ok")
