---
name: e2e-web-agent
description: Browser automation and E2E verification using agent-browser. Use when the user needs to open websites, inspect pages, click/fill/select using compact @refs, take screenshots, capture snapshots/text/PDFs, test web apps, reuse auth sessions, or automate browser flows.
---

# E2E Web Agent

Use browser tools for live web/UI evidence: rendering, screenshots, snapshots, clicks/forms, visual checks, E2E verification, auth sessions, or page text. Do not use this for ordinary code exploration, architecture discovery, finding files, or reading source; use `read`, `bash`, or `rg`.

## Core workflow

1. When a URL is provided, prefer `run_web_e2e` first with `artifactDir: ".pi/web-e2e-runs/<task>"`. It captures full-page screenshot, interactive snapshot with `@e1` refs, page text, metadata, and report files.
2. Inspect the snapshot before interacting.
3. For multi-step flows use `run_agent_browser`: `open <url>`, `wait --load networkidle`, `snapshot -i`, then current refs (`click @e1`, `fill @e2 "value"`, `select @e3 "Option"`).
4. Re-run `snapshot -i` after navigation or dynamic DOM changes: route changes, async updates, modals/dialogs, form submits, or any DOM-changing action. Do not reuse stale refs.
5. Save screenshots/artifacts under `.pi/web-e2e-runs/...`; keep screenshot, text, and report evidence via paths/artifactDir.
6. Final answers must cite artifact paths and what each proves: screenshot = visual state, snapshot = controls/refs, text = rendered copy, report = commands.

## Sessions

Use the `session` parameter for isolated browser contexts, especially authenticated flows:

```text
session: "myapp-login"
commands: ["open http://localhost:3000", "wait --load networkidle", "snapshot -i"]
```

Named sessions preserve context. For auth, save/load state under `.pi/web-e2e-runs/...`:

```text
state save .pi/web-e2e-runs/auth-state.json
state load .pi/web-e2e-runs/auth-state.json
```
