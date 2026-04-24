---
name: workflow-brainstorm
description: Stage 1 of the Pi workflow. Interview, brainstorm, research, challenge assumptions, and update the durable workflow markdown file. Use when starting /workflow or when moving into research/discussion. Do not write implementation code.
---

# Workflow Brainstorm / Research

This is Stage 1 of the Pi workflow. It writes to the canonical user-local workflow file under `~/.pi/agent/workflows/<project>/<id>/workflow.md`. Workflow files should not be committed to project git.

## Goal

Reach shared understanding before producing a spec.

## Rules

- Do not implement code.
- Do not create tests, migrations, schemas, or app code.
- You may read code, search files, inspect docs, and update the workflow markdown file.
- Do exploration yourself in the main context. Do not delegate ordinary code exploration.
- Ask questions aggressively, but do not ask what you can answer by reading code.
- Keep updating `# 1. Research Log` in the workflow file.

## Process

1. Read the workflow file.
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
6. Update the workflow file with:
   - problem/opportunity
   - motivation
   - goals/non-goals
   - open questions
   - decisions made
   - alternatives considered
   - reference implementations with paths
   - risks/unknowns

## Exit

When research is complete, tell the user:

```text
Research is complete. Run /clear if you want a clean context, then run:
/workflow-spec <workflow-file>
```

Do not proceed to spec unless the user asks you to continue.
