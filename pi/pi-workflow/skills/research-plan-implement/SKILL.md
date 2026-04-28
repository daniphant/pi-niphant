---
name: research-plan-implement
description: Compatibility overview for Pi's staged workflow. For a new raw request, prefer workflow-start or /workflow <request>; the command infers a concise slug and creates the bundle immediately.
---

# Research → Spec/Plan as Needed → Execute

This is the umbrella overview. For a brand-new raw request, prefer `workflow-start` or `/workflow <request>`. The `/workflow` command infers a concise slug and creates/resumes the bundle immediately so paths/worktrees stay short and safe. Use `/workflow --name <slug> -- <request>` only when overriding the inferred slug.

The workflow is split into focused files, following the Multiverse-style separation of readable artifacts from execution state:

- `workflow.research.md` — research, discussion, code/context discovery, and the route decision.
- `workflow.spec.md` — focused spec when the route requires one; browser review and any consensus feedback live here.
- `workflow.plan.md` — focused implementation plan/task graph when the route requires one; browser review and any consensus feedback live here.
- `workflow.toml` — execution/task state only, initialized from the final plan and updated during execution.

## Context hygiene

Do not read unrelated `SKILL.md` files, enumerate installed skills, or read every workflow-stage skill as background. Prefer the stage-specific skill for the active stage and load only the workflow artifacts that stage requires. Load another skill only when the user explicitly requests it or direct validation/tooling requires it.

Prefer the stage-specific skills:

1. `workflow-brainstorm` — updates `workflow.research.md`, classifies complexity, records the route decision, and stops with a handoff.
2. `workflow-spec` — writes/finalizes `workflow.spec.md` only when the route requires spec or the user explicitly overrides; consensus is prompted, browser review is mandatory.
3. `workflow-plan` — writes/finalizes `workflow.plan.md` from spec or sufficient skipped-spec research; consensus is prompted, browser review is mandatory, then `workflow.toml` task state is initialized.
4. `workflow-implement` — execution skill used by `/workflow-execute`; implements from `workflow.plan.md` + `workflow.toml` or from explicitly trivial research-only markers.

Complexity routes:

- trivial: research → execute directly; no consensus/browser review/task tracking unless requested.
- small: research → plan → execute; consensus available on request, browser review after plan required.
- moderate: research → plan → execute; consensus prompted after plan, browser review after plan required.
- large: research → spec → plan → execute; consensus prompted after spec and plan, browser review after both required.

Workflow bundles live user-locally under `~/.pi/agent/workflows/<project>/...` and should not be committed to project git. It is expected and encouraged to run `/clear` between stages.

Commands:

```text
/workflow <description>                  # front door; command infers slug
/workflow --name <slug> -- <description> # explicit validated slug override
/workflow-spec [workflow-dir|workflow.toml]
/workflow-plan [workflow-dir|workflow.toml]
/workflow-execute [workflow-dir|workflow.toml|workflow.plan.md|workflow.research.md]
/workflow-implement [same args as workflow-execute] # deprecated alias
/workflow-review [workflow.plan.md|workflow.spec.md|workflow-dir]
/workflow-latest
```
