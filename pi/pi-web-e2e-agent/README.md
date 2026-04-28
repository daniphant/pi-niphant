# pi-web-e2e-agent

Browser and E2E verification tools for [Pi](https://github.com/mariozechner/pi-coding-agent), powered by [`agent-browser`](https://www.npmjs.com/package/agent-browser).

This package gives Pi compact browser automation primitives: open pages, capture screenshots, inspect interactive snapshots with `@refs`, click/fill/select elements, and save artifacts.

## Features

- `/e2e <url> [task]` page capture command
- `run_web_e2e` tool for one-shot page capture
- `run_agent_browser` tool for multi-step browser flows
- persistent named browser sessions
- interactive `snapshot -i` support with compact `@e1`-style refs
- screenshots, page text, metadata, and JSON reports
- browser/E2E skill guidance for Pi agents

## Why this exists

Browser work is one of the cases where delegated/tool-driven artifact production is valuable. Screenshots, snapshots, page text, console/network captures, and repeatable browser actions give concrete evidence that code works in the UI.

## Install

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-web-e2e-agent
ln -sfn "$PWD/skills/e2e-web-agent" ~/.pi/agent/skills/e2e-web-agent
```

Then run `/reload` inside Pi.

The extension will use a project-local `node_modules/.bin/agent-browser` if present, otherwise it falls back to:

```bash
npx --yes agent-browser
```

## Quick capture

```text
/e2e http://localhost:3000 verify the landing page renders
```

This captures:

- full-page screenshot
- interactive snapshot
- page text
- metadata
- JSON command report

Default artifact location:

```txt
.pi/web-e2e-runs/<timestamp>/
```

## Multi-step browser flow

Pi agents can call:

```ts
run_agent_browser({
  session: "login-flow",
  commands: [
    "open http://localhost:3000/login",
    "wait --load networkidle",
    "snapshot -i",
    "fill @e2 user@example.com",
    "fill @e3 correct-horse-battery-staple",
    "click @e4",
    "snapshot -i",
    "screenshot --full .pi/web-e2e-runs/login/result.png"
  ]
})
```

Recommended workflow:

1. `open <url>`
2. `wait --load networkidle`
3. `snapshot -i`
4. interact with `@refs`
5. re-run `snapshot -i` after DOM changes
6. capture screenshot/report artifacts

## Tool APIs

### `run_web_e2e`

```ts
run_web_e2e({
  url: "http://localhost:3000",
  task: "Verify hero and CTA are visible",
  session: "optional-session-name",
  artifactDir: ".pi/web-e2e-runs/home",
  fullPage: true,
  timeoutMs: 60000
})
```

### `run_agent_browser`

```ts
run_agent_browser({
  commands: ["open http://localhost:3000", "snapshot -i"],
  session: "optional-session-name",
  artifactDir: ".pi/web-e2e-runs/manual",
  timeoutMs: 60000,
  stopOnError: true
})
```

## Development

```bash
npm install
npm run check
```

## License

MIT
