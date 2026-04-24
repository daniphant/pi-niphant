---
name: e2e-web-agent
description: Browser automation and E2E verification using agent-browser. Use when the user needs to open websites, inspect pages, click/fill/select using compact @refs, take screenshots, capture snapshots/text/PDFs, test web apps, reuse auth sessions, or automate browser flows.
---

# E2E Web Agent

This package exposes agent-browser-style browser automation to Pi.

## Core workflow

1. Navigate/capture: call `run_web_e2e` with a URL to collect:
   - full-page screenshot
   - interactive snapshot with `@e1`, `@e2`, ... refs
   - page text
   - metadata/report files
2. Inspect snapshot refs.
3. Interact with `run_agent_browser`:
   - `click @e1`
   - `fill @e2 "value"`
   - `select @e3 "Option"`
   - `press Enter`
4. Re-run `snapshot -i` after navigation or dynamic DOM changes because refs can change.
5. Save screenshots/artifacts under `.pi/web-e2e-runs/...`.

## Important commands

Use `run_agent_browser` commands without the leading `agent-browser`:

```text
open http://localhost:3000
wait --load networkidle
snapshot -i
click @e1
fill @e2 "user@example.com"
press Enter
screenshot --full .pi/web-e2e-runs/login-result.png
get text body
get url
get title
close
```

## Session persistence

Use the `session` parameter for isolated browser contexts:

```text
session: "myapp-login"
commands: ["open http://localhost:3000", "snapshot -i"]
```

Named sessions preserve browser context through the agent-browser daemon. Use explicit state save/load for durable auth state when needed:

```text
state save .pi/web-e2e-runs/auth-state.json
state load .pi/web-e2e-runs/auth-state.json
```

## Good uses

- browser/E2E verification
- reproducing UI bugs
- form automation
- screenshot capture
- visual/layout inspection
- authenticated web workflows
- scraping page text or structured snapshots

## Bad uses

Do not use this for ordinary code exploration, architecture analysis, or finding files.
