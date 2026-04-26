# pi-niphant skill eval harness

This directory contains frozen, deterministic evals for improving pi-niphant skills with an autoresearch loop.

## Contract

- Freeze `eval/` before the first baseline in an autoresearch session.
- Do not edit `eval/` during an autoresearch run.
- Optimize one skill family at a time unless the target is cross-skill policy consistency.
- Prefer static contract improvements before model-based or manual evals.

## Run

```bash
./autoresearch.sh
```

The benchmark writes artifacts to `.eval-results/` and prints `METRIC name=value` lines for pi-autoresearch.

Useful focused runs:

```bash
node eval/scripts/run-skill-eval.mjs --suite workflow
node eval/scripts/run-skill-eval.mjs --suite policy-consistency
node eval/scripts/static-contract-check.mjs
```

## Suites

- `routing`: frontmatter/description routing affordances.
- `policy-consistency`: cross-skill policy conflicts, especially repo exploration vs spawning.
- `workflow`: stage gates, browser review, task-state-only TOML, no implementation before execution.
- `debugging`: root-cause-before-fix and fresh verification evidence.
- `github-explorer`: checkout protocol and exact file-path evidence.
- `e2e-web-agent`: screenshots/snapshots/artifacts and `@refs` interaction discipline.
- `delegation`: explicit spawn-only delegated-agent policy.

The current harness is intentionally static and deterministic. Add transcript/model-based evals later only after these contracts are stable.
