---
name: research-plan-implement
description: Compatibility overview for Pi's staged workflow. Use when the user asks about the full research-plan-implement workflow. For starting a new workflow from a raw request, prefer workflow-start so it can choose a concise slug and route through /workflow --name.
---

# Research → Spec → Implementation Plan → Implement

This is the umbrella overview. For a brand-new raw request, prefer `workflow-start` first; it chooses a concise slug and routes through `/workflow --name <slug> -- <request>` so paths/worktrees stay short.

The workflow is split into focused files, following the Multiverse-style separation of readable artifacts from execution state:

- `workflow.research.md` — research, discussion, code/context discovery.
- `workflow.spec.md` — focused spec; browser review and consensus feedback live here.
- `workflow.plan.md` — focused implementation plan/task graph; browser review and consensus feedback live here.
- `workflow.toml` — execution/task state only, initialized from the final plan and updated during implementation.

Prefer the stage-specific skills:

1. `workflow-brainstorm` — updates `workflow.research.md`.
2. `workflow-spec` — writes/finalizes `workflow.spec.md`, then automatically runs multi-model consensus before browser annotation/user review on the spec file only.
3. `workflow-plan` — writes/finalizes `workflow.plan.md`, dependency graph, parallel groups, blockers, validation plan; then automatically runs multi-model consensus before browser annotation/user review on the plan file only; finally initializes `workflow.toml` task state.
4. `workflow-implement` — implements from `workflow.plan.md`, updates `workflow.toml` task state, and runs diagnostics/tests/E2E.

Workflow bundles live user-locally under `~/.pi/agent/workflows/<project>/...` and should not be committed to project git. It is expected and encouraged to run `/clear` between stages.

Commands:

```text
/workflow --name <slug> -- <description> # create workflow with AI/chosen concise slug and start brainstorm
/workflow <description>                  # fallback form; script derives a deterministic slug
/workflow-spec [workflow-dir|workflow.toml]
/workflow-plan [workflow-dir|workflow.toml]
/workflow-implement [workflow-dir|workflow.toml]
/workflow-review [workflow.plan.md|workflow.spec.md|workflow-dir]
/workflow-latest
```
