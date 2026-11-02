#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
git config http.postBuffer 524288000
if [ -f "scripts/generate_neural_audio.py" ]; then
  python3 scripts/generate_neural_audio.py
fi
git add -A
if ! git diff --cached --quiet; then
  git commit -m "${1:-Update Japan Family Phrasebook}"
fi
git push origin main
echo "✅ Published to GitHub Pages: https://liuhaodong.github.io/japan-family-phrasebook/"
