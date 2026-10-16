// Signal processing for practice mode: FFT, onset detection, chroma (12 pitch classes), YIN pitch.

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const hannCache = new Map();
function hann(n) {
  if (!hannCache.has(n)) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return hannCache.get(n);
}

export function magnitude(samples) {
  const n = samples.length, w = hann(n);
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[i] * w[i];
  fft(re, im);
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

export function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

// Energy per pitch class from 170 Hz to 2.2 kHz, normalised to unit length.
export function chroma(samples, sr) {
  const mag = magnitude(samples);
  const n = samples.length;
  const c = new Float64Array(12);
  for (let k = 1; k < mag.length; k++) {
    const f = (k * sr) / n;
    if (f < 170) continue;
    if (f > 2200) break;
    const m = 69 + 12 * Math.log2(f / 440);
    const r = Math.round(m);
    const w = 1 - Math.abs(m - r) * 2;
    if (w <= 0) continue;
    c[((r % 12) + 12) % 12] += Math.sqrt(mag[k]) * w;
  }
  const norm = Math.hypot(...c) || 1;
  return Array.from(c, (v) => v / norm);
}

// Expected chroma of a set of string pitches (MIDI), with the first harmonics.
export function templateChroma(midis) {
  const c = new Float64Array(12);
  for (const m of midis) {
    [1, 2, 3, 4].forEach((h) => {
      const p = Math.round(m + 12 * Math.log2(h));
      c[((p % 12) + 12) % 12] += 1 / h;
    });
  }
  const norm = Math.hypot(...c) || 1;
  return Array.from(c, (v) => v / norm);
}

export const cosine = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

// YIN fundamental frequency; returns {f0, clarity} (clarity 0..1, higher is more periodic).
export function yin(x, sr, fmin = 180, fmax = 1400) {
  const n = x.length;
  const tauMin = Math.floor(sr / fmax), tauMax = Math.min(Math.floor(sr / fmin), Math.floor(n / 2));
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < n - tauMax; i++) { const v = x[i] - x[i + tau]; s += v * v; }
    d[tau] = s;
  }
  let run = 0;
  const cmnd = new Float64Array(tauMax + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < 0.15) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let m = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) if (cmnd[tau] < m) { m = cmnd[tau]; best = tau; }
  }
  // parabolic interpolation
  const a = cmnd[best - 1] ?? cmnd[best], b = cmnd[best], c = cmnd[best + 1] ?? cmnd[best];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  const tau = best + (Number.isFinite(shift) ? Math.max(-1, Math.min(1, shift)) : 0);
  return { f0: sr / tau, clarity: Math.max(0, 1 - b) };
}

// Keeps the last few seconds of microphone samples and finds note/strum onsets (spectral flux).
export class MicAnalyzer {
  constructor(sr, seconds = 3) {
    this.sr = sr;
    this.size = Math.ceil(sr * seconds);
    this.ring = new Float32Array(this.size);
    this.total = 0;          // samples received so far
    this.lastT = 0;          // audio-clock time of sample index total-1
    this.prevMag = null;
    this.flux = [];
    this.onsets = [];        // {t (audio clock, uncorrected), strength, f (spectral flux)}
    this.lastOnsetT = -1;
    this.toneT = -1;         // when a held pitch was last heard (otamatone game): that sound is not the room
    this.level = 0;
    this.noise = 0.002;      // level of the room when nothing is played
    this.onsetLevel = 0;     // typical level right after a strum (running average)
    this.skip = null;        // FFT bins left out of the onset measure (the app's own metronome tones)
    this.pending = new Float32Array(0);
  }

  // leave out narrow bands around these frequencies (and the 2nd and 3rd harmonics a small speaker adds),
  // so the app's own metronome coming back through the microphone is not heard as a strum
  ignoreTones(hz = []) {
    const N = 1024;
    const lim = Math.floor((6000 * N) / this.sr);
    if (!hz.length) { this.skip = null; return; }
    this.skip = new Uint8Array(lim);
    for (const f of hz) {
      for (const h of [1, 2, 3]) {
        const c = Math.round((f * h * N) / this.sr);
        for (let k = c - 6; k <= c + 6; k++) if (k >= 0 && k < lim) this.skip[k] = 1;
      }
    }
  }

  push(t, block) {
    for (let i = 0; i < block.length; i++) this.ring[(this.total + i) % this.size] = block[i];
    this.total += block.length;
    this.lastT = t;
    this.level = rms(block);
    // The room level falls quickly and rises slowly, and only after 0.6 s without a strum: while someone keeps
    // strumming, the ringing strings are not the room. (It used to rise during playing too, so after a minute
    // or so of strumming it reached the playing level and every strum was rejected.) A note held on the
    // otamatone has no new attack, so a pitch heard counts the same way (toneT).
    if (this.level < this.noise) this.noise = 0.9 * this.noise + 0.1 * this.level;
    else if (t - Math.max(this.lastOnsetT, this.toneT) > 0.6) this.noise = Math.min(this.noise * 1.002, 0.99 * this.noise + 0.01 * this.level);
    if (this.onsetLevel) this.noise = Math.min(this.noise, this.onsetLevel / 10);
    this.noise = Math.max(this.noise, 1e-5);
    this.detect();
  }

  timeOf(index) { return this.lastT - (this.total - 1 - index) / this.sr; }
  indexOf(t) { return Math.round(this.total - 1 - (this.lastT - t) * this.sr); }

  // samples starting at audio time t, or null if not received yet / already overwritten
  window(t, n) {
    const i0 = this.indexOf(t);
    if (i0 < this.total - this.size || i0 + n > this.total) return null;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.ring[(i0 + i) % this.size];
    return out;
  }

  detect() {
    const N = 1024;
    if (this.total < N) return;
    const frame = new Float32Array(N);
    for (let i = 0; i < N; i++) frame[i] = this.ring[(this.total - N + i) % this.size];
    const mag = magnitude(frame);
    const lim = Math.floor((6000 * N) / this.sr);
    let f = 0;
    if (this.prevMag) {
      for (let k = 2; k < lim; k++) {
        if (this.skip && this.skip[k]) continue;
        const d = Math.log1p(100 * mag[k]) - Math.log1p(100 * this.prevMag[k]);
        if (d > 0) f += d;
      }
    }
    this.prevMag = mag;
    const t = this.timeOf(this.total - N / 2);
    this.flux.push({ f, t, level: rms(frame) });
    if (this.flux.length > 48) this.flux.shift();
    // a peak one frame back that rises clearly above the recent average
    const L = this.flux.length;
    if (L < 8) return;
    const cur = this.flux[L - 2], prev = this.flux[L - 3], next = this.flux[L - 1];
    const hist = this.flux.slice(0, L - 2).map((x) => x.f);
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length);
    // A strum makes the sound louder than it was 30 ms before; a flux peak from room noise or ringing strings
    // usually does not. Without this, such peaks fired just before real strums (which were then ignored for
    // 80 ms): on 60 synthetic 12-second takes 176 onsets with no strum, now 8, with the same share of strums found.
    const thr = mean + 1.2 * sd + 3;
    const rise = next.level / Math.max(1e-9, this.flux[L - 5].level);
    // the peak frame itself must hold sound, not only the frame after it (a noise peak right before a strum)
    if (cur.f > thr && cur.f >= prev.f && cur.f >= next.f && next.level > this.noise * 4 && cur.level > this.noise * 3 && cur.t - this.lastOnsetT > 0.08
      && (rise >= 1 || cur.f >= thr * 1.6)) {
      this.lastOnsetT = cur.t;
      this.onsetLevel = this.onsetLevel ? 0.9 * this.onsetLevel + 0.1 * next.level : next.level;
      this.onsets.push({ t: cur.t - 0.012, strength: cur.f / (thr || 1), f: cur.f });
    }
  }

  takeOnsets() {
    const o = this.onsets;
    this.onsets = [];
    return o;
  }
}
