/**
 * 우쿨렐레 코드 악보: 게임 기록 저장 (Google Apps Script 웹 앱)
 *
 * 배포: 배포 → 새 배포 → 유형 «웹 앱», 실행 사용자 «나», 액세스 권한 «모든 사용자».
 * 처음 한 번 편집기에서 setup()을 실행하면 기록용 스프레드시트를 만들고 그 ID를 스크립트 속성에 저장함.
 *
 * 보안
 * - PIN은 저장하지 않음. 사용자마다 다른 소금값(salt)과 HMAC-SHA256을 ITER번 되풀이한 값만 저장함.
 * - 로그인 실패가 5번이면 15분, 하루 15번이면 24시간 그 아이디를 잠금(무작위 대입 방지).
 * - 로그인하면 무작위 토큰을 줌. 시트에는 토큰의 SHA-256만 저장하고 90일 뒤 만료됨.
 * - 요청은 POST 본문(JSON)으로만 받음(주소에 비밀값이 남지 않게). 입력 길이·형식·기록 크기를 제한함.
 * - 가입은 1분에 20번까지만 받음.
 */

var ITER = 2000;
var SESSION_DAYS = 90;
var MAX_RESULTS_PER_USER = 3000;

function doGet() {
  return json_({ ok: true, service: "ukulele-records" });
}

function doPost(e) {
  var out;
  try {
    var body = (e && e.postData && e.postData.contents) || "{}";
    if (body.length > 20000) throw new Error("요청이 너무 큼");
    var req = JSON.parse(body);
    out = route_(req);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  switch (req.action) {
    case "signup": return signup_(req.id, req.pin);
    case "login": return login_(req.id, req.pin);
    case "logout": return logout_(req.token);
    case "me": return { ok: true, id: auth_(req.token) };
    case "save": return save_(req.token, req.results);
    case "list": return list_(req.token);
    case "changePin": return changePin_(req.token, req.oldPin, req.newPin);
    default: throw new Error("모르는 요청");
  }
}

// ---------------------------------------------------------------- storage

function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create("우쿨렐레 악보 게임 기록");
  ensureSheet_(ss, "users", ["id", "salt", "hash", "created", "fails", "failDay", "dayFails", "lockUntil"]);
  ensureSheet_(ss, "sessions", ["tokenHash", "id", "expires"]);
  ensureSheet_(ss, "results", ["id", "time", "song", "json"]);
  props.setProperty("SHEET_ID", ss.getId());
  Logger.log("기록 시트: " + ss.getUrl());
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(header);
  var first = ss.getSheets()[0];
  if (first.getName() === "Sheet1" || first.getName() === "시트1") { if (ss.getSheets().length > 1) ss.deleteSheet(first); }
  return sh;
}

function sheet_(name) {
  var id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (!id) throw new Error("서버 준비가 안 됨 (setup 실행 필요)");
  return SpreadsheetApp.openById(id).getSheetByName(name);
}

function findRow_(sh, col, value) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(value)) return i + 2;
  return -1;
}

// ---------------------------------------------------------------- crypto

function bytes_(s) { return Utilities.newBlob(String(s)).getBytes(); }

function pinHash_(pin, salt) {
  var key = bytes_(salt);
  var h = Utilities.computeHmacSha256Signature(bytes_(pin), key);
  for (var i = 1; i < ITER; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64Encode(h);
}

function sha_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes_(s)));
}

function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function sameString_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------------------------------------------------------------- accounts

function checkId_(id) {
  id = String(id || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(id)) throw new Error("아이디는 영문 소문자·숫자·밑줄 3~20자");
  return id;
}

function checkPin_(pin) {
  pin = String(pin || "");
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN은 숫자 4~8자리");
  if (/^(\d)\1+$/.test(pin) || "0123456789".indexOf(pin) >= 0 || "9876543210".indexOf(pin) >= 0) throw new Error("같은 숫자나 연속 숫자만으로 된 PIN은 쓸 수 없음");
  return pin;
}

function newSession_(id) {
  var token = randomToken_();
  var expires = Date.now() + SESSION_DAYS * 86400000;
  sheet_("sessions").appendRow([sha_(token), id, expires]);
  return token;
}

function signup_(id, pin) {
  id = checkId_(id);
  pin = checkPin_(pin);
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get("signups") || 0);
  if (n >= 20) throw new Error("잠시 뒤에 다시 하세요");
  cache.put("signups", String(n + 1), 60);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var users = sheet_("users");
    if (findRow_(users, 1, id) > 0) throw new Error("이미 있는 아이디");
    var salt = randomToken_();
    users.appendRow([id, salt, pinHash_(pin, salt), new Date().toISOString(), 0, "", 0, 0]);
    return { ok: true, id: id, token: newSession_(id) };
  } finally {
    lock.releaseLock();
  }
}

function login_(id, pin) {
  id = String(id || "").trim().toLowerCase();
  pin = String(pin || "");
  var fail = { ok: false, error: "아이디나 PIN이 맞지 않음" };
  if (!/^[a-z0-9_]{3,20}$/.test(id) || !/^\d{4,8}$/.test(pin)) return fail;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var users = sheet_("users");
    var r = findRow_(users, 1, id);
    if (r < 0) { pinHash_(pin, "x"); return fail; } // same work as a real check, so timing does not tell which ids exist
    var row = users.getRange(r, 1, 1, 8).getValues()[0];
    var now = Date.now();
    if (Number(row[7]) > now) {
      return { ok: false, error: "PIN을 여러 번 틀려서 잠김. " + Math.ceil((Number(row[7]) - now) / 60000) + "분 뒤에 다시 하세요" };
    }
    if (sameString_(pinHash_(pin, row[1]), String(row[2]))) {
      users.getRange(r, 5, 1, 4).setValues([[0, row[5], row[6], 0]]);
      return { ok: true, id: id, token: newSession_(id) };
    }
    var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    var fails = Number(row[4]) + 1;
    var dayFails = (row[5] === today ? Number(row[6]) : 0) + 1;
    var lockUntil = 0;
    if (dayFails >= 15) lockUntil = now + 24 * 3600000;
    else if (fails >= 5) { lockUntil = now + 15 * 60000; fails = 0; }
    users.getRange(r, 5, 1, 4).setValues([[fails, today, dayFails, lockUntil]]);
    return lockUntil ? { ok: false, error: "PIN을 여러 번 틀려서 잠김. 나중에 다시 하세요" } : fail;
  } finally {
    lock.releaseLock();
  }
}

function auth_(token) {
  token = String(token || "");
  if (!/^[0-9a-f]{96}$/.test(token)) throw new Error("다시 로그인하세요");
  var sh = sheet_("sessions");
  var r = findRow_(sh, 1, sha_(token));
  if (r < 0) throw new Error("다시 로그인하세요");
  var row = sh.getRange(r, 1, 1, 3).getValues()[0];
  if (Number(row[2]) < Date.now()) { sh.deleteRow(r); throw new Error("로그인이 만료됨. 다시 로그인하세요"); }
  return String(row[1]);
}

function logout_(token) {
  try {
    var sh = sheet_("sessions");
    var r = findRow_(sh, 1, sha_(String(token || "")));
    if (r > 0) sh.deleteRow(r);
  } catch (e) { /* already gone */ }
  return { ok: true };
}

function changePin_(token, oldPin, newPin) {
  var id = auth_(token);
  newPin = checkPin_(newPin);
  var users = sheet_("users");
  var r = findRow_(users, 1, id);
  var row = users.getRange(r, 1, 1, 3).getValues()[0];
  if (!sameString_(pinHash_(String(oldPin || ""), row[1]), String(row[2]))) throw new Error("지금 PIN이 맞지 않음");
  var salt = randomToken_();
  users.getRange(r, 2, 1, 2).setValues([[salt, pinHash_(newPin, salt)]]);
  return { ok: true };
}

// ---------------------------------------------------------------- results

var FIELDS = ["time", "song", "title", "artist", "mode", "target", "rate", "score", "acc", "tacc", "maxCombo",
  "perfect", "ok", "bad", "miss", "early", "late", "n", "total", "fullCombo"];

function cleanResult_(r) {
  var o = {};
  FIELDS.forEach(function (k) {
    var v = r[k];
    if (typeof v === "number") o[k] = isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
    else if (typeof v === "boolean") o[k] = v;
    else if (v !== undefined && v !== null) o[k] = String(v).slice(0, 120);
  });
  if (!o.song) throw new Error("곡 정보가 없음");
  o.time = Number(r.time) || Date.now();
  return o;
}

function save_(token, results) {
  var id = auth_(token);
  if (!Array.isArray(results) || !results.length || results.length > 50) throw new Error("기록 형식이 아님");
  var rows = results.map(function (r) {
    var c = cleanResult_(r);
    return [id, c.time, c.song, JSON.stringify(c)];
  });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_("results");
    // skip results already stored (same user and time), so a retried upload does not double count
    var have = {};
    var last = sh.getLastRow();
    if (last > 1) {
      sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (v) { if (v[0] === id) have[String(v[1])] = 1; });
    }
    rows = rows.filter(function (row) { return !have[String(row[1])]; });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    return { ok: true, saved: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function list_(token) {
  var id = auth_(token);
  var sh = sheet_("results");
  var last = sh.getLastRow();
  var out = [];
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, 4).getValues();
    for (var i = 0; i < vals.length; i++) if (vals[i][0] === id) { try { out.push(JSON.parse(vals[i][3])); } catch (e) {} }
  }
  out.sort(function (a, b) { return a.time - b.time; });
  if (out.length > MAX_RESULTS_PER_USER) out = out.slice(out.length - MAX_RESULTS_PER_USER);
  return { ok: true, id: id, results: out };
}
