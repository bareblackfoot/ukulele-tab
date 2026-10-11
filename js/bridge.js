// Client for the local bridge (bridge/bridge.py) that runs Claude on this PC to transcribe a YouTube video.

const KEY = "uketab.bridge";
// on other devices (iPad) the page reaches the bridge through a Cloudflare tunnel; the PC publishes the
// tunnel's current address in this gist. Through the tunnel only login, records and my library work.
const BACKEND = "https://gist.githubusercontent.com/bareblackfoot/59b3543199621afb77be5116e4c9bbd0/raw/uketab-backend.json";
let remote = null;

export function isRemote() { return !!remote; }

export function bridgeSettings() {
  try {
    return { url: "http://127.0.0.1:47615", token: "", ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch (_) {
    return { url: "http://127.0.0.1:47615", token: "" };
  }
}

export function saveBridgeSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* private mode */ }
}

// connect to the bridge: this PC hands its token to the page (/pair); elsewhere use the tunnel address.
// Returns "local", "remote" or "" (not reachable).
export async function connectBridge() {
  const s = bridgeSettings();
  if (s.token) return "local";
  try {
    const res = await fetch(s.url.replace(/\/$/, "") + "/pair");
    const d = res.ok ? await res.json() : {};
    if (d.token) { saveBridgeSettings({ ...s, token: d.token }); return "local"; }
  } catch (_) { /* not this PC */ }
  try {
    const { url } = await (await fetch(`${BACKEND}?t=${Date.now()}`, { cache: "no-store" })).json();
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url || "")) return "";
    const h = await (await fetch(url + "/health", { cache: "no-store" })).json();
    if (h.remote) { remote = url; return "remote"; }
  } catch (_) { /* PC off or tunnel down */ }
  return "";
}

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const s = bridgeSettings();
  let res;
  try {
    res = await fetch((remote || s.url.replace(/\/$/, "")) + path, {
      method,
      headers: { ...(remote ? {} : { "X-Bridge-Token": s.token }), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(remote ? "집 PC에 연결 못 함. PC가 꺼졌거나 인터넷 연결이 끊겼을 수 있음"
      : "내 PC 연결 프로그램(브리지)에 연결 못 함. PC에서 켜져 있는지, 브라우저가 로컬 네트워크 접근을 막지 않았는지 확인 필요");
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* not json */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `브리지 오류 ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const bridge = {
  health: () => call("/health"),
  jobs: () => call("/jobs"),
  job: (id) => call(`/jobs/${encodeURIComponent(id)}`),
  result: (id) => call(`/jobs/${encodeURIComponent(id)}/result`),
  submit: (req) => call("/jobs", { method: "POST", body: req }),
  cancel: (id) => call(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  // my library needs the owner's login session
  library: (session) => call("/library", { headers: { "X-Session": session || "" } }),
  libraryGet: (file, session) => call(`/library/${encodeURIComponent(file)}`, { headers: { "X-Session": session || "" } }),
  librarySave: (file, score, session) => call("/library", { method: "POST", body: { file, score, session } }),
  post: (path, body) => call(path, { method: "POST", body }),
};
