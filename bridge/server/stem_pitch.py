#!/usr/bin/env python
"""Pitch of each separated part of a recording, to pick the melody of an instrumental piece (nurilab server).

    python stem_pitch.py --job jobs/<id> [--stems vocals,other,piano,guitar]

Reads <job>/audio.wav, separates it (demucs htdemucs_6s: drums, bass, other, vocals, guitar, piano), tracks the
pitch of each listed part (crepe, 10 ms) and writes <job>/stem_pitch.npz: for each part <name>_f0, <name>_per,
<name>_rms, and <job>/stem_<name>.wav at 16 kHz to listen to. In an instrumental the melody instrument (a violin,
a synth lead) lands in whichever part sounds most like it, so the choice is made afterwards from these.
"""
import argparse
import os

import numpy as np

from analyze import log, pitch_track


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--stems", default="vocals,other,piano,guitar")
    args = ap.parse_args()
    import librosa
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    device = "cuda" if torch.cuda.is_available() else "cpu"
    x, sr = sf.read(os.path.join(args.job, "audio.wav"), always_2d=True, dtype="float32")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != 44100:
        x = np.stack([librosa.resample(x[:, c], orig_sr=sr, target_sr=44100) for c in range(2)], axis=1)
        sr = 44100
    log(f"오디오 {x.shape[0] / sr:.1f}초 읽음 ({device})")
    model = get_model("htdemucs_6s")
    model.eval()
    wav = torch.from_numpy(x.T.copy())
    ref = wav.mean(0)
    mu, sd = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        est = apply_model(model, ((wav - mu) / sd)[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    est = est * sd + mu
    log(f"분리 끝: {model.sources}")
    out = {}
    for name in args.stems.split(","):
        stem = est[model.sources.index(name)].mean(0).numpy()
        s16 = librosa.resample(stem, orig_sr=sr, target_sr=16000)
        sf.write(os.path.join(args.job, f"stem_{name}.wav"), s16, 16000)
        f0, per, rms = pitch_track(s16, device, fmin=120.0, fmax=2000.0)
        out[f"{name}_f0"], out[f"{name}_per"], out[f"{name}_rms"] = f0, per, rms
        log(f"{name}: 음높이 있는 비율 {np.mean(per > 0.5):.2f}, 소리 크기 {np.sqrt(np.mean(s16 ** 2)):.4f}")
    np.savez_compressed(os.path.join(args.job, "stem_pitch.npz"), **out)
    log("완료")


if __name__ == "__main__":
    main()
