#!/usr/bin/env bash
set -euo pipefail

npm run check

if git diff --name-only | grep -E '^eval/'; then
  echo "Do not modify eval/ during autoresearch. Freeze evals before the first baseline."
  exit 1
fi

node eval/scripts/static-contract-check.mjs --frontmatter-only
node eval/scripts/static-contract-check.mjs --max-skill-words=1800 > .eval-results/static.checks.json

if [[ "${STRICT_PORTABILITY:-0}" == "1" ]]; then
  if grep -R "/Users/" pi/pi-*/skills/**/*.md 2>/dev/null; then
    echo "Skill docs must not contain user-local absolute paths."
    exit 1
  fi
fi
