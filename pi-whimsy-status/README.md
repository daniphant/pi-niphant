# pi-whimsy-status

A Pi extension that replaces the default `Working…` label with rotating whimsical messages.

It adds:
- whimsical status lines with a custom voice
- elapsed runtime
- `esc to interrupt`
- animated shimmer inspired by Codex CLI
- Dot Matrix-inspired activity indicators

## Example

```text
Untangling the context noodles… (12s • esc to interrupt)
```

## Commands

```text
/whimsy-indicator
```

Cycles through the available activity indicators and persists the selected option across reloads in `~/.pi/agent/extensions/pi-whimsy-status.json`:

- Pi Default
- Core Spiral
- Row Sweep
- Pulse Pair
- Orbit Cell
- Braille Beat

You can also set one directly:

```text
/whimsy-indicator default
/whimsy-indicator core-spiral
/whimsy-indicator row-sweep
/whimsy-indicator pulse-pair
/whimsy-indicator orbit-cell
/whimsy-indicator braille-beat
```

## Repository layout

```txt
extensions/pi-whimsy-status/  canonical Pi extension directory with index.ts entrypoint
index.ts                      root re-export for Pi auto-discovery and quick testing
```

## Installation

### Global symlink

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-whimsy-status
```

Then run `/reload` inside Pi.

### Quick test

```bash
pi --extension ./index.ts
```

## Pi package metadata

This repo is also structured as a Pi package:

```json
{
  "pi": {
    "extensions": ["./extensions/pi-whimsy-status"]
  }
}
```

## Development

```bash
npm pack
```

## Publishing

When you're ready:

```bash
npm publish
```

## License

MIT
