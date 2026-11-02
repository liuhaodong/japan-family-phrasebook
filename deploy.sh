#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "${1:-Update Japan Family Phrasebook}"
fi
git push origin main
echo "✅ Published to GitHub Pages!"
