# pi-niphant

Personal agent-harness toolbox for daily work across [Pi](https://github.com/mariozechner/pi-coding-agent) and [Factory Droid](https://docs.factory.ai/cli/getting-started/overview): Pi extensions/skills, Droid plugins, workflow instructions, UI polish, notifications, diagnostics, consensus review, browser automation, and local recovery helpers.

This repository is intentionally one monorepo. Runtime-specific packages are split by harness:

```txt
pi/       Pi extensions and skills
droid/    Droid plugins, hooks, commands, and themes
scripts/  unified installers and repo utilities
eval/     skill evaluation harness
```

## Philosophy

Pi and Droid should feel like predictable, high-agency coding harnesses:

- one strong main model does normal repo/code exploration directly
- subagents are reserved for objective artifact-producing work
- browser/E2E verification should produce inspectable artifacts
- risky specs/plans should get frozen-context consensus review
- debugging should be systematic, evidence-first, and root-cause driven
- long sessions should survive clears, compaction, and crashes
- planning artifacts should be durable but user-local, not committed to project repos
- local auto-commits are useful recovery points, but never pushed automatically

## Pi packages

| Package | Purpose |
| --- | --- |
| [`pi-workflow`](./pi/pi-workflow) | Research → spec → implementation plan → implement workflow with durable user-local markdown state. |
| [`pi-ask-user`](./pi/pi-ask-user) | OpenCode-style `ask_user_question` native tool backed by Pi UI dialogs. |
| [`pi-checkpoint`](./pi/pi-checkpoint) | Continuous local auto-commits plus manual patch checkpoints. |
| [`pi-catppuccin-ui`](./pi/pi-catppuccin-ui) | Catppuccin Mocha theme plus Markdown rendering polish. |
| [`pi-codex-compaction`](./pi/pi-codex-compaction) | Codex-style checkpoint handoff compaction summaries. |
| [`pi-pal-consensus-sidecar`](./pi/pi-pal-consensus-sidecar) | PAL MCP consensus dashboard and direct plan-review tool with artifacts. |
| [`pi-web-e2e-agent`](./pi/pi-web-e2e-agent) | `agent-browser` powered browser/E2E automation and artifacts. |
| [`pi-web-tools`](./pi/pi-web-tools) | Direct `web_open` and Brave-backed `web_search` tools with conservative network safety defaults. |
| [`pi-diagnostics`](./pi/pi-diagnostics) | Diagnostics runner plus Superpowers-inspired systematic debugging skill. |
| [`pi-markdown-commands`](./pi/pi-markdown-commands) | OpenCode-style markdown slash commands. |
| [`pi-delegation-guard`](./pi/pi-delegation-guard) | Blocks accidental subagent use for ordinary repo exploration. |
| [`pi-delegated-agents`](./pi/pi-delegated-agents) | Explicit delegated specialist-agent orchestration. |
| [`pi-clear`](./pi/pi-clear) | `/clear` session reset command. |
| [`pi-update-prompt`](./pi/pi-update-prompt) | Interactive startup prompt for Pi core updates; updates with npm and exits gracefully. |
| [`pi-agent-notify`](./pi/pi-agent-notify) | Desktop/terminal notifications when Pi finishes a turn. |
| [`pi-hud`](./pi/pi-hud) | Quota/context-aware Pi footer HUD. |
| [`pi-whimsy-status`](./pi/pi-whimsy-status) | Whimsical rotating working messages. |
| [`pi-github-repo-explorer`](./pi/pi-github-repo-explorer) | Skill for cloning and inspecting GitHub repos with file-path evidence. |

## Droid plugins

| Plugin | Purpose |
| --- | --- |
| [`droid-catppuccin-ui`](./droid/droid-catppuccin-ui) | Catppuccin Mocha theme for Droid. |
| [`droid-discord-presence`](./droid/droid-discord-presence) | Privacy-conscious Discord Rich Presence via Droid lifecycle hooks. |

The root `.factory-plugin/marketplace.json` exposes the Droid plugins as a local marketplace named `pi-niphant`.

## Install

Clone the repo:

```bash
git clone https://github.com/daniphant/pi-niphant.git
cd pi-niphant
```

Install the default Pi package set and Droid plugins:

```bash
./scripts/install.sh
```

Pi symlinks are installed into `~/.pi/agent`; Droid plugins are installed from the local marketplace with user scope. The Pi install also installs the short `ni` launcher to `~/.local/bin/ni` when `pi-workflow` is selected.

Useful variants:

```bash
./scripts/install.sh --pi                         # Pi only
./scripts/install.sh --droid                      # Droid only
./scripts/install.sh --all                        # all Pi packages plus all Droid plugins
./scripts/install.sh pi-workflow droid-discord-presence
DROID_SCOPE=project ./scripts/install.sh --droid  # project-scoped Droid plugins
./scripts/install.sh --uninstall                  # remove installed symlinks/plugins
```

After Pi installs, run `/reload` inside Pi. After Droid plugin installs, restart Droid or verify with `/plugins`.

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

Useful workspace commands:

```text
/ni <task>
/niphant-checkout <task>
/niphant-list
/niphant-status
/niphant-terminal
/niphant-done
```

## Development

From the repo root:

```bash
npm install
npm run list
npm run check
```

Package paths are grouped under `pi/` and `droid/`; keep harness-specific config in the matching tree and shared repo utilities under `scripts/` or `eval/`.

## License

MIT. See package-level licenses.
