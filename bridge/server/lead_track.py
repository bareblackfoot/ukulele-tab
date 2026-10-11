#!/usr/bin/env python
"""A lead guitar line (solo, riff) from a recording, to put in a sheet as its own track (nurilab server).

    python lead_track.py --job jobs/<id> --ranges 150-185,290-335

Reads <job>/audio.wav, separates the guitar (demucs htdemucs_6s; the "other" stem of htdemucs_ft when that model
cannot be loaded), tracks its pitch (crepe) inside the given video-time ranges (seconds) and writes <job>/lead.json:
  notes: [{t0, t1, midi, tech}] in video time. midi is the fretted pitch; tech marks how the note is played:
    "b1"/"b2"  bend: after the attack the pitch rises 1 or 2 semitones and stays there
    "v"        vibrato: the pitch wobbles around the note
    "h"/"p"    hammer-on / pull-off: the pitch jumped from the note before without a new pick attack
    "s"        slide: the pitch moved from the note before through the frets in between, without a new attack
  stem, tuning (semitones off A440), per range how much of the time a pitch was heard.
"""
import argparse
import json
import os

import numpy as np

from analyze import log, onset_times, pitch_track


def separate(x, sr, device):
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    try:
        model, name = get_model("htdemucs_6s"), "guitar"
    except Exception as e:  # weights not downloadable: the 4-stem model, guitar is inside "other"
        log(f"htdemucs_6s 못 씀 ({e}); htdemucs_ft의 나머지 소리로 대신함")
        model, name = get_model("htdemucs_ft"), "other"
    model.eval()
    wav = torch.from_numpy(x.T.copy())
    ref = wav.mean(0)
    mu, sd = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        est = apply_model(model, ((wav - mu) / sd)[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    est = est * sd + mu
    stem = est[model.sources.index(name)].mean(0).numpy()
    del model, est
    if device == "cuda":
        torch.cuda.empty_cache()
    return stem, name


def runs_of(q):
    """[pitch, start frame, end frame) for runs of the same rounded pitch (nan = no pitch)"""
    out, i, n = [], 0, len(q)
    while i < n:
        if np.isnan(q[i]):
            i += 1
            continue
        j = i
        while j + 1 < n and q[j + 1] == q[i]:
            j += 1
        out.append([int(q[i]), i, j + 1])
        i = j + 1
    return out


HYST = 0.75       # semitones off the current note before the pitch counts as another note
PICK_RISE = 1.2   # level after / before an onset for it to count as a pick attack
MIN_LEVEL = 0.12  # a note quieter than this share of the loud part of the range is bleed from another part


def lead_notes(f0, per, rms, onsets, region):
    hop = 0.01
    p95 = np.percentile(rms[region & (rms > 0)], 95) if np.any(region & (rms > 0)) else 1.0
    voiced = region & (per > 0.5) & (rms > max(0.003, 0.05 * p95)) & (f0 > 0)
    midi = np.where(voiced, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), np.nan)
    from scipy.ndimage import median_filter
    good = ~np.isnan(midi)
    sm = np.where(good, median_filter(np.where(good, midi, 0), size=3), np.nan)
    frac = sm[good] - np.round(sm[good])
    tuning = float(np.angle(np.mean(np.exp(2j * np.pi * frac))) / (2 * np.pi)) if good.any() else 0.0
    sm = sm - tuning
    # stay on a semitone until the pitch is more than HYST away from it: a wide vibrato (Brian May's is about
    # half a semitone each way) does not turn one note into a trill of two
    q = np.full(len(sm), np.nan)
    cur = None
    for i, v in enumerate(sm):
        if np.isnan(v):
            if i > 0 and np.isnan(sm[i - 1]):
                cur = None
            continue
        if cur is None or abs(v - cur) > HYST:
            cur = float(np.round(v))
        q[i] = cur
    runs = runs_of(q)
    # join same pitch across a gap of up to 40 ms, drop runs shorter than 40 ms that sit between two others
    merged = []
    for r in runs:
        if merged and merged[-1][0] == r[0] and r[1] - merged[-1][2] <= 4:
            merged[-1][2] = r[2]
        else:
            merged.append(r)
    runs = [r for r in merged if r[2] - r[1] >= 4]
    # a pick attack makes the guitar louder; onsets where the level does not rise come from vibrato or bleed
    on_fr = np.round(np.asarray(onsets) / hop).astype(int)
    lvl = lambda a, b: float(np.mean(rms[max(0, a):max(a + 1, b)]))
    on_fr = np.array([o for o in on_fr if 2 <= o < len(rms) - 3 and lvl(o, o + 3) > PICK_RISE * lvl(o - 3, o)], int)
    picked = lambda fr: bool(np.any(np.abs(on_fr - fr) <= 3))   # a pick attack within 30 ms

    notes = []
    for p, a, b in runs:
        # a run that starts without a pick attack right after the run before is played with the left hand
        prev = notes[-1] if notes else None
        touching = prev is not None and a - prev["b"] <= 3
        if touching and not picked(a):
            d = p - prev["midi"]
            if d == 0:             # back on the fretted pitch without a new attack (a bend let down again)
                prev["b"] = b
                continue
            if prev.get("tech", "").startswith("b") and d == int(prev["tech"][1:]):
                prev["b"] = b      # still holding the bend
                continue
            # how long the pitch took to get there: a bend or a slide passes through the pitches in between
            gl = sm[max(prev["b"] - 6, prev["a"]):min(a + 6, b)]
            gl = gl[~np.isnan(gl)]
            gradual = len(gl) >= 4 and np.sum(np.abs(np.diff(gl)) > 0.15) >= 3
            if 1 <= d <= 2 and gradual and not prev.get("tech"):
                # bend: the note stays the fretted pitch, marked with how far it is bent
                prev["tech"] = f"b{d}"
                prev["b"] = b
                continue
            if abs(d) >= 1:
                notes.append({"midi": p, "a": a, "b": b, "tech": "s" if gradual and abs(d) >= 2 else ("h" if d > 0 else "p")})
                continue
        # split a long run at pick attacks inside it (the same note picked again)
        cuts = [a] + [int(o) for o in on_fr if a + 8 <= o <= b - 8] + [b]
        for s, e in zip(cuts[:-1], cuts[1:]):
            notes.append({"midi": p, "a": s, "b": e})
    # vibrato: the pitch inside a long note wobbles at 4..8 Hz by more than a seventh of a semitone
    for n in notes:
        if n.get("tech") or n["b"] - n["a"] < 25:
            continue
        seg = sm[n["a"] + 5:n["b"]]
        seg = seg[~np.isnan(seg)]
        if len(seg) < 20:
            continue
        x = seg - np.convolve(seg, np.ones(15) / 15, mode="same")
        x = x[7:-7]
        if len(x) < 10:
            continue
        crossings = np.sum(np.diff(np.sign(x)) != 0) / (len(x) * hop) / 2
        if np.std(x) > 0.14 and 4 <= crossings <= 8.5:
            n["tech"] = "v"
    # an octave slip of the pitch tracker: a note an octave off from both neighbours (within 0.5 s) goes back
    for i, nt in enumerate(notes):
        nb = [m["midi"] for m in notes[max(0, i - 2):i + 3] if m is not nt and abs(m["a"] - nt["a"]) <= 50]
        if len(nb) >= 2:
            for k in (12, -12):
                if all(abs(nt["midi"] - m) >= 9 for m in nb) and all(abs(nt["midi"] + k - m) <= 5 for m in nb):
                    nt["midi"] += k
                    break
    # drop quiet notes: another instrument or the singer heard through the guitar part
    loud = np.percentile(rms[voiced], 90) if voiced.any() else 1.0
    notes = [n for n in notes if np.median(rms[n["a"]:n["b"]]) >= MIN_LEVEL * loud]
    # snap starts to a pick attack close by
    on_t = on_fr * hop
    out = []
    for n in notes:
        t0, t1 = n["a"] * hop, n["b"] * hop
        if not n.get("tech") in ("h", "p", "s") and len(on_t):
            k = int(np.argmin(np.abs(on_t - t0)))
            if abs(on_t[k] - t0) <= 0.05 and on_t[k] < t1 - 0.03:
                t0 = float(on_t[k])
        out.append({"t0": round(t0, 3), "t1": round(t1, 3), "midi": int(n["midi"]), **({"tech": n["tech"]} if n.get("tech") else {})})
    return out, tuning, voiced


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--ranges", required=True, help="video seconds, e.g. 150-185,290-335")
    args = ap.parse_args()
    import librosa
    import soundfile as sf
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    x, sr = sf.read(os.path.join(args.job, "audio.wav"), always_2d=True, dtype="float32")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != 44100:
        x = np.stack([librosa.resample(x[:, c], orig_sr=sr, target_sr=44100) for c in range(2)], axis=1)
        sr = 44100
    log(f"오디오 {x.shape[0] / sr:.1f}초 읽음 ({device})")
    stem, name = separate(x, sr, device)
    log(f"기타 소리 분리 끝 ({name})")
    sf.write(os.path.join(args.job, "lead_stem.wav"), stem, sr)
    s16 = librosa.resample(stem, orig_sr=sr, target_sr=16000)
    s22 = librosa.resample(stem, orig_sr=sr, target_sr=22050)
    f0, per, rms = pitch_track(s16, device, fmin=75.0, fmax=1400.0)
    on_t, _ = onset_times(s22)
    ranges = [tuple(float(v) for v in r.split("-")) for r in args.ranges.split(",")]
    t = np.arange(len(f0)) * 0.01
    region = np.zeros(len(f0), bool)
    for a, b in ranges:
        region |= (t >= a) & (t < b)
    # the pitch track itself, so the note rules can be tried again without the server
    np.savez_compressed(os.path.join(args.job, "lead_pitch.npz"), f0=f0, per=per, rms=rms, onsets=on_t, region=region)
    notes, cover, tunings = [], [], []
    for a, b in ranges:
        part = (t >= a) & (t < b)
        ns, tu, voiced = lead_notes(f0, per, rms, on_t, part)
        notes += ns
        tunings.append(tu)
        cover.append({"from": a, "to": b, "voiced": round(float(np.mean(voiced[part])), 3)})
    tuning = float(np.median(tunings))
    tech = {k: sum(1 for n in notes if n.get("tech") == k) for k in ("b1", "b2", "v", "h", "p", "s")}
    log(f"리드 음 {len(notes)}개, 기법 {tech}, 음높이 보정 {tuning:+.2f}반음, 소리 난 비율 {[c['voiced'] for c in cover]}")
    json.dump({"stem": name, "tuning": round(tuning, 3), "ranges": cover, "notes": notes},
              open(os.path.join(args.job, "lead.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
