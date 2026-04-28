# pi-update-prompt

Replaces Pi's built-in startup update notification with an interactive prompt.

## How Pi checks updates

Pi core does two asynchronous startup checks in interactive mode after the UI and extensions initialize:

1. `checkForNewVersion()` fetches `https://registry.npmjs.org/@mariozechner/pi-coding-agent/latest` and compares `data.version` with the installed package version. If different, core renders an `Update Available` notice with the install command.
2. `checkForPackageUpdates()` uses Pi's `DefaultPackageManager.checkForAvailableUpdates()` for installed Pi packages and renders a separate `Package Updates Available` notice.

Pi skips the core version check when `PI_SKIP_VERSION_CHECK` or `PI_OFFLINE` is set.

## What this extension does

- Sets `PI_SKIP_VERSION_CHECK=1` during extension load so Pi core does not render its built-in version-update popup.
- Runs the same npm registry latest-version check from `session_start`, after Pi's native extension UI is ready.
- Reads the installed version from Pi's exported `VERSION` constant rather than `package.json`, because Pi's package exports do not expose `./package.json`.
- Asks the user with `ctx.ui.confirm()` whether to update now.
- If confirmed, runs:

```bash
npm install -g @mariozechner/pi-coding-agent
```

- Exits gracefully after the update so the next Pi launch uses the updated package.
- Provides `/pi-update-test` to exercise the prompt, fake command delay, status/widget updates, completion notification, and graceful exit without installing anything.

This intentionally uses Pi's native UI API directly, not a model tool call: startup update checks happen outside an LLM turn, so there is no natural model tool-call context. Keeping it direct avoids fabricating a conversation turn just to ask a local lifecycle question.

## Install

From this repository:

```bash
./scripts/install.sh pi-update-prompt
```

Then reload/restart Pi.

## Commands

```text
/pi-update-check  # real update check; may run npm install -g if confirmed
/pi-update-test   # fake update flow; waits briefly, reports success, exits Pi
```
