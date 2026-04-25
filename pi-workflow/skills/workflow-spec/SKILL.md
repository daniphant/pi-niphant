---
name: workflow-spec
description: Stage 2 of the Pi workflow. Convert research into a focused workflow.spec.md file, then automatically run multi-model consensus before browser annotation/user review. Do not write implementation code.
---

# Workflow Spec

This is Stage 2. It converts `workflow.research.md` into a focused, reviewable `workflow.spec.md`.

## Hard rules

- Do not implement code.
- Update only `workflow.spec.md` and generated annotation/consensus artifacts.
- Do not use `workflow.toml` for spec status/gates; it is execution/task state only.
- Multi-model consensus is automatic and required unless the user explicitly says to skip it in this stage request.
- Browser annotation/user review is automatic and required after consensus revisions are applied.
- Use consensus on frozen text only; do not ask consensus models to explore the repo.

## Inputs

The command should provide a workflow bundle path and concrete file paths. If not, use the latest workflow bundle under `~/.pi/agent/workflows/*/`.

For split workflows, read:

- `workflow.research.md`
- `workflow.spec.md`

## Process

1. Read `workflow.research.md` and existing `workflow.spec.md`.
2. Draft or revise `workflow.spec.md` with:
   - Summary
   - Functional Requirements
   - Non-Functional Requirements
   - UX/API/Data Requirements as applicable
   - Acceptance Criteria
   - Out of Scope
   - Risks and Mitigations
   - Reference implementations / quality anchors
3. Save only the spec markdown.

## Automatic PAL sidecar consensus

After drafting the spec, run `run_pal_consensus_review` before asking the user for browser review. Pass `planText` containing frozen context plus the full spec, or `planFile` if the spec file itself is ready to review:

```text
run_pal_consensus_review({
  title: "Workflow Spec Review",
  stackId: "auto",
  wait: true,
  planText: "Review this frozen pre-implementation spec. Identify missing requirements, contradictions, unclear acceptance criteria, hidden risks, and implementation blockers. Return blocking issues first, then recommended revisions.\n\n<context>...brief research summary and relevant file paths...</context>\n\n<spec>...the full workflow.spec.md...</spec>"
})
```

Use the returned `findings.json` and reviewer artifacts. Apply all required changes to `workflow.spec.md`. Summarize consensus feedback in `## Consensus Feedback` without adding gate/state checkboxes.

## Automatic browser annotation / user review

After consensus revisions are applied, run the browser review server on the spec file only:

```bash
node /Users/daniphant/Projects/pi-extensions/pi-workflow/server/server.mjs "<workflow.spec.md>"
```

Tell the user the browser is open and wait for the command to complete. After it emits `PLAN_REVIEW_COMPLETE:<annotations-file>`:

1. Read the annotations file.
2. Apply every edit, deletion, annotation, and general comment to `workflow.spec.md`.
3. If annotations say `No Changes`, no markdown change is needed.
4. Summarize browser feedback in `## Browser Review Feedback` without turning it into gate/state checkboxes.

## Exit

Tell the user:

```text
Spec is finalized. Run /clear if you want a clean context, then run:
/workflow-plan <workflow-directory-or-workflow.toml>
```
