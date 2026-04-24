---
name: workflow-spec
description: Stage 2 of the Pi workflow. Convert research into a durable spec in workflow.md, then automatically run browser annotation review and multi-model consensus before finalizing. Do not write implementation code.
---

# Workflow Spec

This is Stage 2. It converts the research log into a finalized spec.

## Hard rules

- Do not implement code.
- Update only the workflow markdown file and generated annotation/consensus artifacts.
- Browser annotation review is automatic and required.
- Multi-model consensus is automatic and required unless the user explicitly says to skip it in this stage request.
- Use consensus on frozen text only; do not ask consensus models to explore the repo.

## Inputs

The command should provide a workflow file path. If not, use the latest `.pi/workflows/*/workflow.md`.

## Process

1. Read the workflow file.
2. Read `# 1. Research Log` and any existing `# 2. Spec` content.
3. Draft or revise `# 2. Spec` with:
   - Summary
   - Functional Requirements
   - Non-Functional Requirements
   - UX/API/Data Requirements as applicable
   - Acceptance Criteria
   - Out of Scope
   - Risks and Mitigations
   - Reference implementations / quality anchors
4. Save the workflow file.

## Automatic browser annotation review

After drafting the spec, run the browser review server. The skill file lives in `pi-workflow/skills/workflow-spec`; the server is at `../../server/server.mjs` relative to this skill directory.

Run:

```bash
node /Users/daniphant/Projects/pi-extensions/pi-workflow/server/server.mjs "<workflow-file>"
```

Tell the user the browser is open and wait for the command to complete. After it emits `PLAN_REVIEW_COMPLETE:<annotations-file>`:

1. Read the annotations file.
2. Apply every edit, deletion, annotation, and general comment to the workflow file.
3. If annotations say `No Changes`, record spec browser review as approved.
4. Update `## Spec Review Annotations` with status and annotation file path.

## Automatic consensus

After browser-review changes are applied, run `run_consensus` on frozen context:

```text
Review this frozen pre-implementation spec. Identify missing requirements, contradictions, unclear acceptance criteria, hidden risks, and implementation blockers. Return blocking issues first, then recommended revisions.

<context>
[brief research summary and relevant file paths]
</context>

<spec>
[the full # 2. Spec section]
</spec>
```

Default models:
- `openai-codex/gpt-5.5`
- `zai/glm-5.1`

Apply all required consensus changes to the spec. Update `## Spec Consensus` with:
- status: completed
- models
- summary
- required changes applied

## Exit

When finalized, update Stage Gates:

- [x] Research complete
- [x] Spec drafted
- [x] Spec browser review complete
- [x] Spec consensus complete or explicitly skipped
- [x] Spec finalized

Then tell the user:

```text
Spec is finalized. Run /clear if you want a clean context, then run:
/workflow-plan <workflow-file>
```
