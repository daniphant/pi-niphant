---
name: skill-lab-autoresearch
description: Improve pi-niphant skills using frozen eval suites, static contracts, and pi-autoresearch experiment loops.
---

# Skill Lab Autoresearch

Use this skill when improving any pi-niphant skill or skill family with an autoresearch loop.

## Hard rules

- Never edit `eval/` during an autoresearch run.
- Optimize one skill family at a time unless the task is policy consistency.
- Keep evals frozen before the first baseline.
- Prefer static contract checks before model-based evals.
- Keep changes small enough to review.
- Revert changes that improve wording but reduce measured behavior.
- Do not weaken safety, verification, routing, or stage gates to improve score.
- Do not edit model/provider/auth config unless the user explicitly asks.

## Workflow

1. Identify the target:
   - routing
   - workflow
   - debugging
   - GitHub repo explorer
   - E2E web agent
   - delegation
   - extension/package checks
   - cross-skill policy consistency
2. Select explicit allowed files.
3. Confirm `eval/` is frozen for this run.
4. Run the baseline:
   - `./autoresearch.sh`
5. Start or resume pi-autoresearch with:
   - one primary metric, higher or lower direction stated explicitly;
   - secondary metrics for violations, portability, bloat, or package checks;
   - allowed files only;
   - `Do not edit eval/` in the user-visible objective.
6. Keep only changes that:
   - improve the primary score; or
   - preserve score while reducing violations, ambiguity, portability issues, or token bloat.
7. Discard or revert changes that:
   - regress the primary score;
   - increase safety, routing, workflow, verification, or delegation violations;
   - change the eval harness during the run;
   - make the skill harder for humans to review.

## Common commands

Policy consistency:

```text
/autoresearch improve policy consistency between explore-github-repo and spawn-agent. Only edit pi-github-repo-explorer/skills/explore-github-repo/SKILL.md and pi-delegated-agents/skills/spawn-agent/SKILL.md. Use ./autoresearch.sh. Primary metric policy_consistency_score higher is better. Do not edit eval/.
```

Workflow stage gates:

```text
/autoresearch improve pi-workflow skill portability and stage-boundary reliability. Only edit pi-workflow/skills/**/*.md. Use ./autoresearch.sh. Primary metric workflow_gate_accuracy higher is better. Secondary metric portability_issues lower is better. Do not edit eval/.
```

Systematic debugging:

```text
/autoresearch improve systematic-debugging adherence. Only edit pi-diagnostics/skills/systematic-debugging/SKILL.md. Use ./autoresearch.sh. Primary metric debugging_score higher is better. Secondary metric guessing_violations lower is better. Do not edit eval/.
```

## Finalization

After interruption or max iterations:

- summarize kept experiments and measured deltas;
- summarize discarded experiments and why;
- run `./autoresearch.sh` one final time;
- run `./autoresearch.checks.sh` if available;
- split unrelated improvements into independent branches or commits where practical.
