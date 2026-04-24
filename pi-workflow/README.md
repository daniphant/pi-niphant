# pi-workflow

A durable Research → Spec → Implementation Plan → Implement workflow for [Pi](https://github.com/mariozechner/pi-coding-agent).

`pi-workflow` turns vague feature requests into a staged, reviewable, `/clear`-friendly development process inspired by Codex CLI compaction, Multiverse plan review, Superpowers-style staged skills, GStack rigor, and Matt Pocock's `grill-me` questioning style.

## Features

- `/workflow <request>` creates a user-local workflow file
- stage-specific skills:
  - `workflow-brainstorm`
  - `workflow-spec`
  - `workflow-plan`
  - `workflow-implement`
- browser annotation review UI for specs/plans
- automatic consensus-review instructions for spec and implementation-plan stages
- durable Markdown state boundary that survives `/clear`
- explicit gates and readiness dashboards
- task graph with dependencies, blockers, validation, rollback, and parallel-safe groups
- implementation guidance that avoids giant pre-coded snippets

## Storage model

Workflow files intentionally live outside the project repository:

```txt
~/.pi/agent/workflows/<project-slug>/<workflow-id>/workflow.md
```

They are user-local planning artifacts and should not be committed.

## Commands

```text
/workflow <description>        # create workflow and start Stage 1 research
/workflow-latest               # show latest workflow file for this project
/workflow-spec [workflow.md]   # Stage 2 spec with review/consensus
/workflow-plan [workflow.md]   # Stage 3 implementation plan with review/consensus
/workflow-review [workflow.md] # open browser annotation review UI
/workflow-implement [file]     # Stage 4 implementation from finalized plan
```

## The workflow

### Stage 1 — Research / Brainstorm

The assistant inspects the code directly when possible, then interviews you one question at a time when product/design decisions remain.

Rules include:

- ask one question at a time
- include a recommended answer
- explain consequences of alternatives
- resolve/defer/reject decision branches explicitly
- do not implement code

### Stage 2 — Spec

The assistant writes a product/engineering spec with scope posture:

- Reduce Scope
- Hold Scope
- Selective Expansion
- Expansion

The spec stage should run browser annotation review and multi-model consensus before finalizing gates.

### Stage 3 — Implementation Plan

The assistant creates a task graph an implementer can follow without guessing:

- exact file paths and ownership
- dependencies and blockers
- parallel-safe groups
- validation commands
- rollback plan
- risks and assumptions

The plan should guide implementation, not dump huge code blocks.

### Stage 4 — Implement

The assistant reads the finalized workflow, verifies gates, implements task-by-task, updates the execution log, runs diagnostics/tests, and uses browser/E2E validation when relevant.

## Install

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-workflow
ln -sfn "$PWD/skills/research-plan-implement" ~/.pi/agent/skills/research-plan-implement
ln -sfn "$PWD/skills/workflow-brainstorm" ~/.pi/agent/skills/workflow-brainstorm
ln -sfn "$PWD/skills/workflow-spec" ~/.pi/agent/skills/workflow-spec
ln -sfn "$PWD/skills/workflow-plan" ~/.pi/agent/skills/workflow-plan
ln -sfn "$PWD/skills/workflow-implement" ~/.pi/agent/skills/workflow-implement
```

Then run `/reload` inside Pi.

## Recommended companion extensions

- `pi-consensus` for multi-model review
- `pi-web-e2e-agent` for browser annotation/E2E artifacts
- `pi-diagnostics` for verification and systematic debugging
- `pi-checkpoint` for local WIP auto-commit recovery points

## Development

```bash
npm install
npm run check
```

## License

MIT
