# pi-checkpoint

Continuous local auto-commits for [Pi](https://github.com/mariozechner/pi-coding-agent).

By default, `pi-checkpoint` creates a local git commit after each Pi agent turn whenever the working tree changed. It is designed as a recovery layer for long agent sessions, `/clear` boundaries, compaction, and multi-stage workflows.

It never pushes.

## Features

- continuous local auto-commits by default
- structured `[gstack-context]` commit messages
- manual patch checkpoints under `.pi/checkpoints`
- quick diff/status command
- safety checkpoint before destructive revert
- modes for continuous, explicit-only, or disabled operation
- explicit exclusion of planning artifacts from auto-commits

## Default behavior

After each agent turn:

1. verify the current directory is inside a git repository
2. check whether the working tree changed
3. stage changes
4. exclude local Pi planning/checkpoint artifacts
5. commit with a structured message based on the changed files

Commit messages include:

```text
Update pi-hud (4 files)

[gstack-context]
Source: pi-checkpoint continuous auto-commit
Session: ...
Model: ...
Changed files: ...

Files:
- ...

Decisions: see Pi session transcript and workflow files for reasoning.
Remaining work: continue from latest Pi message / workflow stage.
[/gstack-context]
```

## Planning artifacts are not committed

These paths are explicitly excluded from auto-commits:

```txt
.pi/checkpoints
.pi/workflows
.pi/plans
```

`pi-workflow` stores new workflow files outside repositories under `~/.pi/agent/workflows/...`, but these exclusions also protect older project-local artifacts.

## Commands

```text
/checkpoint-mode status
/checkpoint-mode continuous   # default: auto-commit after agent turns
/checkpoint-mode explicit     # manual patch checkpoints only
/checkpoint-mode off          # disabled

/checkpoint [label]           # save a patch under .pi/checkpoints
/checkpoint-commit            # immediately commit current changes
/checkpoint-notify on|off     # toggle UI notifications
/checkpoints                  # list patch checkpoints
/checkpoint-show              # show latest patch checkpoint
/diff                         # show git status + diff stats
/revert-last                  # save safety patch, then reset/clean to HEAD
```

## Install

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-checkpoint
```

Then run `/reload` inside Pi.

## Recommended workflow

Use auto-commits as local recovery points. Before shipping, use normal git tools to squash, rebase, drop, or rewrite them into the history you want.

## Safety notes

- Auto-commits are local only.
- The extension never pushes.
- `/revert-last` is destructive after it saves a safety patch checkpoint; inspect your repo state before using it.
- Commit success depends on your repository having valid git author config.

## Development

```bash
npm install
npm run check
```

## License

MIT
