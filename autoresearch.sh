#!/usr/bin/env bash
set -euo pipefail

mkdir -p .eval-results

npm run check > .eval-results/npm-check.log 2>&1

node eval/scripts/scan-skills.mjs \
  > .eval-results/skill-registry.actual.json

node eval/scripts/static-contract-check.mjs \
  > .eval-results/static.json

node eval/scripts/run-skill-eval.mjs --suite "${AUTORESEARCH_SUITE:-all}" \
  > .eval-results/behavior.json

node eval/scripts/score-results.mjs \
  .eval-results/static.json \
  .eval-results/behavior.json
