# pi-whimsy-status

A Pi extension that replaces the default `Working…` label with rotating whimsical messages.

It adds:
- whimsical status lines with a custom voice
- elapsed runtime
- `esc to interrupt`
- animated shimmer inspired by Codex CLI

## Example

```text
Untangling the context noodles… (12s • esc to interrupt)
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
