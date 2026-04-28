# Demo Plan: Improve the PAL Consensus Sidecar Milestone by Milestone

## Goal

Evolve the Pi PAL Consensus Sidecar from a working spike into a reliable plan-review workflow for Pi projects. The sidecar should keep using PAL MCP for model/provider execution while improving configuration, model discovery, deterministic artifacts, workflow integration, dashboard UX, and safety in small shippable milestones.

## Current State

The sidecar already works end-to-end:

- Pi command starts a local HTTP/SSE dashboard.
- Dashboard accepts a markdown plan file path.
- Plan paths are restricted to trusted roots: project cwd, `~/.pi`, and configured extra roots.
- Sidecar launches PAL MCP as a stdio subprocess.
- Provider keys can be loaded from local `.env` files.
- Reviewer roles call PAL's `consensus` tool one at a time.
- Long PAL MCP requests use an explicit sidecar timeout rather than the MCP SDK default.
- Run events stream to the browser.
- Raw reviewer markdown/JSON artifacts are written to disk.
- A deterministic `findings.json` is generated.
- Runs support cancellation, timeout, partial success, and `/reload` cleanup.
- Reviewer/model configuration can live in JSON and be overridden per project.
- Built-in reviewer stacks exist for frontier, standard, open/china-model, and budget-oriented reviews.

## Problem

The spike is useful, but repeated real-world use is still brittle:

1. Project config can be malformed or conflicting, which makes model discovery and runs unreliable.
2. Model aliases and availability can change, causing runs to fail after the user starts them.
3. PAL MCP itself is an external interface dependency; tool names and response shapes need a contract check.
4. The deterministic findings parser needs tests, prompt-version awareness, and a versioned schema before workflows rely on it.
5. The dashboard shows event logs, but not enough structured run summary or artifact navigation.
6. Workflow integration should consume stable JSON artifacts rather than dashboard-only state.
7. Safety controls must remain baseline requirements, not late polish, because the sidecar handles local file paths, raw model artifacts, and provider-key-bearing environments.
8. Expensive stacks can surprise users before full cost accounting exists.

## Non-Goals

- Do not build a custom consensus CLI.
- Do not bypass PAL MCP for provider/model execution.
- Do not implement custom OpenRouter calls in the sidecar.
- Do not turn the local dashboard into a remote multi-user service.
- Do not replace deterministic `findings.json` with an LLM-only synthesis.

## Proposed Architecture

Keep the current architecture:

```text
Browser dashboard
  -> Pi sidecar HTTP/SSE API
  -> PAL MCP stdio subprocess
  -> PAL consensus/listmodels tools
  -> configured model providers
  -> raw artifacts + deterministic findings.json
```

The sidecar is responsible for orchestration, safety, local UX, configuration, and artifact normalization. PAL remains responsible for model/provider routing.

## Baseline Threat Model and Safety Invariants

The sidecar must preserve these invariants throughout every milestone:

- Bind only to local interfaces.
- Reject non-local Host/Origin requests.
- Require CSRF protection for state-changing endpoints.
- Never return provider keys or full environment variables to the browser.
- Validate plan paths before reading files or launching PAL.
- Treat plan markdown as untrusted content that may contain prompt-injection instructions.
- Preserve raw reviewer artifacts, but do not treat raw LLM text as a trusted workflow gate.
- Fail unsafe or malformed requests before starting PAL when possible.
- Record structured errors without leaking secrets.

## Milestone 1: Config Hardening and Safety Floor

### Scope

Make reviewer/model configuration reproducible, project-overridable, and safe enough for later discovery and workflow integration.

### Tasks

- Keep built-in stack presets in JSON files:
  - `frontier-modern`
  - `standard-modern`
  - `china-open`
  - `budget`
- Support project overrides from:
  - `.pal-sidecar.json`
  - `.pi/pal-sidecar.json`
  - `PAL_SIDECAR_CONFIG`
- Document config merge order explicitly.
- Add an escape hatch to ignore project config, such as `PAL_SIDECAR_IGNORE_PROJECT_CONFIG=1`.
- Add validation for:
  - missing reviewer IDs
  - duplicate reviewer IDs
  - invalid or empty models
  - invalid stances
  - duplicate `model:stance` pairs
  - `minSuccessfulReviewers` less than 1 or greater than reviewer count
  - excessive reviewer count
- Add stack metadata:
  - label
  - description
  - rough cost tier: `low`, `medium`, `high`, or `frontier`
- Show effective stack ID, stack reason, and config source paths in `/api/config`.
- Ensure config errors are actionable and do not start PAL.
- Keep local Host/Origin, CSRF, path allowlist, timeout, and secret-redaction behavior as regression-tested baseline behavior.
- Add tests for config merge order, validation, auto-stack selection, and safety error paths.

### Acceptance Criteria

- A project can commit `.pal-sidecar.json` and change reviewer defaults without editing extension code.
- Invalid config fails before PAL starts.
- A run records selected stack, stack reason, and config context in `findings.json`.
- Existing local safety controls remain covered by tests or repeatable diagnostics.

## Milestone 2: PAL Contract and Model Discovery

### Scope

Use PAL's `listmodels` tool to reveal which models are actually available before starting expensive review runs, while treating PAL MCP as an external contract that can drift.

### Tasks

- Add `GET /api/pal/models`.
- Start PAL MCP with the same command, cwd, env, and timeout behavior used for real runs.
- Add a PAL startup timeout and structured startup errors.
- Check that required PAL tools exist:
  - `consensus`
  - `listmodels`
  - optionally `version`
- Record PAL version/tool metadata when available.
- Call PAL's `listmodels` tool.
- Cache model results with an explicit TTL, such as 5 minutes.
- Return cache metadata:
  - `generated_at`
  - `stale_at`
  - `from_cache`
- Add a dashboard refresh button that bypasses cache.
- Mark each configured stack reviewer as available, unavailable, or unknown.
- If PAL suggests a replacement model, surface that suggestion in the UI.
- Gate discovery behind a runtime flag, such as `PAL_SIDECAR_MODEL_DISCOVERY=0`, so users can disable it if PAL changes unexpectedly.
- Prefer pinning PAL MCP by documented version or git SHA for reproducible behavior; if unpinned, surface that status in diagnostics.

### Acceptance Criteria

- The dashboard can show PAL-visible models.
- Unavailable stack models are visible before a run starts.
- Model discovery failure does not break normal consensus runs.
- The user can refresh model availability without restarting Pi.
- PAL tool/response contract assumptions are documented and checked.

## Milestone 3: Deterministic Findings Schema and Parser Stability

### Scope

Make `findings.json` suitable as a workflow gate and regression-test artifact before building deeper workflow integrations or polished result views.

### Tasks

- Add a `schema_version` field to `findings.json`.
- Add a reviewer prompt version field.
- Add parser fixtures for representative PAL/reviewer markdown.
- Cover complete success, partial success, failed reviewer, malformed PAL response, timeout, empty findings, and prompt-injection-like plan content.
- Normalize severity, confidence, recommendation, and location consistently.
- Preserve raw excerpts for each extracted finding.
- Add diagnostics for parser misses.
- Harden reviewer prompts so plan content is clearly delimited and instructions inside the plan body are treated as untrusted content.
- Keep optional LLM synthesis separate from deterministic findings.

### Acceptance Criteria

- Parser fixture tests pass consistently.
- `findings.json` schema changes are versioned.
- Workflow consumers can rely on deterministic fields without dashboard scraping.
- Prompt and parser versions make output drift visible.

## Milestone 4: Stable Run API and Workflow Integration

### Scope

Make the sidecar useful for plans created by Pi workflow stages, especially files under `~/.pi`, using stable JSON artifacts and API contracts.

### Tasks

- Document reviewing workflow research/spec/plan files.
- Add optional workflow metadata to `POST /api/runs`.
- Include workflow metadata in `findings.json`.
- Publish a stable API contract for:
  - `POST /api/runs`
  - `GET /api/runs`
  - `GET /api/runs/:id/events`
  - `POST /api/runs/:id/cancel`
  - `GET /api/config`
  - `GET /api/pal/models`
- Add a machine-readable run summary suitable for workflow annotations.
- Consider a Pi command that starts the dashboard prefilled with a plan path.

### Acceptance Criteria

- A workflow can submit a plan path and consume `findings.json` programmatically.
- Plan-file allowlists remain explicit and safe.
- API consumers do not depend on dashboard HTML or unstable raw PAL responses.

## Milestone 5: Run UX and Artifact Navigation

### Scope

Make run results understandable without manually opening JSON files, after the core artifact schema is stable.

### Tasks

- Add run cards showing:
  - selected stack
  - status
  - reviewer success count
  - duration
  - cost tier
  - artifact directory
- Add a summary panel for completed runs based on deterministic `findings.json`.
- Add copy buttons for:
  - artifact directory
  - `findings.json`
  - individual reviewer markdown/JSON paths
- Show partial success distinctly from full success.
- Preserve selected run in the URL hash or query string.
- Show model availability warnings beside configured reviewers.

### Acceptance Criteria

- A user can inspect run status and artifact locations from the dashboard.
- Partial runs clearly show which reviewers failed and why.
- Dashboard state reflects stable sidecar JSON artifacts, not one-off event parsing.

## Milestone 6: Operations Limits, Retention, and Spend Guards

### Scope

Add operational controls for local artifact growth, runaway inputs, and accidental expensive runs.

### Tasks

- Add maximum plan size and reviewer count limits.
- Add artifact retention or cleanup settings.
- Add max run duration and per-MCP-call timeout docs.
- Add optional max token or max estimated-cost settings if available through PAL metadata.
- If PAL does not expose cost metadata, add conservative static stack cost warnings first and defer precise accounting.
- Add structured errors for:
  - CSRF failure
  - non-local origin/host
  - disallowed plan path
  - invalid config
  - PAL startup failure
  - model validation failure
  - timeout
  - cancellation
- Add local diagnostics for PAL subprocess crashes and cache staleness.

### Acceptance Criteria

- Unsafe requests fail before PAL starts.
- Local artifacts are controllable and documented.
- Users see cost-tier warnings before launching expensive stacks.
- Errors are actionable and do not expose secrets.

## Milestone 7: Optional Synthesis and Cost Visibility

### Scope

Add higher-level decision support without undermining deterministic artifacts.

### Tasks

- Add optional LLM synthesis as a separate artifact.
- Estimate per-run model/token cost when PAL responses expose enough metadata.
- Add per-reviewer and per-stack cost summaries when possible.
- Add warnings when a selected stack is likely expensive.
- Keep deterministic `findings.json` as the primary machine-readable artifact.

### Acceptance Criteria

- Optional synthesis is clearly marked as model-generated.
- Deterministic findings remain available and stable.
- Users can reason about cost before and after a run.

## Key Risks

1. PAL model catalogs may change over time, so stack presets can become stale.
2. PAL MCP tool names or response shapes may change unless version/contract assumptions are checked.
3. Deterministic parsing can miss nuanced reviewer concerns unless prompts and parser fixtures evolve together.
4. Plan markdown can contain prompt-injection instructions that try to influence reviewer output or downstream workflow gates.
5. Expensive frontier stacks can surprise users without at least coarse cost-tier warnings.
6. More dashboard/API features can increase local attack surface if origin, CSRF, and path checks regress.
7. Workflow integrations can become brittle if they depend on unversioned JSON fields.

## Recommended Next Implementation Step

Implement Milestone 1 first: config hardening plus the safety floor.

Then implement Milestone 2: PAL contract and model discovery.

This ordering matters because model discovery is only useful when it is comparing PAL's model catalog against validated, well-structured stack configuration. It also keeps local safety and secret-redaction controls from becoming late-stage retrofit work.

## Success Criteria for the Next Sidecar Iteration

The next iteration is successful if:

- Project and built-in stack config are validated before PAL starts.
- Config source paths and selected stack metadata are visible.
- Invalid or conflicting reviewer stacks produce actionable errors.
- Existing successful demo runs still work with the default stack.
- Safety invariants remain intact while the config layer becomes more flexible.
