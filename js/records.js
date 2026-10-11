// Game results: kept in this browser, and under the logged-in account on this PC (the bridge stores them in
// a Google Drive folder). Results made before logging in are uploaded once after login.

import { bridge, bridgeSettings, isRemote } from "./bridge.js";

const LOCAL = "uketab.records";
const SESSION = "uketab.session";
const PENDING = "uketab.records.pending";

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* blocked */ } },
};

async function post(path, body) {
  try {
    return await bridge.post(path, body);
  } catch (err) {
    if (err.status === 401 && body.session) store.del(SESSION);
    throw err;
  }
}

export const records = {
  session() { return store.get(SESSION, null); },
  // accounts live on this PC, so they need the connection to the bridge (directly or through the tunnel)
  available() { return !!bridgeSettings().token || isRemote(); },

  local() { return store.get(LOCAL, []); },

  async signup(id, pin) {
    const d = await post("/auth/signup", { id, pin });
    store.set(SESSION, { id: d.id, session: d.session });
    await this.flush();
    return d.id;
  },
  async login(id, pin) {
    const d = await post("/auth/login", { id, pin });
    store.set(SESSION, { id: d.id, session: d.session });
    await this.flush();
    return d.id;
  },
  async logout() {
    const s = this.session();
    store.del(SESSION);
    if (s) { try { await post("/auth/logout", { session: s.session }); } catch (_) { /* gone locally anyway */ } }
  },
  async changePin(oldPin, newPin) {
    const s = this.session();
    if (!s) throw new Error("로그인 필요");
    await post("/auth/pin", { session: s.session, oldPin, newPin });
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
    if (!s || !pending.length) return;
    for (let i = 0; i < pending.length; i += 50) {
      await post("/records/save", { session: s.session, results: pending.slice(i, i + 50) });
    }
    store.set(PENDING, []);
  },

  // everything for the dashboard: the account's results when logged in, merged with this browser's
  async all() {
    const local = this.local();
    const s = this.session();
    if (!s) return { results: local, source: "browser" };
    try {
      const d = await post("/records/list", { session: s.session });
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
