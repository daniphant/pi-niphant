---
name: workflow-brainstorm
description: Stage 1 after /workflow has created a split workflow bundle. Interview, brainstorm, research, challenge assumptions, and update workflow.research.md. For raw requests like "use workflow" or "start workflow", use workflow-start first so it can choose a concise slug and call /workflow --name. Do not write implementation code.
---

# Workflow Brainstorm / Research

This is Stage 1 after `/workflow` creates a user-local workflow bundle under `~/.pi/agent/workflows/<project>/<id>/`.

The bundle uses focused files:

- `workflow.research.md` — Stage 1 research log. This is the only file normally edited in this stage.
- `workflow.spec.md` — Stage 2 spec.
- `workflow.plan.md` — Stage 3 implementation plan.
- `workflow.toml` — execution/task state only, populated from the final plan and updated during implementation.

Workflow files should not be committed to project git.

## Goal

Reach shared understanding before producing a spec.

## Rules

- Do not implement code.
- Do not create tests, migrations, schemas, or app code.
- You may read code, search files, inspect docs, and update `workflow.research.md`.
- Do not update `workflow.toml` during research except to fix broken file references; it is for execution/task state only.
- Do exploration yourself in the main context. Do not delegate ordinary code exploration.
- Ask questions aggressively, but do not ask what you can answer by reading code.
- Do not copy all research into `workflow.spec.md` or `workflow.plan.md`.

## Process

1. Read `workflow.research.md`.
2. Understand the user's motivation:
   - why this matters
   - what pain exists today
   - who is affected
   - what happens if we do nothing
   - smallest viable version
3. Explore existing code/patterns directly:
   - similar implementations
   - relevant modules/files/symbols
   - tests/quality anchors
   - configuration/schema/API boundaries
   - recent git history if helpful
4. Challenge assumptions:
   - simpler alternatives
   - edge cases
   - consistency implications
   - sequencing and dependencies
5. Ask targeted questions for unresolved decisions.
6. Update `workflow.research.md` with:
   - problem/opportunity
   - motivation
   - goals/non-goals
   - open questions
   - decisions made
   - alternatives considered
   - reference implementations with paths
   - risks/unknowns

## Naming

When you are responsible for initiating a workflow from a raw user request, choose a concise Codex-CLI-style slug before the script creates paths/worktrees:

- 2-4 short words, kebab-case, max 32 characters.
- Prefer concrete nouns/verbs from the request.
- Avoid generic prefixes like `plan`, `workflow`, `task`, or `feature`.
- Pass it down as `/workflow --name <slug> -- <full user request>` when invoking the workflow command.

## Exit

When research is complete, tell the user:

```text
Research is complete. Run /clear if you want a clean context, then run:
/workflow-spec <workflow-directory-or-workflow.toml>
```

Do not proceed to spec unless the user asks you to continue.
