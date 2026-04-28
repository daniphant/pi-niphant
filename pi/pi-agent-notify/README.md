# pi-agent-notify

A small Pi extension that adds completion notifications when Pi finishes a turn.

It is terminal-agnostic:
- **prefers `cmux notify`** when `cmux` is available
- **falls back to terminal OSC notifications**
  - `OSC 99` for **Kitty**
  - `OSC 777` for terminals such as **Ghostty**, **WezTerm**, and many **iTerm-compatible** setups
- **falls back to macOS Notification Center** via `osascript` if needed
- triggers when **Pi finishes a turn** and is ready for your next input

## Why this exists

Pi does not ship this behavior by default.

Codex has explicit notification support, and many terminals can consume standard notification escape sequences directly. This extension brings similar behavior to Pi without changing Pi core.

## What it does

On `agent_end`:
- extracts the last assistant text summary when possible
- sends a notification with title `Pi`
- uses the current project directory as the subtitle when supported

## Important limitation

This extension can reliably notify on **turn completion**.

It **cannot generically detect every possible “Pi needs user input now” state inside arbitrary third-party extensions**, because Pi does not expose a single built-in event for all extension-driven dialogs. If another extension opens a custom `ctx.ui.confirm()` or `ctx.ui.input()` prompt, that extension would need to cooperate and emit its own notification.

## Install

### Global symlink

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-agent-notify
```

Then run `/reload` inside Pi.

### Quick test

```bash
pi --extension ./index.ts
```

## Test

Inside Pi:

```text
/agent-notify-test
```

## Optional environment variables

```bash
export PI_NOTIFY_TITLE="Pi"
export PI_NOTIFY_FALLBACK_BODY="Ready for input"
export PI_NOTIFY_MAX_BODY=180
```

## Repository layout

```txt
extensions/pi-agent-notify/  canonical Pi extension directory with index.ts entrypoint
index.ts                     root re-export for Pi auto-discovery and quick testing
```
