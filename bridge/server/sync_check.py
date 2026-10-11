#!/usr/bin/env python
"""How well a finished sheet lines up with the recording (nurilab server).

    python sync_check.py --job jobs/<id>

Reads <job>/audio.wav and <job>/sheet.json (an ukulele-sheet v1 file) and writes <job>/sync.json:
  - beats: score beats against beats tracked in the recording (is the grid / YouTube offset right, does it drift)
  - notes, lyrics: each melody note and lyric syllable against the nearest sung note start in the separated vocals
Times are video times (score time - youtube.offsetMs / 1000). Positive error = the recording comes later.
"""
import argparse
import json
import os

import numpy as np

from analyze import TimeMap, log, onset_times, pitch_track, segment_notes


def nearest(ts, t, win):
    if not len(ts):
        return None
    k = int(np.argmin(np.abs(ts - t)))
    d = float(ts[k] - t)
    return d if abs(d) <= win else None


def stats(errs):
    e = np.array([x for x in errs if x is not None])
    if not len(e):
        return {"n": 0}
    return {"n": int(len(e)), "missing": int(sum(x is None for x in errs)), "median_ms": round(float(np.median(e)) * 1000),
            "abs_median_ms": round(float(np.median(np.abs(e))) * 1000), "p90_abs_ms": round(float(np.percentile(np.abs(e), 90)) * 1000),
            "within_60ms": round(float(np.mean(np.abs(e) <= 0.06)), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    args = ap.parse_args()
    job = args.job
    import librosa
    import soundfile as sf
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    s = json.load(open(os.path.join(job, "sheet.json"), encoding="utf-8"))
    spb = s["stepsPerBeat"]
    tm = TimeMap(s["tempo"], spb)
    off = (s.get("youtube") or {}).get("offsetMs", 0) / 1000.0
    vt = lambda col: tm.col_to_time(col) - off

    x, sr = sf.read(os.path.join(job, "audio.wav"), always_2d=True, dtype="float32")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != 44100:
        x = np.stack([librosa.resample(x[:, c], orig_sr=sr, target_sr=44100) for c in range(2)], axis=1)
        sr = 44100
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    model = get_model("htdemucs_ft")
    model.eval()
    wav = torch.from_numpy(x.T.copy())
    ref = wav.mean(0)
    mu, sd = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        est = apply_model(model, ((wav - mu) / sd)[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    vocals = (est * sd + mu)[model.sources.index("vocals")].mean(0).numpy()
    del model, est
    log("보컬 분리 끝")

    from beat_this.inference import Audio2Beats
    beats, _ = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)(x.mean(1), sr)
    v16 = librosa.resample(vocals, orig_sr=sr, target_sr=16000)
    v22 = librosa.resample(vocals, orig_sr=sr, target_sr=22050)
    f0, per, rms = pitch_track(v16, device)
    on_t, _ = onset_times(v22)
    sung, _, _ = segment_notes(f0, per, rms, on_t)
    starts = np.array(sorted(n[1] for n in sung))
    log(f"녹음 박 {len(beats)}개, 노래 음 시작 {len(starts)}개")

    # beats: every score beat inside the recording against the nearest tracked beat
    beats = np.asarray(beats)
    total_cols = s.get("columnCount") or 0
    bar_len = 4 * spb
    beat_rows = []
    for col in range(0, total_cols, spb):
        t = vt(col)
        if 0 <= t <= x.shape[0] / sr:
            beat_rows.append((col, nearest(beats, t, 0.25)))
    notes = sorted(s["tracks"][0]["notes"], key=lambda n: n["col"]) if s.get("tracks") else []
    note_rows = [(n["col"], nearest(starts, vt(n["col"]), 0.25)) for n in notes]
    lyr_rows = [(l["col"], l["text"], nearest(starts, vt(l["col"]), 0.25)) for l in sorted(s.get("lyrics", []), key=lambda l: l["col"])]

    # per 4-bar block, so drift and bad stretches show up
    blocks = {}
    for col, d in beat_rows:
        blocks.setdefault(col // (bar_len * 4), {"beats": [], "lyrics": []})["beats"].append(d)
    for col, _, d in lyr_rows:
        blocks.setdefault(col // (bar_len * 4), {"beats": [], "lyrics": []})["lyrics"].append(d)
    per_block = []
    for k in sorted(blocks):
        b = blocks[k]
        per_block.append({"from_col": k * bar_len * 4, "video_s": round(vt(k * bar_len * 4), 2),
                          "beats": stats(b["beats"]), "lyrics": stats(b["lyrics"])})
    worst = sorted([r for r in lyr_rows if r[2] is not None], key=lambda r: -abs(r[2]))[:25]
    out = {"offsetMs": round(off * 1000), "beats": stats([d for _, d in beat_rows]), "notes": stats([d for _, d in note_rows]),
           "lyrics": stats([d for _, _, d in lyr_rows]), "blocks": per_block,
           "worst_lyrics": [{"col": c, "text": t, "err_ms": round(d * 1000)} for c, t, d in worst],
           "lyric_errors": [{"col": c, "text": t, "err_ms": None if d is None else round(d * 1000)} for c, t, d in lyr_rows],
           "sung_starts": [round(float(t), 3) for t in starts],
           # sung notes [midi, start, end] in video time, for rebuilding the melody one note per syllable
           "sung_notes": [[round(float(p), 2), round(float(a), 3), round(float(b), 3)] for p, a, b in sorted(sung, key=lambda n: n[1])]}
    json.dump(out, open(os.path.join(job, "sync.json"), "w", encoding="utf-8"), ensure_ascii=False)
    log(f"박 {out['beats']}, 음 {out['notes']}, 가사 {out['lyrics']}")


if __name__ == "__main__":
    main()
