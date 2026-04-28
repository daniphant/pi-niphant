# pi-clear

A `/clear` command for [Pi](https://github.com/mariozechner/pi-coding-agent).

`pi-clear` starts a fresh Pi session and reloads extension state, giving you a Codex/Claude-style context reset while keeping project files and durable workflow artifacts intact.

## Why this exists

Long agent sessions accumulate context, stale assumptions, and tool noise. A deliberate `/clear` boundary makes staged workflows easier:

```text
/workflow ...
/clear
/workflow-spec
/clear
/workflow-plan
/clear
/workflow-implement
```

Use it after finishing a stage, after compaction, or whenever the current conversation is no longer helpful.

## Install

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-clear
```

Then run `/reload` inside Pi.

## Usage

```text
/clear
```

## Notes

- This does not delete files.
- This does not reset git state.
- Pair it with user-local workflow files or checkpoint summaries when you need a durable handoff.

## Development

```bash
npm install
npm run check
```

## License

MIT
