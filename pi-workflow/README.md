# pi-workflow

A durable Research → Spec/Plan as needed → Execute workflow for [Pi](https://github.com/mariozechner/pi-coding-agent).

`pi-workflow` turns vague feature requests into a staged, reviewable, `/clear`-friendly development process. The front door is frictionless: you can start with `/workflow <request>`, the extension infers a concise slug, creates the user-local workflow bundle immediately, and hands Stage 1 to the research agent.

## Features

- `/workflow <request>` auto-infers a concise slug and starts Stage 1 without asking you to type a name
- `/workflow --name <slug> -- <request>` remains available when you want to override the inferred slug
- strict slug validation: lowercase ASCII letters, digits, and hyphens; max 32 characters; no whitespace, path separators, shell metacharacters, or `..`
- when launched with `ni`/`NIPHANT=1`, workflow creation (inferred or explicit slug) first creates or resumes a niphant git worktree and prints a `cd <worktree> && ni` handoff
- discovery/front-door skill: `workflow-start`
- stage-specific skills:
  - `workflow-brainstorm`
  - `workflow-spec`
  - `workflow-plan`
  - `workflow-implement` (thin legacy alias semantics for execution)
- preferred execution command: `/workflow-execute`
- complexity-based routing from Stage 1:
  - trivial: research → execute directly
  - small: research → plan → execute
  - moderate: research → plan → execute, with consensus prompted after plan
  - large: research → spec → plan → execute, with consensus prompted after spec and plan
- browser annotation review UI for every produced spec and plan
- optional/prompted PAL sidecar consensus-review for spec and implementation-plan stages
- split research/spec/plan Markdown artifacts that survive `/clear`
- TOML execution state for task progress, dependencies, timestamps, errors, and commits
- task graph with dependencies, blockers, validation, rollback, and parallel-safe groups

## Niphant worktree mode

When Pi is launched through the `ni` launcher, these environment markers are set:

- `NIPHANT=1`
- `NIPHANT_HOME` (default `~/.niphant`)
- `NIPHANT_PROJECT_ROOT` (the git root where `ni` was started)

In this mode `/workflow <task>` or explicit `/workflow --name <slug> -- <task>` creation:

1. identifies the current project from git root/origin,
2. matches an existing active workspace by project/task slug,
3. otherwise creates a git worktree under `~/.niphant/worktrees/<project>/<task>`,
4. records inspectable JSON metadata under `~/.niphant/state/workspaces`,
5. runs `.niphant/setup.sh` or `.superset/setup.sh` when present unless `NIPHANT_SETUP_MODE=skip`, and
6. prints an explicit handoff: `cd '<worktree>' && ni`.

Pi cwd switching is deliberately explicit in V1; see `docs/niphant-handoff.md`. Niphant never writes state to `~/.superset`.

Additional commands:

```text
/niphant-list
/niphant-status
/niphant-status locks
/niphant-terminal
/niphant-done
```

## Storage model

Workflow bundles intentionally live outside the project repository:

```txt
~/.pi/agent/workflows/<short-project-slug>/<timestamp>-<concise-plan-slug>/
├── workflow.md            # tiny index / source request
├── workflow.research.md   # research notes and route decision
├── workflow.spec.md       # focused spec when route requires it
├── workflow.plan.md       # implementation plan when route requires it
└── workflow.toml          # execution/task state only
```

They are user-local planning artifacts and should not be committed.

## Commands

```text
/workflow <description>        # infer a concise slug, then create/start the workflow
/workflow --name <slug> -- <description> # create/resume workflow with an explicit validated slug override
/workflow-latest               # show latest workflow bundle for this project
/workflow-spec [workflow-dir|workflow.toml]   # Stage 2 spec when route requires it or user overrides
/workflow-plan [workflow-dir|workflow.toml]   # Stage 3 plan from spec or sufficient skipped-spec research
/workflow-review [workflow.plan.md|workflow.spec.md|workflow-dir] # browser annotation review UI
/workflow-execute [workflow-dir|workflow.toml|workflow.plan.md|workflow.research.md] # preferred Stage 4 execution
/workflow-implement [same args as workflow-execute] # deprecated thin alias for workflow-execute semantics
/niphant-list
/niphant-status
/niphant-terminal
/niphant-done
```

## The workflow

### Stage 1 — Research / Brainstorm

The assistant inspects the code directly when possible, then interviews you when product/design decisions remain. Manual brainstorm without a workflow bundle refuses and tells you to start with `/workflow <request>` so continuation stays `/clear` safe.

Stage 1 records this stable route section in `workflow.research.md`:

```markdown
## Complexity / Route Recommendation

- Complexity: trivial | small | moderate | large
- Recommended route: <human-readable route>
- Spec: required | skipped - <rationale>
- Plan: required | skipped - <rationale>
- Consensus: none | available_on_request | prompt_after_plan | prompt_after_spec_and_plan
- Browser review: skipped_for_trivial | required_after_plan | required_after_spec_and_plan
- Execution source: research | plan
- Trivial execution approved: true | false
- Workflow task tracking: enabled | skipped_for_trivial
- Next command after /clear: /workflow-...
```

Stage 1 stops with natural-prose next steps. It includes both an immediate “continue” option and a `/clear` resume command.

### Stage 2 — Spec

The assistant writes a product/engineering spec only when the route requires it, or when you explicitly override a skipped-spec route. Consensus is prompted where recommended; it is not run without confirmation. Browser annotation review is mandatory for every produced spec and its result is recorded in `workflow.spec.md`.

### Stage 3 — Implementation Plan

The assistant creates a task graph an implementer can follow without guessing. Planning can use either a finalized spec or sufficient Stage 1 research when the route intentionally skipped spec. Consensus is prompted where recommended; browser annotation review is mandatory for every produced plan. After final review, `workflow.toml` is populated with task state only.

### Stage 4 — Execute

Use `/workflow-execute`. Planned workflows use `workflow.plan.md` as the authoritative instructions and `workflow.toml` as task state. Execution does not depend on `workflow.spec.md`.

Trivial research-only execution is allowed only when the research route explicitly records all skip markers, including `Trivial execution approved: true` and `Workflow task tracking: skipped_for_trivial`. Otherwise execution refuses and suggests `/workflow-plan <workflow>`.

## Validation

```bash
npm install
npm run check --workspace pi-workflow --if-present
```

The package check runs a lightweight smoke validation for command routing, route schema, prompted consensus wording, mandatory browser review wording, execution markers, and stale instruction coverage.

## Install

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-workflow
ln -sfn "$PWD/skills/research-plan-implement" ~/.pi/agent/skills/research-plan-implement
ln -sfn "$PWD/skills/workflow-start" ~/.pi/agent/skills/workflow-start
ln -sfn "$PWD/skills/workflow-brainstorm" ~/.pi/agent/skills/workflow-brainstorm
ln -sfn "$PWD/skills/workflow-spec" ~/.pi/agent/skills/workflow-spec
ln -sfn "$PWD/skills/workflow-plan" ~/.pi/agent/skills/workflow-plan
ln -sfn "$PWD/skills/workflow-implement" ~/.pi/agent/skills/workflow-implement
```

Then run `/reload` inside Pi.

## Recommended companion extensions

- `pi-pal-consensus-sidecar` for PAL-backed multi-model review
- `pi-web-e2e-agent` for browser annotation/E2E artifacts
- `pi-diagnostics` for verification and systematic debugging
- `pi-checkpoint` for local WIP auto-commit recovery points

## License

MIT
