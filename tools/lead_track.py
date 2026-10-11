"""Take a lead guitar line (solo, riff) from a sheet's YouTube recording and add it to the sheet as its own track.

    python tools/lead_track.py "<sheet.json>" [--ranges 150-185,290-335] [--name "기타 솔로"] [--dry]

--ranges are video seconds. Without it the ranges come from the sheet's extra melody tracks (the SPRED
"반주 멜로디" track and the like): where their notes are, with 2 s around. Runs bridge/server/lead_track.py on
nurilab (guitar separated from the band, pitch tracked), then tools/add_lead.mjs puts the notes on the sheet's
columns and strings as a track marked absolute (played at the recording's pitch). The old sheet goes to 이전판.
Prints how the notes compare with the existing extra track in the same ranges.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "bridge"))
sys.path.insert(0, str(REPO / "tools"))
import transcribe as T  # noqa: E402
from sync_check import audio  # noqa: E402


def ranges_from_tracks(s):
    """video-time ranges covered by the sheet's extra tracks (not the first, sung melody)"""
    from bisect import bisect_right
    tempo = sorted(s["tempo"], key=lambda e: e["col"])
    spb = s["stepsPerBeat"]
    starts, acc = [], 0.0
    for i, e in enumerate(tempo):
        if i:
            acc += (e["col"] - tempo[i - 1]["col"]) * 60 / tempo[i - 1]["bpm"] / spb
        starts.append(acc)

    def t_of(col):
        k = bisect_right([e["col"] for e in tempo], col) - 1
        return starts[k] + (col - tempo[k]["col"]) * 60 / tempo[k]["bpm"] / spb
    off = (s.get("youtube") or {}).get("offsetMs", 0) / 1000
    ts = sorted(t_of(n["col"]) - off for t in s["tracks"][1:] if t.get("id") != "lead" for n in t["notes"])
    out = []
    for t in ts:
        if out and t - out[-1][1] < 4:
            out[-1][1] = t
        else:
            out.append([t, t])
    return [(max(0, a - 2), b + 2) for a, b in out if b - a > 3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--ranges")
    ap.add_argument("--name", default="기타 솔로 (원곡에서 자동으로 딴 것)")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    s = json.loads(Path(a.sheet).read_text(encoding="utf-8"))
    vid = (s.get("youtube") or {}).get("videoId")
    rng = [tuple(map(float, r.split("-"))) for r in a.ranges.split(",")] if a.ranges else ranges_from_tracks(s)
    if not rng:
        raise SystemExit("어느 구간을 딸지 모름: --ranges 를 주거나 반주 멜로디 트랙이 있는 악보여야 함")
    rtxt = ",".join(f"{x:.1f}-{y:.1f}" for x, y in rng)
    print("구간(영상 초):", rtxt)
    job = REPO / "bridge" / "jobs" / f"check-{vid}"
    job.mkdir(parents=True, exist_ok=True)
    wav = audio(vid, job)
    T.sync_server_scripts()
    rj = f"{T.REMOTE_DIR}/jobs/lead-{vid}"
    T.ssh(f"mkdir -p ~/{rj}", timeout=60)
    T.scp(str(wav), f"{T.HOST}:{rj}/audio.wav")
    T.ssh(f"cd ~/{T.REMOTE_DIR} && ./run.sh --lead --job jobs/lead-{vid} --ranges {rtxt}", timeout=1800, stream=True)
    T.scp(f"{T.HOST}:{rj}/lead.json", str(job / "lead.json"))
    T.scp(f"{T.HOST}:{rj}/lead_pitch.npz", str(job / "lead_pitch.npz"))
    T.ssh(f"rm -f ~/{rj}/audio.wav", timeout=60)
    cmd = ["node", str(REPO / "tools" / "add_lead.mjs"), a.sheet, str(job / "lead.json"), "--name", a.name] + (["--dry"] if a.dry else [])
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
