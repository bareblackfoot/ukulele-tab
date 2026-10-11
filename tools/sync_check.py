"""Check how well finished sheets line up with their YouTube recording (beats, melody notes, lyric syllables).

    python tools/sync_check.py "<sheet.uke.json>" [...]

For each sheet: downloads the audio of its youtube.videoId into bridge/jobs/check-<id>/audio.wav (kept for
later runs), runs bridge/server/sync_check.py on nurilab and saves the report as bridge/jobs/check-<id>/sync.json.
"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "bridge"))
import transcribe as T  # noqa: E402  (ssh/scp/yt-dlp helpers)


def audio(vid, job):
    wav = job / "audio.wav"
    if wav.exists():
        return wav
    ytdlp = T.tool("yt-dlp", [r"%USERPROFILE%\miniconda3\Scripts\yt-dlp.exe"])
    ffmpeg = T.tool("ffmpeg", [r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin\ffmpeg.exe"])
    node = shutil.which("node")
    js = ["--js-runtimes", f"node:{node}"] if node else []
    url = f"https://www.youtube.com/watch?v={vid}"
    for extra in ([], ["--extractor-args", "youtube:player_client=mweb"]):
        r = T.run([ytdlp, *js, *extra, "--no-playlist", "-f", "bestaudio/best", "-o", str(job / "dl.%(ext)s"),
                   "--ffmpeg-location", str(Path(ffmpeg).parent), url], timeout=900, capture=True, check=False)
        if r.returncode == 0:
            break
        for f in job.glob("dl.*"):
            f.unlink()
    src = next(iter(job.glob("dl.*")), None)
    if not src:
        raise SystemExit(f"{vid}: 오디오를 못 받음")
    T.run([ffmpeg, "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(wav)], timeout=600, capture=True)
    src.unlink()
    return wav


def check(sheet_path):
    s = json.loads(Path(sheet_path).read_text(encoding="utf-8"))
    vid = (s.get("youtube") or {}).get("videoId")
    if not vid:
        raise SystemExit(f"{sheet_path}: 유튜브 영상 정보 없음")
    job = REPO / "bridge" / "jobs" / f"check-{vid}"
    job.mkdir(parents=True, exist_ok=True)
    wav = audio(vid, job)
    (job / "sheet.json").write_text(json.dumps(s, ensure_ascii=False), encoding="utf-8")
    rj = f"{T.REMOTE_DIR}/jobs/check-{vid}"
    T.ssh(f"mkdir -p ~/{rj}", timeout=60)
    T.scp(str(wav), f"{T.HOST}:{rj}/audio.wav")
    T.scp(str(job / "sheet.json"), f"{T.HOST}:{rj}/sheet.json")
    T.ssh(f"cd ~/{T.REMOTE_DIR} && ./run.sh --sync-check --job jobs/check-{vid}", timeout=1800, stream=True)
    T.scp(f"{T.HOST}:{rj}/sync.json", str(job / "sync.json"))
    T.ssh(f"rm -f ~/{rj}/audio.wav", timeout=60)
    r = json.loads((job / "sync.json").read_text(encoding="utf-8"))
    print(f"{s['meta'].get('title')} ({vid}) offset {r['offsetMs']} ms")
    for k in ("beats", "notes", "lyrics"):
        print(f"  {k}: {r[k]}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    T.sync_server_scripts()
    for p in sys.argv[1:]:
        check(p)
