// Client for the local bridge (bridge/bridge.py) that runs Claude on this PC to transcribe a YouTube video.

const KEY = "uketab.bridge";

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

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const s = bridgeSettings();
  let res;
  try {
    res = await fetch(s.url.replace(/\/$/, "") + path, {
      method,
      headers: { "X-Bridge-Token": s.token, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error("내 PC 연결 프로그램(브리지)에 연결 못 함. PC에서 켜져 있는지, 브라우저가 로컬 네트워크 접근을 막지 않았는지 확인 필요");
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
