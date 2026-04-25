---
name: workflow-spec
description: Stage 2 of the Pi workflow. Convert research into workflow.spec.md only when the recorded route requires spec or the user explicitly overrides. Prompt for consensus; browser review is mandatory. Do not write implementation code.
---

# Workflow Spec

This is Stage 2. It converts `workflow.research.md` into a focused, reviewable `workflow.spec.md` when the route decision requires a spec.

## Hard rules

- Do not implement code.
- Update only `workflow.spec.md` and generated annotation/consensus artifacts.
- Do not use `workflow.toml` for spec status/gates; it is execution/task state only.
- Do not automatically run PAL consensus solely because this stage started.
- Browser annotation/user review is required for every produced spec after optional consensus is completed, declined, bypassed after failure, or skipped by route.
- Use consensus on frozen text only; do not ask consensus models to explore the repo.

## Inputs

The command should provide a workflow bundle path and concrete file paths. If not, use the latest workflow bundle under `~/.pi/agent/workflows/*/`.

For split workflows, read:

- `workflow.research.md`
- `workflow.spec.md`

Do not read `workflow.toml` except to locate files or correct broken paths.

## Route guard

Before drafting, inspect `workflow.research.md` for `## Complexity / Route Recommendation` and these exact labels:

```markdown
- Complexity: trivial | small | moderate | large
- Spec: required | skipped - <rationale>
- Consensus: none | available_on_request | prompt_after_plan | prompt_after_spec_and_plan
- Browser review: skipped_for_trivial | required_after_plan | required_after_spec_and_plan
- Next command after /clear: /workflow-...
```

Refuse with an actionable message when:

- the route section is missing;
- `Spec:` is `skipped` and the user did not explicitly override and ask to create a spec anyway;
- the complexity is `trivial`, `small`, or `moderate` and the route says spec is skipped;
- the route labels are inconsistent or insufficient to decide.

A refusal must list the missing/invalid prerequisite and suggest the next command, usually `/workflow-plan <workflow>` for skipped-spec small/moderate work or `/workflow <request>` / Stage 1 if the route decision is missing.

Proceed normally when `Spec: required` or the user explicitly overrides the skipped-spec route.

## Process

1. Read `workflow.research.md` and existing `workflow.spec.md`.
2. Apply the route guard.
3. Draft or revise `workflow.spec.md` with:
   - Summary
   - Functional Requirements
   - Non-Functional Requirements
   - UX/API/Data Requirements as applicable
   - Acceptance Criteria
   - Out of Scope
   - Risks and Mitigations
   - Reference implementations / quality anchors
4. Save only the spec markdown.
5. Prompt for optional consensus when the route says `Consensus: prompt_after_spec_and_plan`, or when the user requested consensus. Make clear that consensus is optional and browser review is mandatory.
6. If the user declines consensus, proceed to browser review. If consensus fails below threshold or reports provider/tool errors, report the failure and ask whether to retry consensus, bypass to browser review, or stop. For large workflows, strongly recommend retrying or manually inspecting failure details before continuing.
7. Run mandatory browser annotation review after consensus is completed, declined, bypassed, or skipped.
8. Apply every browser annotation/edit/deletion/general comment. If annotations say `No Changes`, no markdown change is needed beyond recording review completion.

## Optional PAL sidecar consensus

When the user confirms consensus, run `run_pal_consensus_review` before browser review. Pass `planText` containing frozen context plus the full spec, or `planFile` if the spec file itself is ready to review:

```text
run_pal_consensus_review({
  title: "Workflow Spec Review",
  stackId: "auto",
  wait: true,
  planText: "Review this frozen pre-implementation spec. Identify missing requirements, contradictions, unclear acceptance criteria, hidden risks, and implementation blockers. Return blocking issues first, then recommended revisions.\n\n<context>...brief research summary and relevant file paths...</context>\n\n<spec>...the full workflow.spec.md...</spec>"
})
```

Use the returned PAL sidecar details, especially `details.findings` when available. Record sidecar evidence in `## Consensus Feedback` only if consensus was run:

- `run_id`
- `artifactDir`
- `findingsPath`
- `recommendation`
- reviewer success count
- warnings
- failed reviewers
- concise required revisions

If `recommendation` is `revise`, update `workflow.spec.md` before browser review. If the run status is failed, partial below threshold, or structured errors indicate missing provider/model/tool issues, do not claim consensus passed.

## Mandatory browser annotation / user review

Run the browser review server on the spec file only:

```bash
node /Users/daniphant/Projects/pi-extensions/pi-workflow/server/server.mjs "<workflow.spec.md>"
```

Tell the user the browser is open and wait for the command to complete. After it emits `PLAN_REVIEW_COMPLETE:<annotations-file>`:

1. Read the annotations file.
2. Apply every edit, deletion, annotation, and general comment to `workflow.spec.md`.
3. If annotations say `No Changes`, no markdown change is needed beyond recording review completion.
4. Summarize browser feedback in `## Browser Review Feedback` without turning it into gate/state checkboxes:
   - ISO timestamp or annotation artifact path
   - result: `changes_applied` or `no_changes`
   - concise summary

## Exit

Tell the user in natural prose that the spec is finalized and planning is next. Include both immediate continuation and `/clear` resume options. Put only the concrete command in a code block:

```text
/workflow-plan <workflow-directory-or-workflow.toml>
```
