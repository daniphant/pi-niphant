---
name: workflow-implement
description: Stage 4 of the Pi workflow. Implement from finalized workflow.plan.md tasks, using workflow.toml as execution/task state. Run diagnostics/tests and summarize results.
---

# Workflow Implement

This is Stage 4. It implements from `workflow.plan.md` and uses `workflow.toml` as the execution state file.

## Rules

- Read `workflow.toml` first to assess execution state.
- Read `workflow.plan.md` for task instructions and `workflow.spec.md` for acceptance criteria as needed.
- Use `workflow.plan.md` as the human-readable source of task instructions.
- Use `workflow.toml` as the machine-readable source of task status/dependencies.
- Do not automatically use subagents for parallel groups. Parallel grouping is planning metadata unless the user explicitly asks for delegation.
- Update task status in `workflow.toml` as work progresses.
- Do not create or maintain a separate execution markdown log.
- Continuous auto-commit checkpoints are expected by default when `pi-checkpoint` is installed. Do not fight them; use them as recovery points. The extension never pushes.

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

## Process

1. Read `workflow.toml`.
2. Read `workflow.plan.md` and `workflow.spec.md` as needed.
3. Choose the first executable task:
   - `status = "pending"`
   - all dependencies have `status = "completed"`
4. Before starting a task, update `workflow.toml`:
   - `status = "in_progress"`
   - `started_at = <current ISO timestamp>`
   - update top-level `updated_at`
5. Execute the task using its plan context.
6. Run task-specific validation.
7. On success, update `workflow.toml`:
   - `status = "completed"`
   - `completed_at = <current ISO timestamp>`
   - `commit_sha = <sha>` if there is a relevant local commit
   - update top-level `updated_at`
8. On failure, update `workflow.toml`:
   - `status = "failed"`
   - `error = <concise error>`
   - update top-level `updated_at`
9. After all tasks:
   - run `get_project_diagnostics` if available
   - run project tests/lint/typecheck/build as applicable
   - run browser/E2E validation with `run_web_e2e` or `run_agent_browser` if UI/web behavior changed
   - update task state for any validation/finalization tasks
10. Summarize:
   - files changed
   - task statuses
   - validation run
   - failures/residual risks
   - next steps

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
