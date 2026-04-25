# Demo Plan: Improve the PAL Consensus Sidecar Milestone by Milestone

## Goal

Evolve the Pi PAL Consensus Sidecar from a working spike into a reliable plan-review workflow for Pi projects. The sidecar should keep using PAL MCP for model/provider execution, while improving configuration, model discovery, run UX, deterministic artifacts, and workflow integration in small shippable milestones.

## Current State

The sidecar already works end-to-end:

- Pi command starts a local HTTP/SSE dashboard.
- Dashboard accepts a markdown plan file path.
- Plan paths are restricted to trusted roots: project cwd, `~/.pi`, and configured extra roots.
- Sidecar launches PAL MCP as a stdio subprocess.
- Provider keys can be loaded from local `.env` files.
- Reviewer roles call PAL's `consensus` tool one at a time.
- Run events stream to the browser.
- Raw reviewer markdown/JSON artifacts are written to disk.
- A deterministic `findings.json` is generated.
- Runs support cancellation, timeout, partial success, and `/reload` cleanup.
- Reviewer/model configuration can live in JSON and be overridden per project.
- Built-in reviewer stacks exist for frontier, standard, open/china-model, and budget-oriented reviews.

## Problem

The spike is useful, but it still has rough edges that make repeated real-world use brittle:

1. Model aliases and availability can change, causing runs to fail after the user starts them.
2. Stack selection is currently heuristic and not very visible to the user.
3. The dashboard shows event logs, but not enough structured run summary or artifact navigation.
4. The deterministic findings parser needs tests and a versioned schema before workflows rely on it.
5. Project configuration needs stronger validation and clearer error messages.
6. Workflow integration should consume stable JSON artifacts rather than dashboard-only state.
7. Safety controls should remain explicit as the sidecar gains more capabilities.

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

## Milestone 1: Harden Reviewer Stack Configuration

### Scope

Make reviewer/model configuration reproducible and project-overridable.

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
- Add validation for:
  - missing reviewer IDs
  - invalid or empty models
  - invalid stances
  - duplicate `model:stance` pairs
  - `minSuccessfulReviewers` greater than reviewer count
- Show effective stack ID and stack reason in the dashboard and `findings.json`.
- Add tests for config merge order and auto-stack selection.

### Acceptance Criteria

- A project can commit `.pal-sidecar.json` and change reviewer defaults without editing extension code.
- Invalid config fails before PAL starts.
- A run records the selected stack and reason in `findings.json`.

## Milestone 2: Add PAL Model Discovery

### Scope

Use PAL's `listmodels` tool to reveal which models are actually available before starting expensive review runs.

### Tasks

- Add `GET /api/pal/models`.
- Start PAL MCP with the same command, cwd, and env used for real runs.
- Call PAL's `listmodels` tool.
- Cache results for a short period.
- Add a dashboard refresh button.
- Mark each configured stack reviewer as available, unavailable, or unknown.
- If PAL suggests a replacement model, surface that suggestion in the UI.

### Acceptance Criteria

- The dashboard can show PAL-visible models.
- Unavailable stack models are visible before a run starts.
- The user can refresh model availability without restarting Pi.

## Milestone 3: Improve Run UX and Artifact Navigation

### Scope

Make run results understandable without manually opening JSON files.

### Tasks

- Add run cards showing:
  - selected stack
  - status
  - reviewer success count
  - duration
  - artifact directory
- Add a summary panel for completed runs.
- Add copy buttons for:
  - artifact directory
  - `findings.json`
  - individual reviewer markdown/JSON paths
- Show partial success distinctly from full success.
- Preserve selected run in the URL hash or query string.

### Acceptance Criteria

- A user can inspect run status and artifact locations from the dashboard.
- Partial runs clearly show which reviewers failed and why.

## Milestone 4: Stabilize Deterministic Findings

### Scope

Make `findings.json` suitable as a workflow gate and regression-test artifact.

### Tasks

- Add a schema version field.
- Add parser fixtures for representative PAL/reviewer markdown.
- Normalize severity, confidence, recommendation, and location consistently.
- Preserve raw excerpts for each extracted finding.
- Add diagnostics for parser misses.
- Keep optional LLM synthesis separate from deterministic findings.

### Acceptance Criteria

- Parser tests cover complete success, partial success, malformed model output, and empty findings.
- `findings.json` can be consumed by other Pi workflow tools without dashboard scraping.

## Milestone 5: Integrate with Pi Workflows

### Scope

Make the sidecar useful for plans created by Pi workflow stages, especially files under `~/.pi`.

### Tasks

- Document reviewing workflow research/spec/plan files.
- Add optional workflow metadata to `POST /api/runs`.
- Include workflow metadata in `findings.json`.
- Add a stable API contract for external callers.
- Consider a Pi command that starts the dashboard prefilled with a plan path.

### Acceptance Criteria

- A workflow can submit a plan path and consume `findings.json` programmatically.
- Plan-file allowlists remain explicit and safe.

## Milestone 6: Safety and Operations Polish

### Scope

Preserve local safety while adding more automation.

### Tasks

- Add maximum plan size and reviewer count limits.
- Add artifact retention or cleanup settings.
- Add structured errors for:
  - CSRF failure
  - non-local origin/host
  - disallowed plan path
  - PAL startup failure
  - model validation failure
  - timeout
  - cancellation
- Ensure provider keys and environment variables never appear in browser responses.
- Consider pinning PAL MCP by git SHA or documented version.

### Acceptance Criteria

- Unsafe requests fail before PAL starts.
- Local artifacts are controllable and documented.
- Errors are actionable for users.

## Milestone 7: Optional Synthesis and Cost Visibility

### Scope

Add higher-level decision support without undermining deterministic artifacts.

### Tasks

- Add optional LLM synthesis as a separate artifact.
- Estimate per-run model/token cost when PAL responses expose enough metadata.
- Add stack-level expected cost labels.
- Add warnings when a selected stack is likely expensive.

### Acceptance Criteria

- Deterministic `findings.json` remains the primary machine-readable artifact.
- Optional synthesis is clearly marked as model-generated.
- Users can reason about cost before starting a run.

## Key Risks

1. PAL model catalogs may change over time, so stack presets can become stale.
2. Deterministic parsing can miss nuanced reviewer concerns unless prompts and parser fixtures evolve together.
3. Expensive frontier stacks can surprise users without clear cost visibility.
4. More dashboard features can increase local attack surface if origin/path checks regress.
5. Workflow integrations can become brittle if they depend on unversioned JSON fields.

## Recommended Next Implementation Step

Implement Milestone 2: PAL model discovery.

This is the highest-leverage next step because reviewer stacks are now configurable, but users still need to know whether PAL/OpenRouter can actually access the configured models before they launch a run.

## Success Criteria for the Next Sidecar Iteration

The next iteration is successful if:

- The dashboard lists PAL-visible models.
- Built-in stack reviewers show availability status.
- The user can refresh model availability.
- A missing model is detected before a consensus run starts when possible.
- Existing successful demo runs still work with the default stack.
