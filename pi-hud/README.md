# pi-hud

<img width="1672" height="1069" alt="Screenshot 2026-04-12 at 21 30 16" src="https://github.com/user-attachments/assets/a0598e9c-7273-4745-b9b5-d31169b90f3c" />

A custom Pi footer/HUD extension inspired by [Claude HUD](https://github.com/jarrodwatts/claude-hud) and [CodexBar](https://github.com/steipete/codexbar).

It adds a denser, more legible status line with:
- active model + thinking level + context window
- relative project path + git branch
- context usage bar
- provider-aware usage bars for Codex and z.ai / GLM
- persistent `/hud` toggles across reloads and sessions

## Status

Early but real. This repo was extracted from a working local Pi extension and is being hardened for public release.

## Features

- Model label like `GPT 5.4 medium (400k)`
- Project label like `~/projects/pi-hud (main)`
- Colored context usage meter
- Quota-aware usage meter for Codex and z.ai / GLM
- Optional weekly window display
- Stale-while-refresh quota cache to avoid blank bars on reload
- `/hud on|off|status|weekly [on|off]`

## Repository layout

```txt
extensions/pi-hud/     canonical Pi extension directory with index.ts entrypoint
test/                  unit tests
docs/                  user-facing docs
```

## Installation

Install it as a local Pi extension directory, which matches Pi's normal multi-file extension pattern.

1. Clone this repo.
2. Symlink `extensions/pi-hud/` into your Pi extensions directory.
3. Reload Pi.

Example:

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn ~/projects/pi-hud/extensions/pi-hud ~/.pi/agent/extensions/pi-hud
```

Then run `/reload` inside Pi.

## Pi package metadata

This repo is also structured as a Pi package:

```json
{
  "pi": {
    "extensions": ["./extensions/pi-hud"]
  }
}
```

## Commands

- `/hud` toggles the HUD
- `/hud on`
- `/hud off`
- `/hud status`
- `/hud weekly`
- `/hud weekly on`
- `/hud weekly off`
- `/hud help`

## Provider support

### Codex
Reads auth from:
- `~/.codex/auth.json`

Uses:
- `https://chatgpt.com/backend-api/wham/usage`

### z.ai / GLM
Uses Pi model auth via `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)`.

Default quota endpoint:
- `https://api.z.ai/api/monitor/usage/quota/limit`

Optional overrides:
- `Z_AI_QUOTA_URL`
- `Z_AI_API_HOST`

## Persistence

Settings and cached quota snapshots are stored in:

```txt
~/.pi/agent/extensions/pi-hud.json
```

Stored values:
- `enabled`
- `showWeeklyLimits`
- `quotaCache`

## Development

```bash
npm install
npm run check
```

## Roadmap

- richer install flow
- debug mode
- more provider support
- packaging for easier Pi distribution

## License

MIT
