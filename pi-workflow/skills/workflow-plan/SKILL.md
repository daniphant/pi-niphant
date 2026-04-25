---
name: workflow-plan
description: Stage 3 of the Pi workflow. Create a focused workflow.plan.md task graph, then automatically run multi-model consensus before browser annotation/user review. Populate workflow.toml with execution task state only. Do not write implementation code.
---

# Workflow Implementation Plan

This is Stage 3. It creates `workflow.plan.md` and initializes execution state in `workflow.toml`, following the Multiverse-style split between human-readable tasks and machine-readable task state.

## Hard rules

- Do not implement code.
- Update only `workflow.plan.md`, `workflow.toml`, and generated annotation/consensus artifacts.
- `workflow.plan.md` contains strategy, task graph, dependencies, validation, rollback, and review feedback.
- `workflow.toml` contains execution/task state only. Do not add spec/plan gates, browser-review status, or consensus status to TOML.
- Multi-model consensus is automatic and required unless the user explicitly says to skip it in this stage request.
- Browser annotation/user review is automatic and required after consensus revisions are applied.
- Implementation plans should say what to change and how to validate it, not generate large blocks of code.

## Process

1. Read `workflow.spec.md` and existing `workflow.plan.md`.
2. Confirm the spec is finalized enough to plan, or the user explicitly says to proceed.
3. Inspect only the code needed to plan accurately. Do not over-explore.
4. Draft `workflow.plan.md`.

## Required plan contents

### Strategy

Describe the implementation approach and sequencing.

### Task Graph

Every task must include:
- Task ID
- Description
- Dependencies
- Parallel group
- Files to create/modify/reference
- Validation commands
- Risk/debug hints for complex tasks

Rules:
- No subtasks like T1.1. Use T1, T2, T3.
- Tasks should be atomic and independently understandable.
- Parallel tasks must not modify the same files and must not depend on each other.
- If tasks share files, make them sequential.
- Every logic change needs validation/tests.
- Include rollback plan.

### Parallel / Blocked Clarity

Explicitly include:
- Sequential / Blocking Tasks
- Parallelizable Tasks
- Blocked tasks and their blockers

## Automatic PAL sidecar consensus

After drafting the implementation plan, run `run_pal_consensus_review` before asking the user for browser review. Pass `planText` containing frozen context plus the full plan, or `planFile` if the plan file itself is ready to review:

```text
run_pal_consensus_review({
  title: "Workflow Implementation Plan Review",
  stackId: "auto",
  wait: true,
  planText: "Review this frozen implementation plan before coding. Identify dependency mistakes, unsafe parallelization, missing validation, missing rollback steps, over-specific code generation, under-specified tasks, and likely blockers. Return blocking issues first, then recommended revisions.\n\n<context>...brief spec summary, relevant files, constraints...</context>\n\n<implementation_plan>...the full workflow.plan.md...</implementation_plan>"
})
```

Use the returned PAL sidecar details, especially `details.findings` when available. Record the sidecar evidence in `## Consensus Feedback` with:

- `run_id`
- `artifactDir`
- `findingsPath`
- `recommendation`
- reviewer success count
- warnings
- failed reviewers
- concise required revisions

If `recommendation` is `revise`, update `workflow.plan.md` before browser review. If the run status is failed, partial below threshold, or structured errors indicate missing provider/model/tool issues, stop and report the sidecar error instead of proceeding as if consensus passed. Do not add gate/state checkboxes, and do not store consensus state in `workflow.toml`.

## Automatic browser annotation / user review

After consensus revisions are applied, run browser review on the plan file only:

```bash
node /Users/daniphant/Projects/pi-extensions/pi-workflow/server/server.mjs "<workflow.plan.md>"
```

After `PLAN_REVIEW_COMPLETE:<annotations-file>`:

1. Read annotations.
2. Apply every requested change to `workflow.plan.md`.
3. Summarize browser feedback in `## Browser Review Feedback` without turning it into gate/state checkboxes.

## Initialize execution state in workflow.toml

After the final plan is ready, update `workflow.toml` from the final task graph. Preserve top-level metadata and write one `[[tasks]]` table per task:

```toml
[[tasks]]
id = "T1"
name = "Short task title"
status = "pending"
dependencies = []
parallel_group = "A"
files = ["path/to/file.ts"]
validation = ["npm test"]
```

Rules:
- All tasks start as `pending`.
- Dependencies must reference valid task IDs.
- No circular dependencies.
- Do not include review/consensus/spec gates in TOML.

## Exit

Tell the user:

```text
Implementation plan is finalized. Run /clear if you want a clean context, then run:
/workflow-implement <workflow-directory-or-workflow.toml>
```
