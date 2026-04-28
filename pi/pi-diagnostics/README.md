# pi-diagnostics

Diagnostics, verification, and systematic debugging helpers for [Pi](https://github.com/mariozechner/pi-coding-agent).

This package gives Pi a small diagnostics runner plus a Superpowers-inspired systematic debugging workflow.

## Features

- `/diagnostics` slash command
- `get_project_diagnostics` tool
- automatic local checker detection for common projects
- `/debug-start <issue>` creates a user-local root-cause log
- `/debug-latest` shows the latest debugging log for the current project
- `systematic-debugging` skill with a four-phase process:
  1. root cause investigation
  2. pattern analysis
  3. single-hypothesis testing
  4. implementation + verification

## Systematic debugging law

```text
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
```

The bundled skill pushes Pi to:

- read full error output before acting
- reproduce or gather evidence
- inspect recent changes
- trace bad data backward to the source
- compare broken code with similar working code
- test one hypothesis at a time
- write a regression test or minimal repro before fixing
- verify with fresh command output before claiming success

It also includes patterns for defense-in-depth validation and condition-based waiting for flaky async tests.

## Detected diagnostics

When no command is passed, the extension looks for common project files and runs relevant checks:

| Project signal | Checks |
| --- | --- |
| `package.json` script `typecheck` | `npm run typecheck` |
| `package.json` script `lint` | `npm run lint` |
| `tsconfig.json` | `npx --yes tsc --noEmit` |
| `Cargo.toml` | `cargo check` |
| `go.mod` | `go test ./...` |
| `pyproject.toml` / `requirements.txt` | `ruff check .`, `pyright` when available |

## Install

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-diagnostics
ln -sfn "$PWD/skills/systematic-debugging" ~/.pi/agent/skills/systematic-debugging
```

Then run `/reload` inside Pi.

## Usage

Run auto-detected diagnostics:

```text
/diagnostics
```

Run one explicit command:

```text
/diagnostics npm test -- --runInBand
```

Start a debugging log:

```text
/debug-start flaky login redirect test
```

Find the latest debugging log:

```text
/debug-latest
```

Logs are stored outside the repo:

```txt
~/.pi/agent/debugging/<project-slug>/<timestamp>-debug.md
```

They are not meant to be committed.

## Tool usage

Pi agents can call:

```ts
get_project_diagnostics({
  commands: ["npm run typecheck", "npm test"],
  timeoutMs: 120000
})
```

## Development

```bash
npm install
npm run check
```

## License

MIT
