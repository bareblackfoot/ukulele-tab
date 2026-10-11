#!/usr/bin/env python
"""GPU analysis for one job on the nurilab server.

    python analyze.py --job jobs/<id> [--lang ko] [--no-lyrics] [--no-inst]

Reads <job>/audio.wav and writes
  <job>/transcription.json  ukulele-transcription v1 (grid columns, chords, lyrics, melody as MIDI pitches)
  <job>/asr.json            lyric lines as heard by Whisper, with the column of every syllable
  <job>/report.json         numbers for checking the result
Progress lines go to stdout.
"""
import argparse
import json
import math
import os
import re
import sys
import time
import unicodedata

import numpy as np

T_START = time.time()


def log(msg):
    print(f"[{time.time() - T_START:6.1f}s] {msg}", flush=True)


# ---------------------------------------------------------------- tempo map shared with the web app (js/model.js TimeMap)

class TimeMap:
    def __init__(self, tempo, spb):
        self.spb = spb
        self.segs = []
        t = 0.0
        ev = sorted(tempo, key=lambda e: e["col"])
        for i, e in enumerate(ev):
            spc = 60.0 / e["bpm"] / spb
            if i > 0:
                t += (e["col"] - ev[i - 1]["col"]) * self.segs[-1][2]
            self.segs.append((e["col"], t, spc))
        self.cols = np.array([s[0] for s in self.segs], float)
        self.ts = np.array([s[1] for s in self.segs], float)

    def col_to_time(self, col):
        i = max(0, int(np.searchsorted(self.cols, col, side="right")) - 1)
        c, t, spc = self.segs[i]
        return t + (col - c) * spc

    def time_to_col(self, t):
        i = max(0, int(np.searchsorted(self.ts, t, side="right")) - 1)
        c, t0, spc = self.segs[i]
        return c + (t - t0) / spc


# ---------------------------------------------------------------- beat grid

def build_grid(beats, downbeats, duration, spb):
    """Beat grid, meter and tempo events from tracked beats/downbeats.

    Returns dict with beat_times (grid beats from col 0), t0, tempo events, meter events,
    bar_starts (beat indices), constant flag and residual numbers."""
    beats = np.asarray(beats, float)
    ibi = np.diff(beats)
    T0 = float(np.median(ibi))
    # integer beat index for every tracked beat, tolerating a missed beat now and then
    idx = [0]
    for d in ibi:
        idx.append(idx[-1] + max(1, int(round(d / T0))))
    idx = np.array(idx)
    full_idx = np.arange(idx[0], idx[-1] + 1)
    full_t = np.interp(full_idx, idx, beats)
    A = np.vstack([np.ones_like(full_idx, dtype=float), full_idx]).T
    coef, *_ = np.linalg.lstsq(A, full_t, rcond=None)
    resid = full_t - A @ coef
    p95 = float(np.percentile(np.abs(resid), 95))
    mx = float(np.abs(resid).max())
    constant = p95 < 0.035 and mx < 0.09
    T = float(coef[1]) if constant else T0
    grid_t = (A @ coef) if constant else full_t

    # bar starts from downbeats
    db = np.unique(np.round(np.interp(np.asarray(downbeats, float), full_t, full_idx)).astype(int))
    db = db[(db >= full_idx[0]) & (db <= full_idx[-1])]
    if len(db) >= 2:
        iv = np.diff(db)
        iv = iv[(iv >= 2) & (iv <= 7)]
        M = int(np.bincount(iv).argmax()) if len(iv) else 4
    else:
        M = 4
    dbset = set(db.tolist())
    starts = [int(db[0])] if len(db) else [int(full_idx[0])]
    irregular = 0
    while starts[-1] + 1 < full_idx[-1]:
        cur = starts[-1]
        if cur + M in dbset or cur + M > full_idx[-1]:
            starts.append(cur + M)
            continue
        # a tracked downbeat nearby that the following bars agree with means a real odd-length bar
        nxt = None
        for d in range(cur + 2, cur + M + 3):
            if d in dbset and (d + M in dbset or d + 2 * M in dbset):
                nxt = d
                break
        if nxt is not None:
            irregular += 1
            starts.append(nxt)
        else:
            starts.append(cur + M)
    starts = [s for s in starts if s <= full_idx[-1]]

    # extend the grid backwards to the start of the audio and forwards to its end
    n_before = int(math.floor(grid_t[0] / T + 1e-6))
    n_after = int(math.ceil(max(0.0, duration - grid_t[-1]) / T)) + 1
    first_idx = int(full_idx[0]) - n_before
    if constant:
        k = np.arange(first_idx, int(full_idx[-1]) + n_after + 1)
        beat_times = coef[0] + coef[1] * k
    else:
        pre = grid_t[0] - T * np.arange(n_before, 0, -1)
        post = grid_t[-1] + T * np.arange(1, n_after + 1)
        beat_times = np.concatenate([pre, grid_t, post])
    # beat index i in beat_times corresponds to tracker index first_idx + i
    bar_starts = [s - first_idx for s in starts]
    pickup = bar_starts[0]
    # bars before the first downbeat: whole bars of M, and a short first bar for the remainder
    pre_bars = []
    b = pickup
    while b - M >= 0:
        pre_bars.insert(0, b - M)
        b -= M
    if b > 0:
        pre_bars.insert(0, 0)
    bar_starts = pre_bars + bar_starts
    # continue bars of M up to the end of the grid
    while bar_starts[-1] + M < len(beat_times) - 1:
        bar_starts.append(bar_starts[-1] + M)
    meter, last = [], None
    for i, bs in enumerate(bar_starts):
        nb = (bar_starts[i + 1] - bs) if i + 1 < len(bar_starts) else M
        if nb != last:
            meter.append({"col": bs * spb, "beats": int(nb)})
            last = nb
    t0 = float(beat_times[0])
    if constant:
        tempo = [{"col": 0, "bpm": round(60.0 / T, 2)}]
    else:
        # one tempo per stretch of bars: grow the stretch while a straight line through its first and last bar
        # stays within 60 ms of every bar line in between, then start a new tempo there
        starts = [b for b in bar_starts if b < len(beat_times)]
        if starts[-1] != len(beat_times) - 1:
            starts.append(len(beat_times) - 1)
        tempo, s = [], 0
        while s < len(starts) - 1:
            e = s + 1
            while e + 1 < len(starts):
                b0, b1 = starts[s], starts[e + 1]
                rate = (beat_times[b1] - beat_times[b0]) / (b1 - b0)
                if max(abs(beat_times[starts[k]] - (beat_times[b0] + (starts[k] - b0) * rate)) for k in range(s, e + 2)) > 0.06:
                    break
                e += 1
            b0, b1 = starts[s], starts[e]
            bpm = 60.0 * (b1 - b0) / (beat_times[b1] - beat_times[b0])
            if not tempo or abs(bpm - tempo[-1]["bpm"]) > 0.01:
                tempo.append({"col": b0 * spb, "bpm": round(bpm, 3)})
            s = e
        tempo[0]["col"] = 0
    n_beats = len(beat_times) - 1
    last_bar_end = bar_starts[-1] + (meter[-1]["beats"] if meter else M)
    return {
        "beat_times": beat_times, "t0": t0, "tempo": tempo, "meter": meter, "bar_starts": bar_starts,
        "constant": constant, "resid_p95_ms": p95 * 1000, "resid_max_ms": mx * 1000, "beats_per_bar": M,
        "irregular_bars": irregular, "column_count": int(max(n_beats, last_bar_end) * spb),
        "bpm_estimate": 60.0 / T,
    }


def grid_from_file(path):
    """Beat grid from a score's own tempo map. Video time of column c = t0 + time(c), t0 = -offsetMs/1000."""
    d = json.load(open(path, encoding="utf-8"))
    spb = int(d.get("stepsPerBeat", 4))
    tempo = sorted(d["tempo"], key=lambda e: e["col"])
    meter = sorted(d["meter"], key=lambda e: e["col"])
    tm = TimeMap(tempo, spb)
    t0 = -float(d.get("offsetMs", 0)) / 1000
    n_beats = int(math.ceil(d["columnCount"] / spb))
    beat_times = np.array([t0 + tm.col_to_time(k * spb) for k in range(n_beats + 1)])
    bar_starts, col, mi = [], 0, 0
    while col < d["columnCount"]:
        while mi + 1 < len(meter) and meter[mi + 1]["col"] <= col:
            mi += 1
        ln = int(meter[mi]["beats"]) * spb
        nxt = meter[mi + 1]["col"] if mi + 1 < len(meter) else None
        if nxt is not None and col < nxt < col + ln:
            ln = nxt - col
        bar_starts.append(col // spb)
        col += ln
    beats_per_bar = int(np.bincount([int(m["beats"]) for m in meter]).argmax()) if meter else 4
    return {"beat_times": beat_times, "t0": t0, "tempo": tempo, "meter": meter, "bar_starts": bar_starts,
            "constant": len(tempo) == 1, "resid_p95_ms": 0.0, "resid_max_ms": 0.0, "beats_per_bar": beats_per_bar,
            "irregular_bars": 0, "column_count": int(d["columnCount"]), "bpm_estimate": tempo[0]["bpm"], "spb": spb}


# ---------------------------------------------------------------- melody notes from a pitch track

def pitch_track(y16, device, fmin=65.0, fmax=1100.0):
    import torch
    import torchcrepe
    audio = torch.from_numpy(y16.astype(np.float32))[None].to(device)
    f0, per = torchcrepe.predict(audio, 16000, hop_length=160, fmin=fmin, fmax=fmax, model="full",
                                 decoder=torchcrepe.decode.viterbi, return_periodicity=True,
                                 batch_size=2048, device=device)
    per = torchcrepe.filter.median(per, 3)
    f0 = f0[0].cpu().numpy()
    per = per[0].cpu().numpy()
    import librosa
    rms = librosa.feature.rms(y=y16, frame_length=1024, hop_length=160, center=True)[0]
    n = min(len(f0), len(rms))
    return f0[:n], per[:n], rms[:n]


def onset_times(y22, sr=22050):
    import librosa
    env = librosa.onset.onset_strength(y=y22, sr=sr, hop_length=220, lag=2, max_size=3)
    env = env / (np.percentile(env, 99) + 1e-9)
    fr = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=220, units="frames", backtrack=False,
                                    pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=0.07, wait=6)
    return fr * 220 / sr, env


def segment_notes(f0, per, rms, onsets, per_thr=0.45, rel_rms=0.08, region=None):
    """Note events [(midi_float, t_start, t_end)] from a 10 ms pitch track, split at onsets."""
    hop = 0.01
    p95 = np.percentile(rms[rms > 0], 95) if np.any(rms > 0) else 1.0
    voiced = (per > per_thr) & (rms > max(0.004, rel_rms * p95)) & (f0 > 0)
    if region is not None:
        voiced &= region
    midi = np.where(voiced, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), np.nan)
    from scipy.ndimage import median_filter
    sm = midi.copy()
    good = ~np.isnan(sm)
    tmp = np.where(good, sm, 0)
    tmp = median_filter(tmp, size=5)
    sm = np.where(good, tmp, np.nan)
    frac = (sm[good] - np.round(sm[good]))
    tuning = float(np.angle(np.mean(np.exp(2j * np.pi * frac))) / (2 * np.pi)) if good.any() else 0.0
    q = np.round(sm - tuning)
    # runs of the same rounded pitch
    runs, i, n = [], 0, len(q)
    while i < n:
        if np.isnan(q[i]):
            i += 1
            continue
        j = i
        while j + 1 < n and q[j + 1] == q[i]:
            j += 1
        runs.append([int(q[i]), i, j + 1])
        i = j + 1
    # join same-pitch runs separated by a short unvoiced gap (< 50 ms)
    merged = []
    for r in runs:
        if merged and merged[-1][0] == r[0] and r[1] - merged[-1][2] <= 5:
            merged[-1][2] = r[2]
        else:
            merged.append(r)
    # absorb very short runs (< 70 ms) into a neighbour
    changed = True
    while changed:
        changed = False
        for k, r in enumerate(merged):
            if r[2] - r[1] >= 7:
                continue
            prv = merged[k - 1] if k > 0 and merged[k - 1][2] >= r[1] - 1 else None
            nxt = merged[k + 1] if k + 1 < len(merged) and merged[k + 1][1] <= r[2] + 1 else None
            tgt = None
            if nxt is not None and (prv is None or (nxt[2] - nxt[1]) >= (prv[2] - prv[1])):
                if abs(nxt[0] - r[0]) <= 2:
                    nxt[1] = r[1]
                    tgt = nxt
            if tgt is None and prv is not None and abs(prv[0] - r[0]) <= 2:
                prv[2] = r[2]
                tgt = prv
            del merged[k]
            changed = True
            break
    # merge neighbours that now have the same pitch and touch
    out = []
    for r in merged:
        if out and out[-1][0] == r[0] and r[1] - out[-1][2] <= 2:
            out[-1][2] = r[2]
        else:
            out.append(r)
    # split at onsets inside a note (syllables sung on the same pitch)
    on_fr = np.round(np.asarray(onsets) / hop).astype(int)
    notes = []
    for p, a, b in out:
        cuts = [a] + [int(o) for o in on_fr if a + 8 <= o <= b - 8] + [b]
        for s, e in zip(cuts[:-1], cuts[1:]):
            if e - s < 4:
                continue
            seg = sm[s:e]
            seg = seg[~np.isnan(seg)]
            if len(seg) == 0:
                continue
            mid = seg[len(seg) // 5: max(len(seg) // 5 + 1, len(seg) * 4 // 5)]
            pitch = float(np.median(mid)) - tuning
            notes.append((pitch, s * hop, e * hop))
    # snap note starts to a nearby onset (onsets mark syllable starts more precisely than the pitch track)
    on_t = np.asarray(onsets)
    snapped = []
    for p, s, e in notes:
        if len(on_t):
            k = int(np.argmin(np.abs(on_t - s)))
            if abs(on_t[k] - s) <= 0.06 and on_t[k] < e - 0.04:
                s = float(on_t[k])
        snapped.append((p, s, e))
    return snapped, tuning, voiced


def quantize_notes(notes, to_col, min_len_s=0.07):
    """[(midi_float, t0, t1)] -> [{col, len, midi}] on the step grid."""
    if not notes:
        return [], {}
    starts = np.array([to_col(s) for _, s, _ in notes])
    near = np.abs(starts - np.round(starts)) < 0.3
    odd = (np.round(starts).astype(int) % 2 == 1) & near
    odd_frac = float(odd.sum() / max(1, near.sum()))
    eighth_only = odd_frac < 0.18
    out = []
    for (p, s, e), sc in zip(notes, starts):
        if e - s < min_len_s:
            continue
        c16 = int(round(sc))
        c8 = int(2 * round(sc / 2))
        col = c8 if eighth_only or abs(sc - c8) < 0.65 else c16
        ec = int(round(to_col(e)))
        out.append({"col": max(0, col), "end": max(col + 1, ec), "midi": int(round(p))})
    out.sort(key=lambda n: (n["col"], -(n["end"] - n["col"])))
    clean = []
    for n in out:
        if clean and clean[-1]["col"] == n["col"]:
            continue  # same start after rounding: keep the longer one
        if clean and clean[-1]["end"] > n["col"]:
            clean[-1]["end"] = n["col"]
        clean.append(n)
    # close tiny gaps (one step) so phrases read as connected
    for a, b in zip(clean[:-1], clean[1:]):
        if 0 < b["col"] - a["end"] <= 1:
            a["end"] = b["col"]
    res = [{"col": n["col"], "len": max(1, n["end"] - n["col"]), "midi": n["midi"]} for n in clean if n["end"] > n["col"]]
    return res, {"odd_16th_fraction": round(odd_frac, 3), "eighth_grid": bool(eighth_only)}


# ---------------------------------------------------------------- chords

QUALS = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "m7": (0, 3, 7, 10)}
QPEN = {"": 0.0, "m": 0.0, "7": 0.045, "m7": 0.05}
SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
KK_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
FLAT_KEYS_MAJ = {5, 10, 3, 8, 1, 6}     # F Bb Eb Ab Db Gb
FLAT_KEYS_MIN = {2, 7, 0, 5, 10, 3}     # Dm Gm Cm Fm Bbm Ebm


def estimate_key(chroma_sum):
    best = None
    c = chroma_sum / (np.linalg.norm(chroma_sum) + 1e-9)
    for r in range(12):
        for mode, prof in (("major", KK_MAJ), ("minor", KK_MIN)):
            p = np.roll(prof, r)
            v = float(np.corrcoef(c, p)[0, 1])
            if best is None or v > best[0]:
                best = (v, r, mode)
    v, r, mode = best
    flats = (r in FLAT_KEYS_MAJ) if mode == "major" else (r in FLAT_KEYS_MIN)
    names = FLAT if flats else SHARP
    return {"root": r, "mode": mode, "name": names[r] + ("" if mode == "major" else "m"), "flats": flats, "corr": round(v, 3)}


def chords_from_audio(harm, bass, sr, beat_times, bar_starts, beats_per_bar):
    import librosa
    hop = 512
    C = librosa.feature.chroma_cqt(y=harm, sr=sr, hop_length=hop, bins_per_octave=36)
    B = librosa.feature.chroma_cqt(y=bass, sr=sr, hop_length=hop, fmin=librosa.note_to_hz("E1"), n_octaves=4, bins_per_octave=36)
    e = librosa.feature.rms(y=harm, frame_length=2048, hop_length=hop)[0]
    n = min(C.shape[1], B.shape[1], len(e))
    C, B, e = C[:, :n], B[:, :n], e[:n]
    fr = np.clip(np.round(np.asarray(beat_times) * sr / hop).astype(int), 0, n)
    K = len(beat_times) - 1
    cb = np.zeros((K, 12))
    bb = np.zeros((K, 12))
    eb = np.zeros(K)
    for k in range(K):
        a, b_ = fr[k], max(fr[k] + 1, fr[k + 1])
        if a >= n:
            break
        cb[k] = np.median(C[:, a:b_], axis=1)
        bb[k] = np.median(B[:, a:b_], axis=1)
        eb[k] = float(np.mean(e[a:b_]))
    labels = []
    T = []
    for r in range(12):
        for q, iv in QUALS.items():
            w = np.zeros(12)
            for j, x in enumerate(iv):
                w[(r + x) % 12] = [1.0, 0.85, 0.75, 0.6][j]
            T.append(w / np.linalg.norm(w))
            labels.append((r, q))
    T = np.array(T)
    cbn = cb / (np.linalg.norm(cb, axis=1, keepdims=True) + 1e-9)
    bbn = bb / (bb.max(axis=1, keepdims=True) + 1e-9)
    E = cbn @ T.T + 0.3 * np.array([[bbn[k, r] for r, _ in labels] for k in range(K)]) \
        - np.array([QPEN[q] for _, q in labels])[None, :]
    quiet = eb < 0.08 * (np.percentile(eb, 90) + 1e-9)
    NC = len(labels)
    E = np.hstack([E, np.where(quiet, 2.0, 0.35)[:, None]])  # last state = no chord
    # where in the bar each beat falls -> cost of changing chord there
    pos = np.full(K, -1)
    for i, bs in enumerate(bar_starts):
        be = bar_starts[i + 1] if i + 1 < len(bar_starts) else bs + beats_per_bar
        for k in range(bs, min(be, K)):
            pos[k] = k - bs
    blen = np.full(K, beats_per_bar)
    for i, bs in enumerate(bar_starts):
        be = bar_starts[i + 1] if i + 1 < len(bar_starts) else bs + beats_per_bar
        blen[bs:min(be, K)] = be - bs
    lam = np.where(pos == 0, 0.08, np.where((blen % 2 == 0) & (pos == blen // 2), 0.22, 0.5))
    S = NC + 1
    score = E[0].copy()
    back = np.zeros((K, S), int)
    for k in range(1, K):
        best_prev = int(np.argmax(score))
        stay = score
        switch = score[best_prev] - lam[k]
        take_switch = switch > stay
        back[k] = np.where(take_switch, best_prev, np.arange(S))
        score = np.where(take_switch, switch, stay) + E[k]
    path = np.zeros(K, int)
    path[-1] = int(np.argmax(score))
    for k in range(K - 1, 0, -1):
        path[k - 1] = back[k, path[k]]
    return path, labels, NC, cb.sum(0) * 1.0, quiet


# ---------------------------------------------------------------- lyrics

SMALL_KANA = set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮっッー")  # sung together with the kana before them


# Whisper (large-v3) often writes these on music without words; compared with spaces removed
WHISPER_FILLERS = ["다음영상에서만나요", "시청해주셔서감사합니다", "구독과좋아요", "자막제공", "배달의민족", "한글자막",
                   "MBC뉴스", "KBS뉴스", "자막by", "ご視聴ありがとうございました", "チャンネル登録", "Thanksforwatching",
                   "Subtitlesby", "字幕"]


def units_of(word):
    """Split a word into sung units: Hangul syllables, kana morae, other words whole."""
    w = unicodedata.normalize("NFC", word.strip())
    w = re.sub(r"[\s\.,!?~…·\"'“”‘’()\[\]{}<>:;—–\-]+", "", w)
    if not w:
        return []
    if re.search(r"[가-힣]", w):
        return [ch for ch in w if re.match(r"[가-힣A-Za-z0-9]", ch)] if not re.search(r"[A-Za-z]{2,}", w) \
            else [w]
    if re.search(r"[぀-ヿ一-鿿]", w):
        out = []
        for ch in w:
            if ch in SMALL_KANA and out:
                out[-1] += ch
            else:
                out.append(ch)
        return out
    return [w]


def align_units(units, ws, we, cand):
    """Times for each unit of a word sung in [ws, we], using note onsets cand (sorted) when they fit."""
    n = len(units)
    targets = [ws + (we - ws) * i / max(1, n) for i in range(n)]
    c = [t for t in cand if ws - 0.12 <= t <= we - 0.03]
    if not c:
        return targets
    m = len(c)
    # monotonic assignment of units to onsets (each onset used at most once), unused units interpolated
    INF = 1e9
    dp = np.full((n + 1, m + 1), INF)
    dp[0, :] = 0
    choice = np.zeros((n + 1, m + 1), int)  # 1 = unit i uses onset j, 2 = unit i unmatched, 3 = onset j skipped
    for i in range(0, n + 1):
        for j in range(0, m + 1):
            if i == 0 and j == 0:
                continue
            best, how = INF, 0
            if i > 0 and j > 0 and dp[i - 1, j - 1] + abs(c[j - 1] - targets[i - 1]) < best:
                best, how = dp[i - 1, j - 1] + abs(c[j - 1] - targets[i - 1]), 1
            if i > 0 and dp[i - 1, j] + 0.25 < best:
                best, how = dp[i - 1, j] + 0.25, 2
            if j > 0 and dp[i, j - 1] + 0.02 < best:
                best, how = dp[i, j - 1] + 0.02, 3
            if best < dp[i, j]:
                dp[i, j], choice[i, j] = best, how
    times = [None] * n
    i, j = n, m
    while i > 0:
        h = choice[i, j]
        if h == 1:
            times[i - 1] = c[j - 1]
            i, j = i - 1, j - 1
        elif h == 2:
            i -= 1
        else:
            j -= 1
    for k in range(n):
        if times[k] is None:
            times[k] = targets[k]
    for k in range(1, n):
        times[k] = max(times[k], times[k - 1] + 0.05)
    return times


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--lang", default=None)
    ap.add_argument("--no-lyrics", action="store_true")
    ap.add_argument("--no-inst", action="store_true")
    ap.add_argument("--spb", type=int, default=4)
    ap.add_argument("--grid", default=None, help="JSON with stepsPerBeat, tempo, meter, columnCount, offsetMs (skip beat tracking)")
    args = ap.parse_args()
    job = args.job
    spb = args.spb

    import soundfile as sf
    import torch
    import librosa
    device = "cuda" if torch.cuda.is_available() else "cpu"
    x, sr = sf.read(os.path.join(job, "audio.wav"), always_2d=True, dtype="float32")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != 44100:
        x = np.stack([librosa.resample(x[:, c], orig_sr=sr, target_sr=44100) for c in range(2)], axis=1)
        sr = 44100
    duration = x.shape[0] / sr
    log(f"오디오 {duration:.1f}초 읽음 ({device})")

    # 1. source separation
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    model = get_model("htdemucs_ft")
    model.eval()
    wav = torch.from_numpy(x.T.copy())
    ref = wav.mean(0)
    mu, sd = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        est = apply_model(model, ((wav - mu) / sd)[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    est = est * sd + mu
    stems = {name: est[i].mean(0).numpy() for i, name in enumerate(model.sources)}
    del model, est
    if device == "cuda":
        torch.cuda.empty_cache()
    log("소리 분리 끝 (보컬·드럼·베이스·나머지)")
    mix = x.mean(1)

    # 2. beats and bars
    if args.grid:
        g = grid_from_file(args.grid)
        spb = g["spb"]
        beats = g["beat_times"]
    else:
        from beat_this.inference import Audio2Beats
        a2b = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)
        beats, downbeats = a2b(mix, sr)
        del a2b
        g = build_grid(beats, downbeats, duration, spb)
    tm = TimeMap(g["tempo"], spb)
    t0 = g["t0"]
    to_col = lambda t: tm.time_to_col(t - t0)
    log(f"박 {len(beats)}개, 템포 {g['tempo'][0]['bpm']} BPM ({'일정' if g['constant'] else '변함'}), {g['beats_per_bar']}박 마디")

    # 3. vocal melody
    v16 = librosa.resample(stems["vocals"], orig_sr=sr, target_sr=16000)
    v22 = librosa.resample(stems["vocals"], orig_sr=sr, target_sr=22050)
    f0, per, rms = pitch_track(v16, device)
    on_t, _ = onset_times(v22)
    vnotes_raw, tuning, voiced = segment_notes(f0, per, rms, on_t)
    vnotes, qinfo = quantize_notes(vnotes_raw, to_col)
    log(f"노래 음 {len(vnotes)}개 (음높이 보정 {tuning:+.2f}반음)")

    # coverage / agreement of the written notes against the sung pitch (10 ms frames)
    frame_t = np.arange(len(f0)) * 0.01
    written = np.full(len(f0), np.nan)
    for n_ in vnotes:
        a = tm.col_to_time(n_["col"]) + t0
        b = tm.col_to_time(n_["col"] + n_["len"]) + t0
        written[(frame_t >= a) & (frame_t < b)] = n_["midi"]
    sung = 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0) - tuning
    vmask = voiced
    covered = vmask & ~np.isnan(written)
    coverage = float(covered.sum() / max(1, vmask.sum()))
    d = np.abs(((sung - written + 6) % 12) - 6)
    agree = float((d[covered] < 0.5).mean()) if covered.any() else 0.0

    # 4. chords
    harm = librosa.resample(stems["other"] + stems["bass"], orig_sr=sr, target_sr=22050)
    bass22 = librosa.resample(stems["bass"], orig_sr=sr, target_sr=22050)
    path, labels, NC, chroma_sum, quiet = chords_from_audio(harm, bass22, 22050, g["beat_times"], g["bar_starts"], g["beats_per_bar"])
    key = estimate_key(chroma_sum)
    if key["flats"]:
        names = FLAT
    elif key["root"] in (0, 9) and key["mode"] == ("major" if key["root"] == 0 else "minor"):
        # C major / A minor: borrowed chords are usually written Eb, Ab, Bb but C#, F#
        names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    else:
        names = SHARP
    chords, prev = [], None
    for k, s in enumerate(path):
        nm = "N.C." if s == NC else names[labels[s][0]] + labels[s][1]
        if nm != prev:
            chords.append({"col": k * spb, "name": nm})
            prev = nm
    # drop a leading "no chord" and very short chords (one beat) between two equal chords
    while chords and chords[0]["name"] == "N.C.":
        chords.pop(0)
    cleaned = []
    for i, c in enumerate(chords):
        nxt = chords[i + 1]["col"] if i + 1 < len(chords) else None
        if cleaned and nxt is not None and nxt - c["col"] <= spb and i + 1 < len(chords) and chords[i + 1]["name"] == cleaned[-1]["name"]:
            continue
        if cleaned and cleaned[-1]["name"] == c["name"]:
            continue
        cleaned.append(c)
    chords = cleaned
    log(f"코드 {len(chords)}번 바뀜, 조 {key['name']}")

    # 5. lyrics
    lyrics, asr_lines, asr_info = [], [], {}
    if not args.no_lyrics:
        del stems["drums"]
        if device == "cuda":
            torch.cuda.empty_cache()
        from faster_whisper import WhisperModel
        wm = WhisperModel("large-v3", device=device, compute_type="float16" if device == "cuda" else "int8")
        segs, info = wm.transcribe(v16, language=args.lang, word_timestamps=True, vad_filter=True,
                                   vad_parameters={"min_silence_duration_ms": 500}, condition_on_previous_text=False,
                                   beam_size=5, temperature=0.0, no_speech_threshold=0.6, compression_ratio_threshold=2.2)
        segs = list(segs)
        asr_info = {"language": info.language, "language_probability": round(float(info.language_probability), 3)}
        note_starts = sorted(tm.col_to_time(n_["col"]) + t0 for n_ in vnotes)
        note_cols = sorted(n_["col"] for n_ in vnotes)
        used_cols = set()
        last_texts = []
        for si, s in enumerate(segs):
            text = s.text.strip()
            if not text or not s.words:
                continue
            flat = re.sub(r"\s+", "", text)
            if any(p in flat for p in WHISPER_FILLERS):
                continue  # sentences Whisper writes on silence (video outros, subtitle credits)
            a, b = int(s.start / 0.01), int(s.end / 0.01)
            vf = float(voiced[a:b].mean()) if b > a else 0.0
            if vf < 0.2:
                continue  # Whisper wrote words where nobody sings
            if len(last_texts) >= 2 and all(t == text for t in last_texts[-2:]):
                continue  # the same line over and over is usually a Whisper loop
            last_texts.append(text)
            line = {"index": len(asr_lines), "text": text, "start": round(s.start, 2), "end": round(s.end, 2),
                    "voiced": round(vf, 2), "syllables": []}
            for w in s.words:
                us = units_of(w.word)
                if not us:
                    continue
                times = align_units(us, w.start, w.end, note_starts)
                for u, t in zip(us, times):
                    cf = to_col(t)
                    # use a note start within one step when there is one, else the nearest 8th
                    k = int(np.searchsorted(note_cols, cf))
                    near = [note_cols[j] for j in (k - 1, k) if 0 <= j < len(note_cols) and abs(note_cols[j] - cf) <= 1.01]
                    col = min(near, key=lambda q: abs(q - cf)) if near else int(2 * round(cf / 2))
                    while col in used_cols:
                        col += 1
                    used_cols.add(col)
                    line["syllables"].append({"text": u, "col": int(col), "prob": round(float(w.probability), 2)})
                    lyrics.append({"col": int(col), "text": u})
            asr_lines.append(line)
        del wm
        lyrics.sort(key=lambda e: e["col"])
        # split a held note where a new syllable starts inside it (one note per syllable)
        lcols = [e["col"] for e in lyrics]
        split = []
        for n_ in vnotes:
            inside = [c for c in lcols if n_["col"] < c < n_["col"] + n_["len"]]
            cuts = [n_["col"]] + inside + [n_["col"] + n_["len"]]
            for s_, e_ in zip(cuts[:-1], cuts[1:]):
                split.append({"col": s_, "len": e_ - s_, "midi": n_["midi"]})
        log(f"가사 {len(lyrics)}음절, {len(asr_lines)}줄 (언어 {asr_info.get('language')}), 음 나누기 {len(vnotes)}→{len(split)}")
        vnotes = split

    # 6. instrument melody where nobody sings for 2+ bars
    inst = []
    if not args.no_inst:
        bar_t = [tm.col_to_time(b * spb) + t0 for b in g["bar_starts"]] + [duration]
        region = np.zeros(len(f0), bool)
        runs, cur = [], []
        for i in range(len(bar_t) - 1):
            a, b = int(bar_t[i] / 0.01), int(bar_t[i + 1] / 0.01)
            silent = b > a and float(voiced[a:b].mean()) < 0.05
            if silent:
                cur.append((a, b))
            else:
                if len(cur) >= 2:
                    runs.append(cur)
                cur = []
        if len(cur) >= 2:
            runs.append(cur)
        for r in runs:
            region[r[0][0]:r[-1][1]] = True
        if region.any():
            o16 = librosa.resample(stems["other"], orig_sr=sr, target_sr=16000)
            o22 = librosa.resample(stems["other"], orig_sr=sr, target_sr=22050)
            f0o, pero, rmso = pitch_track(o16, device, fmin=110, fmax=1600)
            n = min(len(f0o), len(region))
            ono, _ = onset_times(o22)
            inst_raw, _, _ = segment_notes(f0o[:n], pero[:n], rmso[:n], ono, per_thr=0.6, rel_rms=0.1, region=region[:n])
            inst, _ = quantize_notes(inst_raw, to_col, min_len_s=0.09)
        log(f"반주 멜로디 음 {len(inst)}개 (노래 없는 구간 {sum(len(r) for r in runs)}마디)")

    melody = [{"id": "melody", "name": "노래 멜로디", "notes": vnotes}]
    if inst:
        melody.append({"id": "inst", "name": "반주 멜로디", "notes": inst})
    pitches = [n_["midi"] for n_ in vnotes]
    out = {
        "format": {"name": "ukulele-transcription", "version": 1},
        "meta": {"key": key["name"]},
        "stepsPerBeat": spb,
        "columnCount": g["column_count"],
        "tempo": g["tempo"],
        "meter": g["meter"],
        "youtube": {"offsetMs": int(round(-t0 * 1000))},
        "chords": chords,
        "lyrics": lyrics,
        "sections": [],
        "melody": melody,
    }
    chord_names = []
    for c in chords:
        if c["name"] not in chord_names:
            chord_names.append(c["name"])
    report = {
        "duration_s": round(duration, 2),
        "tempo": {"bpm": g["tempo"][0]["bpm"], "constant": g["constant"], "events": len(g["tempo"]),
                  "beat_fit_p95_ms": round(g["resid_p95_ms"], 1), "beat_fit_max_ms": round(g["resid_max_ms"], 1)},
        "meter": {"beats_per_bar": g["beats_per_bar"], "irregular_bars": g["irregular_bars"], "events": g["meter"][:8],
                  "bars": len(g["bar_starts"])},
        "key": key,
        "chords": {"changes": len(chords), "distinct": chord_names},
        "melody": {"notes": len(vnotes), "range_midi": [min(pitches), max(pitches)] if pitches else None,
                   "coverage_of_sung_frames": round(coverage, 3), "pitch_agreement_50c": round(agree, 3),
                   "tuning_semitones": round(tuning, 3), **qinfo},
        "inst_melody": {"notes": len(inst)},
        "lyrics": {"syllables": len(lyrics), "lines": len(asr_lines), **asr_info},
        "warnings": [],
    }
    w = report["warnings"]
    if not g["constant"]:
        w.append("템포가 일정하지 않음: 마디마다 BPM을 따로 넣음")
    if g["irregular_bars"] > 2:
        w.append(f"박자가 다른 마디 {g['irregular_bars']}개")
    if coverage < 0.8:
        w.append(f"노래 구간 중 음이 적힌 비율이 낮음 ({coverage:.2f})")
    if agree < 0.7:
        w.append(f"적힌 음과 실제 음높이 일치율이 낮음 ({agree:.2f})")
    if not args.no_lyrics and len(lyrics) < 20:
        w.append("가사를 거의 못 받아 적음")
    json.dump(out, open(os.path.join(job, "transcription.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump({"lines": asr_lines, **asr_info}, open(os.path.join(job, "asr.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(report, open(os.path.join(job, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log("완료")


if __name__ == "__main__":
    main()
