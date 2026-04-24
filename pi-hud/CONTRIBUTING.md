# Contributing

Thanks for helping.

## Setup

```bash
npm install
npm run check
```

## What to keep stable

These behaviors are user-visible and should not regress casually:
- model label formatting
- relative path display
- `/hud` command UX
- cached quota behavior across reloads
- weekly toggle persistence

## Before sending a PR

- run `npm run check`
- test the extension in Pi with `/reload`
- verify at least one provider path you touched
- update docs if command or config behavior changed

## Good PRs

- small, isolated changes
- tests for parsing or formatting logic
- clear screenshots for visual changes

## Bug reports

Include:
- Pi version
- active model/provider
- expected HUD output
- actual HUD output
- whether `~/.pi/agent/extensions/pi-hud.json` had cached data
