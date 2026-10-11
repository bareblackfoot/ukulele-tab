// Game results: kept in this browser, and in the user's account when logged in (Apps Script web app).
// Results made before logging in are uploaded once after login.

// address of the deployed Apps Script web app (backend/apps-script/Code.gs); empty until it is deployed
export const API_URL = "";

const LOCAL = "uketab.records";
const SESSION = "uketab.session";
const PENDING = "uketab.records.pending";

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* blocked */ } },
};

async function api(body) {
  if (!API_URL) throw new Error("기록 서버가 아직 설정되지 않음");
  let res;
  try {
    // text/plain keeps this a simple request (no CORS preflight), which Apps Script web apps need
    res = await fetch(API_URL, { method: "POST", body: JSON.stringify(body) });
  } catch (_) {
    throw new Error("기록 서버에 연결하지 못함");
  }
  const data = await res.json().catch(() => ({ ok: false, error: "서버 응답을 읽지 못함" }));
  if (!data.ok) {
    if (/로그인/.test(data.error || "") && body.token) store.del(SESSION);
    throw new Error(data.error || "기록 서버 오류");
  }
  return data;
}

export const records = {
  session() { return store.get(SESSION, null); },
  available() { return !!API_URL; },

  local() { return store.get(LOCAL, []); },

  async signup(id, pin) {
    const d = await api({ action: "signup", id, pin });
    store.set(SESSION, { id: d.id, token: d.token });
    await this.flush();
    return d.id;
  },
  async login(id, pin) {
    const d = await api({ action: "login", id, pin });
    store.set(SESSION, { id: d.id, token: d.token });
    await this.flush();
    return d.id;
  },
  async logout() {
    const s = this.session();
    store.del(SESSION);
    if (s) { try { await api({ action: "logout", token: s.token }); } catch (_) { /* token is gone locally anyway */ } }
  },
  async changePin(oldPin, newPin) {
    const s = this.session();
    if (!s) throw new Error("로그인 필요");
    await api({ action: "changePin", token: s.token, oldPin, newPin });
  },

  // keep a result; returns the previous best score for the same song and judging setup (or null)
  add(r) {
    const all = this.local();
    const same = all.filter((x) => x.song === r.song && x.target === r.target && x.mode === r.mode);
    const prevBest = same.length ? Math.max(...same.map((x) => x.score)) : null;
    all.push(r);
    store.set(LOCAL, all.slice(-2000));
    const pending = store.get(PENDING, []);
    pending.push(r);
    store.set(PENDING, pending.slice(-200));
    this.flush().catch(() => { /* stays pending; uploaded next time */ });
    return prevBest;
  },

  // upload results that are only in this browser
  async flush() {
    const s = this.session();
    const pending = store.get(PENDING, []);
    if (!s || !pending.length || !API_URL) return;
    for (let i = 0; i < pending.length; i += 50) {
      await api({ action: "save", token: s.token, results: pending.slice(i, i + 50) });
    }
    store.set(PENDING, []);
  },

  // everything for the dashboard: the account's results when logged in, merged with this browser's
  async all() {
    const local = this.local();
    const s = this.session();
    if (!s || !API_URL) return { results: local, source: "browser" };
    try {
      const d = await api({ action: "list", token: s.token });
      const seen = new Set(d.results.map((r) => `${r.time}|${r.song}`));
      const merged = d.results.concat(local.filter((r) => !seen.has(`${r.time}|${r.song}`)));
      merged.sort((a, b) => a.time - b.time);
      return { results: merged, source: "account" };
    } catch (err) {
      return { results: local, source: "browser", error: err.message };
    }
  },
};

export function rankOf(acc) {
  return acc >= 95 ? "S" : acc >= 85 ? "A" : acc >= 70 ? "B" : acc >= 50 ? "C" : "D";
}
