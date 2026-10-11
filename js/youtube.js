// YouTube IFrame player that follows the score clock.
// Rule shared with SPRED: video time = score time - offsetMs / 1000.

let apiPromise = null;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => reject(new Error("YouTube API를 못 불러옴"));
    document.head.appendChild(s);
  });
  return apiPromise;
}

export function parseVideoId(text) {
  const t = String(text || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  try {
    const u = new URL(t);
    if (u.hostname.endsWith("youtu.be")) return u.pathname.slice(1, 12);
    if (u.searchParams.get("v")) return u.searchParams.get("v").slice(0, 11);
    const m = /\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
    if (m) return m[1];
  } catch (_) { /* not a URL */ }
  return "";
}

export class YouTubeSync {
  constructor(host) {
    this.host = host;
    this.player = null;
    this.videoId = "";
    this.offsetMs = 0;
    this.ready = false;
    this.waitTimer = null;
    this.volume = 80;
  }

  async load(videoId) {
    if (!videoId) return;
    const YT = await loadApi();
    if (this.player && this.videoId === videoId) return;
    this.videoId = videoId;
    this.ready = false;
    if (this.player) {
      this.player.cueVideoById(videoId);
      this.ready = true;
      return;
    }
    const div = document.createElement("div");
    this.host.innerHTML = "";
    this.host.appendChild(div);
    await new Promise((resolve) => {
      this.player = new YT.Player(div, {
        videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 },
        events: {
          onReady: () => { this.ready = true; this.player.setVolume(this.volume); resolve(); },
          onError: (e) => { this.lastError = e.data; resolve(); },
        },
      });
    });
  }

  setVolume(v) {
    this.volume = v;
    if (this.ready) this.player.setVolume(v);
  }

  supportedRates() {
    try { return this.ready ? this.player.getAvailablePlaybackRates() : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; }
    catch (_) { return [1]; }
  }

  // nearest rate the video supports
  fitRate(r) {
    const rates = this.supportedRates();
    return rates.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), 1);
  }

  start(scoreTime, rate) {
    if (!this.ready) return;
    clearTimeout(this.waitTimer);
    const vt = scoreTime - this.offsetMs / 1000;
    this.player.setPlaybackRate(rate);
    if (vt < 0) {
      this.player.pauseVideo();
      this.player.seekTo(0, true);
      this.waitTimer = setTimeout(() => { this.player.playVideo(); this.expectAt = Date.now() + 3000; }, (-vt / rate) * 1000);
    } else {
      this.player.seekTo(vt, true);
      this.player.playVideo();
      this.expectAt = Date.now() + 3000;
    }
  }

  // called a few times a second while playing; seeks when the video drifts away from the score
  check(scoreTime) {
    if (!this.ready) return;
    const vt = scoreTime - this.offsetMs / 1000;
    if (vt < 0) return;
    const st = this.player.getPlayerState();
    // iPad/iPhone refuse to start a video from the page until it has been tapped once
    if (this.expectAt && Date.now() > this.expectAt) {
      this.expectAt = null;
      if (st !== 1 && st !== 3 && this.onBlocked) this.onBlocked();
    }
    if (st !== 1) return; // only while the video is actually playing (ads, buffering are left alone)
    const cur = this.player.getCurrentTime();
    if (Math.abs(cur - vt) > 0.15) this.player.seekTo(vt, true);
  }

  pause() {
    clearTimeout(this.waitTimer);
    this.expectAt = null;
    if (this.ready) this.player.pauseVideo();
  }
}
