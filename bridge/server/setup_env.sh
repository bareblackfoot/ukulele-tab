#!/usr/bin/env bash
# One-time setup of the GPU analysis environment on the nurilab server.
# Creates ~/ukulele_transcribe/.venv and downloads the model weights, then writes .env_ready.
# Safe to re-run: it reuses what is already installed.
set -euo pipefail
cd "$(dirname "$0")"
UV="$HOME/.local/bin/uv"
export UV_LINK_MODE=copy

[ -d .venv ] || "$UV" venv -q -p 3.11 .venv
. .venv/bin/activate

# torch 2.7.1 + cu128 is the combination that worked with demucs on this RTX 5090 (2026-10-11)
"$UV" pip install -q torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
"$UV" pip install -q demucs librosa torchcrepe soundfile scipy numpy faster-whisper \
    einops rotary-embedding-torch soxr "beat_this @ git+https://github.com/CPJKU/beat_this.git"

python - <<'EOF'
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available())
from demucs.pretrained import get_model
get_model("htdemucs_ft")
print("demucs htdemucs_ft ok")
from beat_this.inference import File2Beats
File2Beats(checkpoint_path="final0", device="cuda", dbn=False)
print("beat_this ok")
import torchcrepe  # weights ship with the package
print("torchcrepe ok")
EOF

# faster-whisper (CTranslate2) needs the cuDNN/cuBLAS libraries that came with torch
NV="$(python -c 'import nvidia, os; print(os.path.dirname(nvidia.__file__))' 2>/dev/null || true)"
export LD_LIBRARY_PATH="${NV}/cudnn/lib:${NV}/cublas/lib:${LD_LIBRARY_PATH:-}"
python - <<'EOF'
from faster_whisper import WhisperModel
WhisperModel("large-v3", device="cuda", compute_type="float16")
print("faster-whisper large-v3 ok")
EOF

date -Iseconds > .env_ready
echo "ENV READY"
