# pi-niphant

A trunkful of opinionated developer harness tools for [Pi](https://github.com/mariozechner/pi-coding-agent): workflow, checkpoints, consensus review, browser/E2E automation, diagnostics, systematic debugging, compaction, notifications, HUD, and delegation guardrails.

This repository is intentionally a **single toolbox repo**, in the spirit of GStack and Superpowers. Each directory is a standalone Pi extension/skill package, but the recommended install is to clone this repo once and symlink the tools you want into `~/.pi/agent`.

## Philosophy

Pi should be a predictable, high-agency coding harness:

- one strong main model does normal repo/code exploration directly
- subagents are reserved for objective artifact-producing work
- browser/E2E verification should produce inspectable artifacts
- risky specs/plans should get frozen-context consensus review
- debugging should be systematic, evidence-first, and root-cause driven
- long sessions should survive `/clear`, compaction, and crashes
- planning artifacts should be durable but user-local, not committed to project repos
- local WIP commits are useful recovery points, but never pushed automatically

## What is included

| Package | Purpose |
| --- | --- |
| [`pi-workflow`](./pi-workflow) | Research → spec → implementation plan → implement workflow with durable user-local markdown state. |
| [`pi-checkpoint`](./pi-checkpoint) | Continuous local WIP auto-commits plus manual patch checkpoints. |
| [`pi-codex-compaction`](./pi-codex-compaction) | Codex-style checkpoint handoff compaction summaries. |
| [`pi-consensus`](./pi-consensus) | Multi-model frozen-context consensus reviews. |
| [`pi-web-e2e-agent`](./pi-web-e2e-agent) | `agent-browser` powered browser/E2E automation and artifacts. |
| [`pi-diagnostics`](./pi-diagnostics) | Diagnostics runner plus Superpowers-inspired systematic debugging skill. |
| [`pi-markdown-commands`](./pi-markdown-commands) | OpenCode-style markdown slash commands. |
| [`pi-delegation-guard`](./pi-delegation-guard) | Blocks accidental subagent use for ordinary repo exploration. |
| [`pi-delegated-agents`](./pi-delegated-agents) | Explicit delegated specialist-agent orchestration. |
| [`pi-clear`](./pi-clear) | `/clear` session reset command. |
| [`pi-agent-notify`](./pi-agent-notify) | Desktop/terminal notifications when Pi finishes a turn. |
| [`pi-hud`](./pi-hud) | Quota/context-aware Pi footer HUD. |
| [`pi-whimsy-status`](./pi-whimsy-status) | Whimsical rotating working messages. |
| [`pi-github-repo-explorer`](./pi-github-repo-explorer) | Skill for cloning and inspecting GitHub repos with file-path evidence. |

## Recommended install

Clone the repo:

```bash
git clone https://github.com/daniphant/pi-niphant.git
cd pi-niphant
```

Install the opinionated default set:

```bash
./scripts/install.sh
```

This also installs the short `ni` launcher to `~/.local/bin/ni` (override with `PI_BIN_DIR=/some/bin`). Ensure that directory is on `PATH`.

Then inside Pi:

```text
/reload
```

The default set installs:

- `pi-clear`
- `pi-checkpoint`
- `pi-codex-compaction`
- `pi-consensus`
- `pi-delegation-guard`
- `pi-diagnostics`
- `pi-markdown-commands`
- `pi-web-e2e-agent`
- `pi-workflow`
- `pi-agent-notify`
- `pi-hud`
- `pi-whimsy-status`
- `pi-github-repo-explorer`

`pi-delegated-agents` is available but intentionally not installed by default unless you pass `--delegated-agents`, because this setup prefers direct main-model exploration.

## Install everything

```bash
./scripts/install.sh --all
```

## Install selected packages

```bash
./scripts/install.sh pi-workflow pi-consensus pi-diagnostics pi-web-e2e-agent
```

## Uninstall symlinks

```bash
./scripts/install.sh --uninstall
```

Or selected:

```bash
./scripts/install.sh --uninstall pi-workflow pi-consensus
```

## Niphant `ni` flow

From any existing git checkout:

```bash
cd ~/Projects/my-app
ni
```

`ni` verifies git/Pi availability, sets `NIPHANT=1`, `NIPHANT_HOME` (default `~/.niphant`), and `NIPHANT_PROJECT_ROOT`, then launches Pi in the current repo.

Inside that Pi session:

```text
/workflow Build a new billing dashboard
```

In niphant mode this creates or resumes a task worktree under `~/.niphant/worktrees/...`, records JSON metadata under `~/.niphant/state/workspaces`, optionally runs `.niphant/setup.sh` or `.superset/setup.sh`, and prints an explicit handoff:

```bash
cd '<worktree>' && ni
```

Pi cwd switching is explicit in V1; normal `pi` usage keeps the old `/workflow` behavior unchanged.

Useful workspace commands:

```text
/niphant-list
/niphant-status
/niphant-terminal
/niphant-done
```

## Core workflow

```text
/workflow Build a new billing dashboard
```

Outside niphant mode, this creates a user-local workflow file under:

```txt
~/.pi/agent/workflows/<project-slug>/<workflow-id>/workflow.md
```

Then proceed in stages, usually clearing context between them:

```text
/clear
/workflow-spec
/clear
/workflow-plan
/clear
/workflow-implement
```

Spec and plan stages are designed to run browser annotation review and multi-model consensus before implementation.

## Systematic debugging

For bugs/test failures/build failures:

```text
/debug-start flaky login redirect test
```

This creates a user-local root-cause log under:

```txt
~/.pi/agent/debugging/<project-slug>/<timestamp>-debug.md
```

The bundled `systematic-debugging` skill enforces:

```text
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
```

## Checkpoints and commits

`pi-checkpoint` defaults to continuous local WIP commits after agent turns when the working tree changes.

It never pushes.

It also excludes planning/checkpoint artifacts:

```txt
.pi/checkpoints
.pi/workflows
.pi/plans
```

`pi-workflow` and `pi-diagnostics` store their durable planning/debugging files outside project repos under `~/.pi/agent/...`.

## Browser/E2E

Quick capture:

```text
/e2e http://localhost:3000 verify the landing page renders
```

Multi-step flows use `agent-browser` commands via the `run_agent_browser` tool with `snapshot -i` and compact `@e1` refs.

## Consensus

```text
/consensus Review this implementation plan for scope, risk, and validation gaps: ...
```

Consensus models run with tools/skills/extensions disabled and only review the frozen context you pass.

## Markdown commands

Put command files in:

```txt
~/.pi/agent/commands
~/.config/opencode/commands
<project>/.pi/commands
<project>/.agents/commands
<project>/.opencode/commands
```

Then list loaded commands:

```text
/markdown-commands
```

## Development

Each package has its own `package.json`. From the repo root:

```bash
npm install
npm run check
```

Or work in a package directory directly.

## Publishing as one repo

Publish once:

```bash
git init
git add .
git commit -m "Initial pi-niphant release"
gh repo create daniphant/pi-niphant --public --source=. --remote=origin --push
```

## License

MIT. See package-level licenses.
