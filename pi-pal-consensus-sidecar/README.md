# pi-pal-consensus-sidecar

Local HTTP/SSE dashboard sidecar that drives [PAL MCP](https://github.com/BeehiveInnovations/pal-mcp-server) consensus reviews.

It gives Pi a browser dashboard for plan-file consensus reviews without replacing PAL's provider/model routing.

See [`ROADMAP.md`](./ROADMAP.md) for the milestone plan.

## What it does

- starts a local HTTP server
- serves a dashboard at `http://127.0.0.1:<port>`
- accepts a markdown plan file plus reviewer roles
- restricts plan files to trusted roots (`cwd`, `~/.pi`, and `PAL_SIDECAR_ALLOWED_ROOTS`)
- protects local POST/SSE endpoints with a per-sidecar CSRF token and localhost Host/Origin checks
- validates PAL's unique model+stance requirement before starting a run
- launches PAL MCP as a stdio subprocess using the MCP SDK
- calls PAL's `consensus` tool step-by-step
- streams reviewer status over SSE
- writes raw per-reviewer artifacts and deterministic normalized `findings.json`

## Install

From this monorepo:

```bash
npm install
npm run check --workspace pi-pal-consensus-sidecar
```

Symlink/install extensions with the repo install script, then `/reload` in Pi.

## Usage

In Pi:

```text
/pal-sidecar
```

Or use the tool:

```ts
start_pal_consensus_sidecar({ port: 8787 })
```

Then open the returned dashboard URL.

## Reviewer model configuration

Default reviewer/model configuration lives in:

```text
pi-pal-consensus-sidecar/pal-sidecar.config.json
```

Built-in stack presets live in:

```text
pi-pal-consensus-sidecar/stacks/frontier-modern.json
pi-pal-consensus-sidecar/stacks/standard-modern.json
pi-pal-consensus-sidecar/stacks/china-open.json
pi-pal-consensus-sidecar/stacks/budget.json
```

Project overrides can be committed per repo as either:

```text
.pal-sidecar.json
.pi/pal-sidecar.json
```

Or point to any config file with:

```bash
export PAL_SIDECAR_CONFIG=/path/to/pal-sidecar.json
```

Later files override earlier files. To ignore committed project config while debugging, set:

```bash
export PAL_SIDECAR_IGNORE_PROJECT_CONFIG=1
```

The common shape is:

```json
{
  "reviewers": [
    {
      "id": "security",
      "label": "Security Reviewer",
      "model": "o3",
      "stance": "neutral",
      "prompt": "Focus on abuse cases, key handling, prompt injection, local server exposure."
    },
    {
      "id": "architecture",
      "label": "Architecture Reviewer",
      "model": "flash",
      "stance": "neutral",
      "prompt": "Focus on clean boundaries and implementation complexity."
    },
    {
      "id": "budget",
      "label": "Cost Reviewer",
      "model": "5.1",
      "stance": "neutral",
      "prompt": "Focus on token budget, OpenRouter cost risk, and ways to cap spend."
    }
  ],
  "minSuccessfulReviewers": 2,
  "defaultStack": "standard-modern",
  "autoStack": true
}
```

You can also override or add stack presets in project config:

```json
{
  "defaultStack": "budget",
  "stacks": {
    "my-project-stack": {
      "label": "My Project Stack",
      "description": "Project-specific reviewer lineup",
      "costTier": "medium",
      "reviewers": [
        {
          "id": "architecture",
          "label": "Architecture Reviewer",
          "model": "flash",
          "stance": "neutral",
          "prompt": "Focus on architecture and implementation risk."
        },
        {
          "id": "budget",
          "label": "Budget Reviewer",
          "model": "5.1",
          "stance": "neutral",
          "prompt": "Focus on token usage and cost risk."
        }
      ],
      "minSuccessfulReviewers": 2
    }
  }
}
```

The dashboard offers a stack selector:

- `auto` chooses a built-in stack from plan keywords.
- `frontier-modern` for high-stakes/security/production/migration plans.
- `standard-modern` for balanced technical review.
- `china-open` for open/china model ecosystem or provider-diversity review.
- `budget` for cost/MVP/prototype/smallest-scope review.
- `custom` uses the editable reviewer form.

PAL requires each reviewer to have a unique `model:stance` pair. If you want the same model twice, give the reviewers different stances such as `neutral` and `against`.

Config validation rejects malformed config before PAL starts, including duplicate reviewer IDs, invalid stances, empty model/prompt fields, duplicate `model:stance` pairs, and invalid `minSuccessfulReviewers`. The effective config returned by `GET /api/config` includes `sources` showing which config paths were loaded, missing, or skipped.

Plan files are allowed from the current project, `~/.pi`, and optional extra roots:

```bash
export PAL_SIDECAR_ALLOWED_ROOTS="$HOME/Projects/plans,$HOME/Documents/plans"
```

## PAL configuration

By default the sidecar launches PAL with:

```bash
uvx --from git+https://github.com/BeehiveInnovations/pal-mcp-server.git pal-mcp-server
```

Configure via env if needed:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
export PAL_MCP_COMMAND=uvx
export PAL_MCP_ARGS="--from git+https://github.com/BeehiveInnovations/pal-mcp-server.git pal-mcp-server"
# Optional: run PAL from a local checkout so its repo-local .env is visible.
export PAL_MCP_CWD="$HOME/src/pal-mcp-server"
# Optional: cancel long runs automatically after this many milliseconds (default 10 minutes).
export PAL_SIDECAR_RUN_TIMEOUT_MS=600000
# Optional: per MCP request/tool-call timeout in milliseconds (default 9 minutes).
export PAL_SIDECAR_MCP_REQUEST_TIMEOUT_MS=540000
# Optional: maximum configured reviewers per run/stack (default 16).
export PAL_SIDECAR_MAX_REVIEWERS=16
```

The sidecar also loads provider keys from these files when the Pi process did not inherit shell exports:

- `PAL_ENV_FILE` if set
- `pi-pal-consensus-sidecar/.env`
- `pi-pal-consensus-sidecar/.pal.env`
- `<repo>/.env`
- `<repo>/.pal.env`
- `$PAL_MCP_CWD/.env` if `PAL_MCP_CWD` is set
- `$PAL_MCP_CWD/.pal.env` if `PAL_MCP_CWD` is set
- `~/.pal/.env`
- `~/.claude/.env`

Example:

```bash
printf 'OPENROUTER_API_KEY=%s\n' 'sk-or-v1-...' > pi-pal-consensus-sidecar/.env
```

Artifacts are written to `.pi/pal-consensus-runs/<run-id>/` by default. Run directories are created with `mkdtemp` and chmod `0700`.

`findings.json` is normalized deterministically from reviewer Markdown. It contains:

- `recommendation`: `approve`, `revise`, or `reject`
- `summary`
- `findings[]` with severity, reviewer, model, issue, recommendation, confidence, and artifact path
- `agreements[]` / `disagreements[]`
- raw concern and approval sections
- raw artifact paths and PAL response payloads

PAL subprocess stderr is captured to `.pi/pal-consensus-runs/<run-id>/pal-stderr.log` so PAL logs do not corrupt the Pi TUI.

## Safety notes

- The HTTP server binds to `127.0.0.1` only.
- Requests with non-local `Host` or `Origin` headers are rejected.
- `POST /api/runs`, `POST /api/runs/:id/cancel`, and run SSE streams require the dashboard-injected CSRF token.
- PAL requires each reviewer to use a unique `model:stance` pair; duplicate pairs are rejected before the run starts.
- The dashboard includes a Cancel button for running jobs; whole-run timeout cancellation is controlled by `PAL_SIDECAR_RUN_TIMEOUT_MS`; individual PAL MCP request timeout is controlled by `PAL_SIDECAR_MCP_REQUEST_TIMEOUT_MS`.
