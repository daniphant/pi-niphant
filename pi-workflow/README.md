# pi-workflow

A durable Research → Spec → Implementation Plan → Implement workflow for [Pi](https://github.com/mariozechner/pi-coding-agent).

`pi-workflow` turns vague feature requests into a staged, reviewable, `/clear`-friendly development process inspired by Codex CLI compaction, Multiverse plan review, Superpowers-style staged skills, GStack rigor, and Matt Pocock's `grill-me` questioning style.

## Features

- `/workflow [--name concise-slug --] <request>` creates a user-local workflow bundle with a short plan slug
- when launched with `ni`/`NIPHANT=1`, `/workflow` first creates or resumes a niphant git worktree and prints an explicit `cd <worktree> && ni` handoff
- discovery/front-door skill:
  - `workflow-start`
- stage-specific skills:
  - `workflow-brainstorm`
  - `workflow-spec`
  - `workflow-plan`
  - `workflow-implement`
- browser annotation review UI for specs/plans
- automatic consensus-review before user/browser review for spec and implementation-plan stages
- split research/spec/plan Markdown artifacts that survive `/clear`
- TOML execution state for task progress, dependencies, timestamps, errors, and commits
- task graph with dependencies, blockers, validation, rollback, and parallel-safe groups
- implementation guidance that avoids giant pre-coded snippets

## Niphant worktree mode

When Pi is launched through the `ni` launcher, these environment markers are set:

- `NIPHANT=1`
- `NIPHANT_HOME` (default `~/.niphant`)
- `NIPHANT_PROJECT_ROOT` (the git root where `ni` was started)

In this mode `/workflow <task>` does **not** immediately start Stage 1 from the old checkout. It:

1. identifies the current project from git root/origin,
2. matches an existing active workspace by deterministic project/task slug,
3. otherwise creates a git worktree under `~/.niphant/worktrees/<project>/<task>`,
4. records inspectable JSON metadata under `~/.niphant/state/workspaces`,
5. runs `.niphant/setup.sh` or `.superset/setup.sh` when present unless `NIPHANT_SETUP_MODE=skip`, and
6. prints an explicit handoff: `cd '<worktree>' && ni`.

Pi cwd switching is deliberately explicit in V1; see `docs/niphant-handoff.md`. Niphant never writes state to `~/.superset`.

Additional commands:

```text
/niphant-list       # list active/recent niphant workspaces
/niphant-status     # show current workspace metadata
/niphant-status locks # clear stale niphant locks
/niphant-terminal   # print cd/ni commands for another terminal
/niphant-done       # archive metadata; does not delete branches/worktrees
```

## Storage model

Workflow bundles intentionally live outside the project repository:

```txt
~/.pi/agent/workflows/<short-project-slug>/<timestamp>-<concise-plan-slug>/
├── workflow.md            # tiny index / source request
├── workflow.research.md   # research notes
├── workflow.spec.md       # focused spec for review
├── workflow.plan.md       # focused implementation plan for review
└── workflow.toml          # execution/task state only
```

They are user-local planning artifacts and should not be committed.

## Commands

```text
/workflow <description>        # create workflow bundle and start Stage 1 research
/workflow --name <slug> -- <description> # same, with an AI/chosen concise slug
/workflow-latest               # show latest workflow bundle for this project
/workflow-spec [workflow-dir|workflow.toml]   # Stage 2 spec with review/consensus
/workflow-plan [workflow-dir|workflow.toml]   # Stage 3 plan with review/consensus and task-state init
/workflow-review [workflow.plan.md|workflow.spec.md|workflow-dir] # browser annotation review UI
/workflow-implement [workflow-dir|workflow.toml] # Stage 4 implementation from finalized plan/state
/niphant-list                 # niphant workspace list
/niphant-status               # current niphant workspace status
/niphant-terminal             # print terminal commands for current workspace
/niphant-done                 # archive current niphant workspace metadata
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

The spec stage should run multi-model consensus first, apply required changes, and then ask for browser/user annotation review before the spec is considered finalized.

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

The assistant reads `workflow.toml` for execution state, follows `workflow.plan.md` task instructions, implements task-by-task, updates TOML task statuses/timestamps/results, runs diagnostics/tests, and uses browser/E2E validation when relevant.

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

## Development

```bash
npm install
npm run check
```

## License

MIT
