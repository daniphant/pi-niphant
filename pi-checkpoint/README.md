# pi-checkpoint

Continuous local auto-commits for [Pi](https://github.com/mariozechner/pi-coding-agent).

By default, `pi-checkpoint` creates a local git commit after Pi agent turns that look complete and meaningful. It is designed as a recovery layer for long agent sessions, `/clear` boundaries, compaction, and multi-stage workflows without filling history with low-signal WIP commits.

It never pushes.

## Features

- smart local auto-commits by default
- one-line conventional commit messages
- manual patch checkpoints under `.pi/checkpoints`
- quick diff/status command
- safety checkpoint before destructive revert
- modes for continuous, explicit-only, or disabled operation
- explicit exclusion of planning artifacts from auto-commits

## Default behavior

After each agent turn in `smart` mode:

1. verify the current directory is inside a git repository
2. check whether the working tree changed
3. stage changes
4. exclude local Pi planning/checkpoint artifacts
5. skip the commit if the final agent response looks incomplete, research-only, or validation-pending
6. commit with a one-line conventional commit subject inferred from the changed files and recent prompt/agent summary

Example commit messages:

```text
feat(pi-hud): add session timer to hud
fix(pi-checkpoint): improve auto-commit messages
docs(pi-checkpoint): update documentation
chore(repo): update package metadata
```

Auto-commit messages intentionally have no `[gstack-context]` block or other hidden metadata body.

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
/checkpoint-mode smart        # default: commit complete/meaningful agent turns
/checkpoint-mode continuous   # commit every changed agent turn
/checkpoint-mode explicit     # manual patch checkpoints only
/checkpoint-mode off          # disabled

/checkpoint [label]           # save a patch under .pi/checkpoints
/checkpoint-commit [title]    # immediately commit current changes, optionally with exact title
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

Use smart auto-commits as local recovery points that are already close to useful conventional commits. Before shipping, you can still use normal git tools to squash, rebase, drop, or rewrite them into the history you want.

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
