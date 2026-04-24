---
name: workflow-plan
description: Stage 3 of the Pi workflow. Create an implementation plan/task graph from the finalized spec, then automatically run browser annotation review and multi-model consensus before finalizing. Do not write implementation code.
---

# Workflow Implementation Plan

This is Stage 3. It creates the implementation plan and task graph.

## Hard rules

- Do not implement code.
- Update only the workflow markdown file and generated annotation/consensus artifacts.
- Browser annotation review is automatic and required.
- Multi-model consensus is automatic and required unless the user explicitly says to skip it in this stage request.
- Implementation plans should say what to change and how to validate it, not generate large blocks of code.

## Process

1. Read the workflow file.
2. Confirm `# 2. Spec` is finalized or the user explicitly says to proceed.
3. Inspect only the code needed to plan accurately. Do not over-explore.
4. Draft `# 3. Implementation Plan`.

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

## Automatic browser annotation review

After drafting the implementation plan, run:

```bash
node /Users/daniphant/Projects/pi-extensions/pi-workflow/server/server.mjs "<workflow-file>"
```

After `PLAN_REVIEW_COMPLETE:<annotations-file>`:

1. Read annotations.
2. Apply every requested change to the implementation plan.
3. Update `## Implementation Plan Review Annotations`.

## Automatic consensus

After browser-review changes, run `run_consensus` on frozen context:

```text
Review this frozen implementation plan before coding. Identify dependency mistakes, unsafe parallelization, missing validation, missing rollback steps, over-specific code generation, under-specified tasks, and likely blockers. Return blocking issues first, then recommended revisions.

<context>
[brief spec summary, relevant files, constraints]
</context>

<implementation_plan>
[the full # 3. Implementation Plan section]
</implementation_plan>
```

Default models:
- `openai-codex/gpt-5.5`
- `zai/glm-5.1`

Apply all required consensus changes. Update `## Implementation Plan Consensus`.

## Exit

When finalized, update Stage Gates:

- [x] Implementation plan drafted
- [x] Implementation plan browser review complete
- [x] Implementation plan consensus complete or explicitly skipped
- [x] Implementation plan finalized

Then tell the user:

```text
Implementation plan is finalized. Run /clear if you want a clean context, then run:
/workflow-implement <workflow-file>
```
