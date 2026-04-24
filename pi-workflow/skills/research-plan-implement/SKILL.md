---
name: research-plan-implement
description: Compatibility overview for Pi's staged workflow. Prefer the stage-specific skills workflow-brainstorm, workflow-spec, workflow-plan, and workflow-implement. Use when the user asks about the full research-plan-implement workflow.
---

# Research → Spec → Implementation Plan → Implement

This is the umbrella overview. Prefer the stage-specific skills:

1. `workflow-brainstorm` — research, discussion, interview, code/context discovery; writes `# 1. Research Log`.
2. `workflow-spec` — writes `# 2. Spec`, then automatically runs browser annotation review and multi-model consensus.
3. `workflow-plan` — writes `# 3. Implementation Plan`, dependency graph, parallel groups, blockers, validation plan; then automatically runs browser annotation review and multi-model consensus.
4. `workflow-implement` — implements from the finalized workflow file, updates `# 4. Execution Log`, runs diagnostics/tests/E2E.

The durable workflow markdown file is the state boundary. It lives user-locally under `~/.pi/agent/workflows/<project>/...` and should not be committed to project git. It is expected and encouraged to run `/clear` between stages.

Commands:

```text
/workflow <description>          # create workflow and start brainstorm
/workflow-spec [workflow.md]     # create/finalize spec with automatic review+consensus
/workflow-plan [workflow.md]     # create/finalize implementation plan with automatic review+consensus
/workflow-implement [workflow.md]# implement finalized plan
/workflow-review [workflow.md]   # manual extra browser review round
/workflow-latest                 # show latest workflow path
```
