// Game results: kept in this browser, and under the logged-in account on this PC (the bridge stores them in
// a Google Drive folder). Results made before logging in are uploaded once after login.

import { bridge, bridgeSettings, isRemote } from "./bridge.js";
import { INST, skey } from "./instrument.js";

// results stay apart per instrument (inst field); the login is shared by the ukulele, guitar and otamatone sites
const LOCAL = skey("records");
const SESSION = "uketab.session";
const PENDING = skey("records.pending");
const mine = (r) => (r.inst || "ukulele") === INST.id;

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

  // keep a result; returns the previous best score (out of 100) for the same song, judging setup and speed
  // (or null): scores are compared only like for like, as rhythm games rank each chart and difficulty apart
  add(r) {
    r = { ...r, inst: INST.id };
    const all = this.local();
    const same = all.filter((x) => x.song === r.song && x.target === r.target && x.mode === r.mode && (x.judge || "") === (r.judge || "")
      && (x.rate || 1) === (r.rate || 1));
    const prevBest = same.length ? Math.max(...same.map(pointsOf)) : null;
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
    const local = this.local().filter(mine);
    const s = this.session();
    if (!s) return { results: local, source: "browser" };
    try {
      const d = await post("/records/list", { session: s.session });
      const theirs = d.results.filter(mine);
      const seen = new Set(theirs.map((r) => `${r.time}|${r.song}`));
      const merged = theirs.concat(local.filter((r) => !seen.has(`${r.time}|${r.song}`)));
      merged.sort((a, b) => a.time - b.time);
      return { results: merged, source: "account" };
    } catch (err) {
      return { results: local, source: "browser", error: err.message };
    }
  },
};

export function rankOf(pts) {
  return pts >= 95 ? "S" : pts >= 85 ? "A" : pts >= 70 ? "B" : pts >= 50 ? "C" : "D";
}

// The score out of 100, the way rhythm games score a chart for ranking (osu!mania's accuracy, IIDX's EX score,
// SOUND VOLTEX's 10,000,000): each note of the song weighs the same, Perfect 1, Ok 2/3, Bad 1/3, Miss 0, and
// notes never played count 0, so a song stopped halfway cannot beat one played through. Results saved before
// it (an unbounded sum) get it from their accuracy and the share of notes judged.
export function pointsOf(r) {
  if (r.pts !== undefined && r.pts !== null) return r.pts;
  const share = r.total ? Math.min(1, (r.n || 0) / r.total) : 1;
  return Math.round((r.acc || 0) * share * 100) / 100;
}

export const pointsText = (v) => (Math.round(v * 10) / 10).toFixed(1);
