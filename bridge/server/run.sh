#!/usr/bin/env bash
# Entry point used by the local bridge: run.sh --job jobs/<id> [analyze.py options]
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env_ready ]; then
  echo "[setup] 분석 환경이 없어 설치부터 함 (10분쯤 걸림)"
  bash ./setup_env.sh >> setup.log 2>&1 || { echo "ENV_SETUP_FAILED (setup.log 확인)"; exit 3; }
fi
. .venv/bin/activate
LIBS="$(python - <<'EOF'
import importlib, os
out = []
for m in ("nvidia.cudnn", "nvidia.cublas"):
    try:
        mod = importlib.import_module(m)
        p = list(getattr(mod, "__path__", []))
        if p:
            out.append(os.path.join(p[0], "lib"))
    except Exception:
        pass
print(":".join(out))
EOF
)"
export LD_LIBRARY_PATH="${LIBS}:${LD_LIBRARY_PATH:-}"
export PYTHONUNBUFFERED=1 OMP_NUM_THREADS=8 MKL_NUM_THREADS=8 TOKENIZERS_PARALLELISM=false
exec python analyze.py "$@"
