---
name: workflow-implement
description: Stage 4 of the Pi workflow. Execute a finalized workflow plan or explicitly trivial research-only workflow. Preferred command is /workflow-execute; /workflow-implement is a thin alias. Run diagnostics/tests and summarize results.
---

# Workflow Execute / Implement

This is Stage 4. The preferred user-facing command is `/workflow-execute`. `/workflow-implement` remains a thin alias with identical behavior.

Execution supports two sources:

1. Planned workflows: `workflow.plan.md` + `workflow.toml`.
2. Explicitly trivial research-only workflows: `workflow.research.md` only when all trivial skip markers are present.

Do not rely on `workflow.spec.md` during execution. The plan must carry the requirements needed for planned work.

## Context hygiene

Do not read unrelated `SKILL.md` files, enumerate installed skills, or inspect other workflow-stage skill docs during execution. For planned workflows, read `workflow.toml` first and `workflow.plan.md` second; do not read `workflow.spec.md` or `workflow.research.md` for context. For explicitly trivial research-only workflows, read `workflow.research.md` only to verify the required markers and execute the approved tiny change. Load another skill only when the user explicitly requests it or direct validation/tooling requires it.

## Rules

- For planned workflows, read `workflow.toml` first to assess execution state, then read `workflow.plan.md` as the authoritative implementation instructions.
- Use `workflow.toml` only as machine-readable task status/dependencies.
- Do not read or depend on `workflow.spec.md` for execution decisions.
- Do not automatically use subagents for parallel groups. Parallel grouping is planning metadata unless the user explicitly asks for delegation.
- Update task status in `workflow.toml` as work progresses for planned workflows.
- Do not create or maintain a separate execution markdown log.
- Continuous auto-commit checkpoints are expected by default when `pi-checkpoint` is installed. Do not fight them; use them as recovery points. The extension never pushes.

## Planned workflow prerequisites

For planned workflows, refuse before implementation if:

- `workflow.plan.md` is missing or empty;
- `workflow.toml` is missing or lacks task entries;
- `workflow.plan.md` does not record mandatory browser review completion for the plan;
- all task dependencies cannot be resolved;
- there is no executable pending task and no clear completed state.

The refusal should list missing/invalid prerequisites and suggest the next command, usually `/workflow-plan <workflow>`.

## Trivial research-only prerequisites

Research-only execution is allowed only when `workflow.research.md` includes every marker below in `## Complexity / Route Recommendation`:

- `Complexity: trivial`
- `Spec: skipped`
- `Plan: skipped`
- `Consensus: none`
- `Browser review: skipped_for_trivial`
- `Execution source: research`
- `Trivial execution approved: true`
- `Workflow task tracking: skipped_for_trivial`

If any marker is absent or incompatible, refuse and list each missing/invalid marker. Suggest `/workflow-plan <workflow>` as the safer route.

For trivial direct execution, also make sure the user has confirmed the route and understands:

```text
This skips spec, plan, consensus, browser review, and workflow task tracking.
```

Because workflow task tracking is skipped for trivial execution, do not invent `workflow.toml` tasks. Summarize what changed and what validation ran.

## workflow.toml task state schema

```toml
[[tasks]]
id = "T1"
name = "Short task title"
status = "pending" # pending | in_progress | completed | failed | skipped
dependencies = []
parallel_group = "A"
files = ["path/to/file.ts"]
validation = ["npm test"]
started_at = "2026-04-24T12:00:00Z"
completed_at = "2026-04-24T12:10:00Z"
commit_sha = "abc1234"
error = ""
```

## Planned workflow process

1. Read `workflow.toml`.
2. Read `workflow.plan.md`.
3. Verify plan browser review completion and task consistency.
4. Choose the first executable task:
   - `status = "pending"`
   - all dependencies have `status = "completed"`
5. Before starting a task, update `workflow.toml`:
   - `status = "in_progress"`
   - `started_at = <current ISO timestamp>`
   - update top-level `updated_at`
6. Execute the task using only plan context and necessary code inspection.
7. Run task-specific validation.
8. On success, update `workflow.toml`:
   - `status = "completed"`
   - `completed_at = <current ISO timestamp>`
   - `commit_sha = <sha>` if there is a relevant local commit
   - update top-level `updated_at`
9. On failure, update `workflow.toml`:
   - `status = "failed"`
   - `error = <concise error>`
   - update top-level `updated_at`
10. After all tasks:
   - run `get_project_diagnostics` if available
   - run project tests/lint/typecheck/build as applicable
   - run browser/E2E validation with `run_web_e2e` or `run_agent_browser` if UI/web behavior changed
   - update task state for any validation/finalization tasks
11. Summarize:
   - files changed
   - task statuses
   - validation run
   - failures/residual risks
   - next steps

## Trivial research-only process

1. Read `workflow.research.md`.
2. Verify every trivial marker exactly.
3. Refuse with missing markers if verification fails.
4. Implement only the small, localized change described by research.
5. Run the obvious validation for the change.
6. Summarize changes and validation. Do not update `workflow.toml` unless correcting broken file references.

## State invariants

- Only one task should be `in_progress` in a single-agent execution session.
- A task cannot start until all dependencies are `completed` unless the user explicitly overrides.
- `completed_at` must be after `started_at`.
- `commit_sha` should only be set for completed tasks.

## Post-execution review

If user asks for final consensus or independent review, use `run_pal_consensus_review` on a frozen diff/summary. Do not ask reviewers to explore the repo; pass the exact frozen context as `planText` or a reviewed artifact as `planFile`.

When PAL sidecar review is run, summarize:

- `run_id`
- `artifactDir`
- `findingsPath`
- `recommendation`
- reviewer success count
- warnings
- failed reviewers
- required follow-up changes

If the sidecar returns structured errors or insufficient successful reviewers, report that explicitly and do not claim independent review passed.
