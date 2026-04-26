# pi-discord-presence

Privacy-conscious Discord Rich Presence for [Pi](https://github.com/mariozechner/pi-coding-agent).

`pi-discord-presence` publishes a compact Discord Rich Presence activity while Pi is running. It is designed to feel like a Pi-native equivalent of editor presence extensions while keeping public status generic by default.

## Current default

Presence is enabled when the extension loads, but public fields are non-identifying unless you opt in:

- Details: `Working in Pi`
- State: `AI model • N Pi session(s)`
- Large image: `pi-logo` when that asset exists on the configured Discord application
- Status text: `Agent working`, `Waiting for input`, or `Idle`
- Timestamp: elapsed time for the elected publishing Pi session
- Buttons: none

Project and model labels are hidden by default. When enabled, labels are normalized, sanitized, and truncated before they are written to Discord or the local registry.

## Installation

Install this package like any other local Pi package in this repository. During development:

```sh
npm install --workspace pi-discord-presence
```

Then add/load the package through your normal Pi package workflow.

## Discord application / client ID

Discord Rich Presence uses a local Discord RPC connection and requires a Discord Application client ID. The package supports client ID sources in this order:

1. `PI_DISCORD_CLIENT_ID` environment variable
2. persisted extension settings, if configured by a future command/manual settings edit
3. package default client ID

The current package default is intentionally a placeholder. For real validation, create a Discord Developer Application and set:

```sh
export PI_DISCORD_CLIENT_ID="123456789012345678"
```

Recommended Developer Portal setup:

1. Create an application in the Discord Developer Portal.
2. Copy the Application ID/client ID.
3. Add a Rich Presence asset named `pi-logo` for the large image.
4. Optionally add small status assets later; the MVP only relies on status text.
5. Start the Discord desktop client and Pi with `PI_DISCORD_CLIENT_ID` set.

Missing assets should not break Pi; the extension continues and Discord may simply omit images.

## Commands

```text
/discord-presence status
/discord-presence on
/discord-presence off
/discord-presence reconnect
/discord-presence show-project
/discord-presence hide-project
/discord-presence show-model
/discord-presence hide-model
```

- `status` reports enabled/disabled state, connection state, client ID source, privacy mode, and reconnect attempt count without printing raw client IDs or exact activity timestamps.
- `on` enables presence and persists the preference.
- `off` disables presence, clears activity best-effort, releases leadership, stops reconnect attempts, and persists the preference.
- `reconnect` resets backoff and attempts to reconnect when enabled and configured.
- `show-project` / `hide-project` opt into or out of sanitized project labels.
- `show-model` / `hide-model` opt into or out of sanitized model labels.

Commands check UI availability before showing notifications and degrade in non-interactive contexts.

## Privacy guarantees

The extension must never publish or store:

- prompts
- user or assistant message contents
- generated summaries
- filenames
- full paths
- branch names
- tool names or arguments
- raw client IDs in status output
- raw project/model labels before sanitization

The local registry stores only privacy-safe fields: random instance ID, PID for best-effort liveness/debugging, coarse timestamps needed for freshness/election, sanitized/generic project and model labels, generic status, and minimal connection metadata.

## Local registry and multi-instance behavior

Multiple Pi processes coordinate through:

```text
~/.pi/agent/extensions/pi-discord-presence/instances.json
~/.pi/agent/extensions/pi-discord-presence/leader.lock
```

Each instance writes a heartbeat about every 15 seconds with jitter. Exactly one leader should hold the publishing lease and connect to Discord. The leader publishes aggregate session count plus the last-active live instance details. Stale heartbeats expire, and expired leader leases can be acquired by another process.

Best-effort permissions:

- directory: `0700`
- files: `0600`
- symlink writes are refused where detectable

On non-POSIX platforms, mode enforcement may be limited by the OS.

## Local trust boundary

Discord RPC uses local IPC to communicate with the Discord desktop client. A malicious process running as the same user may be able to observe or interfere with local IPC or local registry files. This extension minimizes and sanitizes local metadata, but it cannot protect against a compromised user account.

Environment variables can be visible to other local processes on some systems. For stable private configuration, a settings file is preferable when supported by your workflow.

## Troubleshooting

- **`clientIdSource=missing`**: set `PI_DISCORD_CLIENT_ID` or configure a valid Discord Application ID.
- **Discord closed/unavailable**: open the Discord desktop client and run `/discord-presence reconnect`.
- **No image appears**: ensure the configured application has a Rich Presence asset named `pi-logo`; otherwise Discord may omit images.
- **Presence is too specific**: run `/discord-presence hide-project` and `/discord-presence hide-model`.
- **Presence should stop**: run `/discord-presence off`.

## Development

```sh
cd pi-discord-presence
npm run typecheck
npm run test
npm run check
```

Runtime validation with real Discord requires a configured client ID:

```sh
PI_DISCORD_CLIENT_ID="123456789012345678" pi
```

If `@xhayper/discord-rpc` is incompatible with a local runtime, the integration is isolated in `extensions/pi-discord-presence/discord-rpc.ts` for replacement.

## Validation status

Automated validation currently passes with `npm run check --workspace pi-discord-presence` and a Pi extension-load smoke test using `pi --no-extensions -e ./pi-discord-presence/extensions/pi-discord-presence/index.ts --offline --no-tools --print "Say ok"`.

Manual live Discord validation has not been completed in this environment because no real Discord Application client ID/assets were provided. The packaged default client ID remains a placeholder, so set `PI_DISCORD_CLIENT_ID` for real Rich Presence testing.
