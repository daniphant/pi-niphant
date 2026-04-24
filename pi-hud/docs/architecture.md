# Architecture

pi-hud is intentionally small.

## Modules

- `extensions/pi-hud/index.ts` wires Pi lifecycle events, footer registration, command handling, and quota refresh flow.
- `extensions/pi-hud/providers/` contains provider detection plus Codex and z.ai fetch/parse logic.
- `extensions/pi-hud/format.ts` contains pure formatting helpers.
- `extensions/pi-hud/render.ts` contains pure quota rendering helpers.
- `extensions/pi-hud/settings.ts` owns persistence.
- `extensions/pi-hud/session.ts` computes session totals for `/hud status`.

## Design choices

### Stale-while-refresh cache
The HUD should not blink empty on `/reload`. Cached provider snapshots are shown first, then refreshed.

### Pure parsing helpers
Provider response parsing is separated from HTTP fetches so it can be tested without live network calls.

### One canonical extension directory
`extensions/pi-hud/` is the canonical source and install target. There is no duplicated shipped entrypoint to keep in sync.
