# Changelog

## Unreleased

### Added

- Added a repo-level skill eval harness for routing, policy consistency, workflow gates, debugging, GitHub repo exploration, E2E/browser behavior, delegation, smoke checks, and holdout checks.
- Added `autoresearch.sh` and `autoresearch.checks.sh` guardrails for future pi-autoresearch skill optimization runs.
- Added `pi-skill-lab` with the `skill-lab-autoresearch` skill for frozen-eval, per-skill-family improvement loops.
- Added npm scripts for skill checks and holdout validation:
  - `npm run check:skills`
  - `npm run eval:skills`
  - `npm run eval:holdout`

### Improved

- Tightened delegation policy consistency between GitHub repo exploration and explicit subagent orchestration.
- Improved workflow stage-gate portability by avoiding local-machine browser-review paths in workflow skill docs.
- Strengthened the release process around skill changes by making smoke skill checks part of `npm run check`.

### Guardrails

- Eval files should be frozen before autoresearch baselines and must not be edited during an autoresearch run.
- Skill docs must not contain user-local absolute paths.
- Skill changes should pass static contract checks, smoke checks, and holdout evals before merge.
