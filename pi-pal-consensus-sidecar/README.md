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

`check` typechecks the sidecar, runs unit tests, and builds the Vite dashboard into:

```text
pi-pal-consensus-sidecar/dashboard-build/
```

Symlink/install extensions with the repo install script, then `/reload` in Pi.

## Usage

In Pi:

```text
/pal-sidecar
```

Or use the dashboard-start tool:

```ts
start_pal_consensus_sidecar({ port: 8787 })
```

Then open the returned dashboard URL.

Agents can also run PAL consensus directly without using the browser dashboard:

```ts
run_pal_consensus_review({
  planFile: "/path/to/plan.md",
  stackId: "auto",
  wait: true
})
```

Or pass ad-hoc plan text; the tool writes it to `.pi/pal-consensus-inputs/*.md` before review:

```ts
run_pal_consensus_review({
  title: "Framework Migration Decision",
  planText: "Evaluate whether to migrate the dashboard to Vite + React...",
  stackId: "standard-modern"
})
```

The direct tool uses the same sidecar engine, PAL MCP subprocess, config validation, trusted roots, artifacts, and deterministic `findings.json` as the dashboard.

## PAL contract and model discovery

The sidecar exposes backend-only discovery endpoints for checking PAL MCP compatibility and configured stack availability before running consensus:

```text
GET /api/pal/contract
GET /api/pal/models
GET /api/pal/models?refresh=1
```

`/api/pal/contract` starts PAL MCP, lists tools, and reports whether required tools are present:

```json
{
  "ok": true,
  "tools": ["consensus", "listmodels"],
  "required": {
    "consensus": true,
    "listmodels": true,
    "version": false
  }
}
```

`/api/pal/models` calls PAL `listmodels`, parses model ids conservatively, caches the result, and compares configured reviewer stacks against discovered ids/aliases:

```json
{
  "enabled": true,
  "from_cache": false,
  "generated_at": "...",
  "stale_at": "...",
  "models": [{ "id": "openai/gpt-5.5", "provider": "openai" }],
  "stacks": {
    "standard-modern": {
      "available": 10,
      "unavailable": 1,
      "unknown": 0,
      "reviewers": []
    }
  }
}
```

Configuration:

```bash
# Disable discovery endpoint behavior without affecting consensus runs.
export PAL_SIDECAR_MODEL_DISCOVERY=0

# Cache discovered models for 5 minutes by default.
export PAL_SIDECAR_MODEL_CACHE_TTL_MS=300000

# Run validation policy for configured stack model availability.
# Default is warn: runs proceed and record warnings.
export PAL_SIDECAR_MODEL_AVAILABILITY_POLICY=warn # off | warn | block
```

When the policy is `warn`, unavailable stack models produce run warnings and `model_availability_warning` SSE events but do not block the run. When the policy is `block`, the sidecar rejects the run before PAL consensus starts if PAL `listmodels` does not report one or more selected stack models.

Discovery never returns provider environment variables or API keys. Failures are isolated to discovery/model-availability warnings and do not disable normal consensus runs by default.

## Run artifact APIs

Run artifacts are exposed through safe per-run APIs. They only read files inside the selected run's artifact directory and only allow simple artifact file names with known text extensions.

```text
GET /api/runs/:id/artifacts
GET /api/runs/:id/artifacts/read?name=findings.json
```

The manifest endpoint returns file metadata:

```json
{
  "runId": "pal-...",
  "artifactDir": "...",
  "artifacts": [
    {
      "name": "findings.json",
      "kind": "findings",
      "mediaType": "application/json; charset=utf-8",
      "bytes": 12345,
      "modifiedAt": "..."
    }
  ]
}
```

The read endpoint returns UTF-8 content and truncates large artifacts:

```bash
export PAL_SIDECAR_MAX_ARTIFACT_READ_BYTES=1048576
```

Traversal attempts, nested paths, hidden files, and unknown extensions are rejected.

## Operational limits and retention

The sidecar applies conservative local safety limits before PAL starts:

```bash
# Reject plan files or direct planText above 256 KiB by default.
export PAL_SIDECAR_MAX_PLAN_BYTES=262144

# Keep one PAL run active by default to avoid overlapping provider spend/subprocesses.
export PAL_SIDECAR_MAX_CONCURRENT_RUNS=1

# Bound in-memory completed run history.
export PAL_SIDECAR_MAX_RUNS=50
export PAL_SIDECAR_RETENTION_DAYS=14

# Artifact deletion is opt-in. Only pal-* directories under the artifact root are considered.
export PAL_SIDECAR_CLEAN_ARTIFACTS=0
```

`GET /api/health` reports the effective limit values, current active run count, model discovery status, model cache TTL, and model availability policy. Artifact cleanup is intentionally disabled by default; enabling it only removes expired `pal-*` run directories under the sidecar artifact root.

## Findings schema and structured errors

Every run writes `findings.json` plus a human-readable `findings-summary.md`. `findings.json` is intentionally normalized for agent consumption and includes stable version metadata so downstream workflow steps can detect parser/prompt/schema changes:

```json
{
  "schema_version": "2026-04-25.1",
  "parser_version": "deterministic-markdown-v1",
  "prompt_version": "plan-review-v1",
  "sidecar_version": "0.1.0",
  "summary": {
    "recommendation": "revise",
    "blocking_count": 2,
    "suggestion_count": 4,
    "question_count": 1,
    "reviewer_success": "11/11",
    "failed_reviewer_count": 0,
    "warning_count": 0,
    "total_findings": 7
  },
  "blocking_findings": [],
  "suggestion_findings": [],
  "question_findings": [],
  "hotspots": []
}
```

`findings-summary.md` contains the same normalized result as Markdown: recommendation, reviewer success, blocking findings, suggestions, questions/clarifications, hotspots, and failed reviewers.

Run failures also include a structured error with retryability and operator guidance where possible:

```json
{
  "code": "pal_timeout",
  "message": "...",
  "retryable": true,
  "guidance": "Retry later, use fewer reviewers, or raise PAL_SIDECAR_TOOL_WAIT_TIMEOUT_MS for long reviews."
}
```

Known error codes include `plan_file_not_found`, `plan_file_too_large`, `concurrency_limit_exceeded`, `plan_file_untrusted_root`, `pal_provider_key_missing`, `pal_provider_auth_failed`, `pal_contract_mismatch`, `pal_timeout`, `pal_rate_limited`, `pal_quota_exceeded`, `pal_model_no_endpoint`, `pal_model_not_found`, `pal_context_length_exceeded`, `pal_content_policy_block`, `pal_upstream_unavailable`, `pal_network_error`, `pal_malformed_response`, `pal_subprocess_failed`, `run_cancelled`, `invalid_reviewer_config`, `no_reviewers_configured`, `duplicate_model_stance`, `model_unavailable`, `insufficient_successful_reviewers`, and `unknown_error`.

## Dashboard frontend

The dashboard is a Vite + React + TypeScript static app served by the sidecar. Runtime API behavior remains under `/api/*`; the frontend has no direct PAL/provider access.

Important safety properties:

- built assets are served only from `dashboard-build`
- static paths are resolved and checked against the dashboard asset root
- dashboard responses include a strict CSP
- no external CDN/runtime assets are required

## Packaging and release checks

The published package explicitly includes the runtime TypeScript extension source, built dashboard assets, stack presets, and README via `package.json#files`:

```text
index.ts
src/
stacks/
dashboard-build/
README.md
```

Run this before publishing or validating package contents:

```bash
npm run pack:check --workspace pi-pal-consensus-sidecar
```

`prepack` runs the dashboard build so `dashboard-build` is current when `npm pack`/publish is invoked. If the dashboard route returns a missing-asset error after installing from a checkout, run:

```bash
npm run build --workspace pi-pal-consensus-sidecar
```

then `/reload` inside Pi.

## Stack recommendation policy

`stackId: "auto"` and `POST /api/recommend-stack` use a cost-aware recommendation policy:

- `standard-modern` is the default for ordinary technical plans.
- `budget` is selected only for explicit cost/MVP/prototype/smallest-scope language.
- `china-open` is selected only for explicit open/local/provider-diverse model language.
- `frontier-modern` is selected only for stronger high-stakes signals such as payments, auth, PII, compliance, secrets, multi-tenancy, or irreversible customer-data risk.

`/api/recommend-stack` preserves `stackId` and `reason`, and also returns `scores`, `signals`, and cached `availability` when model discovery has already run. Recommendation does not start PAL model discovery by itself.

## Built-in stack validation

Built-in stack presets are covered by offline tests in:

```text
pi-pal-consensus-sidecar/test/stacks.test.ts
pi-pal-consensus-sidecar/test/fixtures/pal-models.json
```

The fixture is a snapshot of PAL/OpenRouter `listmodels`. Tests fail if a built-in stack references a model not present in the fixture, duplicates reviewer ids, duplicates `model:stance`, uses an invalid cost tier/stance, or has an invalid `minSuccessfulReviewers` threshold. Refresh the fixture intentionally when PAL's model catalog or stack presets change.

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
