---
name: workflow-plan
description: Stage 3 of the Pi workflow. Create workflow.plan.md from a finalized spec or sufficient skipped-spec research route. Prompt for consensus; browser review is mandatory. Populate workflow.toml with execution task state only. Do not write implementation code.
---

# Workflow Implementation Plan

This is Stage 3. It creates `workflow.plan.md` and initializes execution state in `workflow.toml`, following the Multiverse-style split between human-readable tasks and machine-readable task state.

## Context hygiene

Do not read unrelated `SKILL.md` files, enumerate installed skills, or inspect execution skill docs while planning. Read `workflow.research.md` first; read `workflow.spec.md` only when the route requires a spec; use `workflow.plan.md` and `workflow.toml` only for plan/task-state output. Load another skill only when the user explicitly requests it or direct validation/tooling requires it.

## Hard rules

- Do not implement code.
- Update only `workflow.plan.md`, `workflow.toml`, and generated annotation/consensus artifacts.
- `workflow.plan.md` contains strategy, task graph, dependencies, validation, rollback, and review feedback.
- `workflow.toml` contains execution/task state only. Do not add spec/plan gates, browser-review status, or consensus status to TOML.
- Do not automatically run PAL consensus solely because this stage started.
- Browser annotation/user review is required for every produced plan after optional consensus is completed, declined, bypassed after failure, or skipped by route.
- Implementation plans should say what to change and how to validate it, not generate large blocks of code.

## Route guard and planning source

Read `workflow.research.md` first and inspect `## Complexity / Route Recommendation`.

Planning may proceed from either:

1. `workflow.spec.md` when the route says `Spec: required` (normally `Complexity: large`) and the spec is finalized; or
2. `workflow.research.md` when the route says `Spec: skipped - <rationale>` for `small` or `moderate` work.

Refuse with actionable missing prerequisites when:

- the route decision section or stable labels are missing;
- the route is `trivial` and `Plan: skipped` (suggest `/workflow-execute <workflow.research.md>` only if all trivial execution markers are present, otherwise suggest returning to Stage 1 or planning explicitly);
- `Spec: required` but `workflow.spec.md` is absent, empty, or lacks recorded browser review completion;
- `Spec: skipped` but research is insufficient to plan;
- neither a finalized spec nor a valid skipped-spec research route exists.

When planning from research, verify it contains enough detail to plan:

- goals or desired behavior;
- constraints/non-goals;
- acceptance criteria or expected outcome;
- validation approach;
- relevant files or code references when known.

If research is insufficient, stop and ask targeted questions or tell the user to return to Stage 1. Do not fabricate a plan.

## Process

1. Read `workflow.research.md`, existing `workflow.plan.md`, and `workflow.spec.md` only if the route requires spec.
2. Apply the route guard and choose the planning source.
3. Inspect only the code needed to plan accurately. Do not over-explore.
4. Draft `workflow.plan.md`.
5. If planning from research, record clearly in the plan that spec was intentionally skipped by the Stage 1 complexity decision, including the rationale.
6. Prompt for optional consensus according to route:
   - `available_on_request`: mention consensus is available but not recommended by default.
   - `prompt_after_plan`: ask whether to run consensus before mandatory browser review.
   - `prompt_after_spec_and_plan`: ask whether to run plan consensus before mandatory browser review.
   Make clear that consensus is optional and browser review is mandatory.
7. If consensus is declined, proceed to browser review. If consensus fails below threshold or reports provider/tool errors, report the failure and ask whether to retry consensus, bypass to browser review, or stop.
8. Run mandatory browser annotation review on `workflow.plan.md`.
9. Apply every browser annotation/edit/deletion/general comment.
10. Populate `workflow.toml` with execution task state only.

## Required plan contents

### Strategy

Describe the implementation approach and sequencing.

### Source / Route Decision

Record the route source used for planning:

- spec path if planning from spec; or
- research path plus the explicit `Spec: skipped - <rationale>` line if planning from research.

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

## Optional PAL sidecar consensus

When the user confirms consensus, run `run_pal_consensus_review` before browser review. Pass `planText` containing frozen context plus the full plan, or `planFile` if the plan file itself is ready to review:

```text
run_pal_consensus_review({
  title: "Workflow Implementation Plan Review",
  stackId: "auto",
  wait: true,
  planText: "Review this frozen implementation plan before coding. Identify dependency mistakes, unsafe parallelization, missing validation, missing rollback steps, over-specific code generation, under-specified tasks, and likely blockers. Return blocking issues first, then recommended revisions.\n\n<context>...brief spec/research summary, relevant files, constraints...</context>\n\n<implementation_plan>...the full workflow.plan.md...</implementation_plan>"
})
```

Use the returned PAL sidecar details, especially `details.findings` when available. Then read/summarize the artifact files, not only the tool status:

- `findings.json` (`details.run.findingsPath` or returned `findingsPath`) for recommendation, reviewer success, warnings, failed reviewers, and blocking/suggestion/question lists.
- `findings-summary.md` in the same artifact directory for the normalized human-readable summary.
- per-reviewer artifacts only when needed to understand a finding.

Record sidecar evidence in `## Consensus Feedback` only if consensus was run, citing artifact paths:

- `run_id`
- `artifactDir`
- `findingsPath`
- `findings-summary.md` path
- selected `stackId` and whether it was `auto`
- `recommendation`
- reviewer success count
- warnings and failed reviewers
- blocking findings status: resolved, or explicitly deferred with rationale/risk/owner
- concise required revisions

If `recommendation` is `revise` or `blocking_findings` is non-empty, update `workflow.plan.md` before browser review or explicitly record any deferral. Do not advance toward implementation while blocking findings are unhandled. If the run status is failed, partial below threshold, or structured errors indicate timeout, rate limit, missing provider key, auth failure, missing/unavailable model, invalid reviewer config, or insufficient successful reviewers, preserve the artifact/error details and ask whether to retry, switch stack, fix configuration, bypass to browser review, or stop; do not claim consensus passed.

## Mandatory browser annotation / user review

Run browser review on the plan file only. Do **not** search the filesystem with `find`, `rg`, or `mdfind` to locate the review server. Use this deterministic launcher-root/install-root snippet:

```bash
WORKFLOW_EXT="${NIPHANT_LAUNCHER_ROOT:+$NIPHANT_LAUNCHER_ROOT/pi-workflow}"
if [ -z "$WORKFLOW_EXT" ]; then
  WORKFLOW_EXT="$(readlink "$HOME/.pi/agent/extensions/pi-workflow")"
fi
node "$WORKFLOW_EXT/server/server.mjs" "<workflow.plan.md>"
```

`NIPHANT_LAUNCHER_ROOT` is set by `ni`. The symlink fallback supports plain Pi sessions using the installed `pi-workflow` extension. If both are unavailable, stop and tell the user to run `/workflow-review <workflow.plan.md>` instead of searching broad directories.

After `PLAN_REVIEW_COMPLETE:<annotations-file>`:

1. Read annotations.
2. Apply every requested change to `workflow.plan.md`.
3. If annotations say `No Changes`, no markdown change is needed beyond recording review completion.
4. Summarize browser feedback in `## Browser Review Feedback` without turning it into gate/state checkboxes:
   - ISO timestamp or annotation artifact path
   - result: `changes_applied` or `no_changes`
   - concise summary

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

Tell the user in natural prose that the implementation plan is finalized and execution is next. Include both immediate continuation (reply exactly `continue` to let `/workflow-continue` advance in the current session) and `/clear` resume options. Put only the concrete command in a code block:

```text
/workflow-execute <workflow-directory-or-workflow.toml>
```
