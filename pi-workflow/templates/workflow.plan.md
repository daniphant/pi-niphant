# Implementation Plan: {{title}}

- **Workflow ID:** `{{id}}`
- **Spec:** `workflow.spec.md`
- **Execution State:** `workflow.toml`

---

## Strategy

## Task Graph

> Use task IDs with dependencies. Mark tasks as parallel-safe only when they do not modify the same files or depend on each other. Stage 3 must mirror the final task graph into `workflow.toml` `[[tasks]]` entries with `status = "pending"`.

| Task | Description | Dependencies | Parallel Group | Files | Validation |
|------|-------------|--------------|----------------|-------|------------|

## Sequential / Blocking Tasks

## Parallelizable Tasks

## Blocked Tasks / Blockers

## Validation Plan

## Rollback Plan

## Browser Review Feedback

## Consensus Feedback
