---
name: workflow-implement
description: Stage 4 of the Pi workflow. Implement from a finalized workflow.md task graph, update execution log, run diagnostics/tests, run browser/E2E validation when relevant, and summarize results.
---

# Workflow Implement

This is Stage 4. It implements from the finalized workflow file.

## Rules

- Read the workflow file first.
- Verify spec and implementation plan are finalized or user explicitly says to proceed.
- Use the workflow file as source of truth.
- Implement task-by-task in dependency order.
- Do not automatically use subagents for parallel groups. Parallel grouping is planning metadata unless the user explicitly asks for delegation.
- Update `# 4. Execution Log` as work progresses.
- Continuous auto-commit checkpoints are expected by default when `pi-checkpoint` is installed. Do not fight them; use them as recovery points. The extension never pushes.

## Process

1. Read workflow file.
2. Confirm Stage Gates for spec and implementation plan.
3. Check `/checkpoint-mode status` if checkpoint behavior matters. If continuous mode is active, each Pi turn should create local WIP commits when changes exist.
4. Execute tasks in dependency order.
5. For each task:
   - read files listed in its context block
   - modify only necessary files
   - run task-specific validation
   - update Task Status table
6. After all tasks:
   - run `get_project_diagnostics` if available
   - run project tests/lint/typecheck/build as applicable
   - run browser/E2E validation with `run_web_e2e` or `run_agent_browser` if UI/web behavior changed
   - update Diagnostics and E2E sections
7. Summarize:
   - files changed
   - validation run
   - failures/residual risks
   - next steps

## Post-execution review

If user asks for final consensus or independent review, use `run_consensus` on a frozen diff/summary. Do not ask consensus models to explore the repo.

## Exit

Update Stage Gates:

- [x] Implementation executed
- [x] Diagnostics/test validation complete
- [x] Browser/E2E validation complete or explicitly skipped
- [x] Post-execution review/retro complete, if performed
