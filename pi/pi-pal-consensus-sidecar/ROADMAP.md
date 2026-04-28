# PAL Consensus Sidecar Roadmap

This package is intentionally a thin local dashboard around PAL MCP. It should keep delegating model/provider behavior to PAL while the sidecar improves orchestration, safety, configuration, artifacts, and workflow UX.

## North star

Given a markdown plan file, the sidecar should make it easy to run the right reviewer stack, stream progress locally, persist raw evidence, and produce deterministic machine-readable findings that Pi workflows can consume.

```text
Browser dashboard
  -> Pi sidecar HTTP/SSE
  -> PAL MCP stdio subprocess
  -> PAL consensus/listmodels tools
  -> provider models via PAL/OpenRouter/etc.
  -> raw reviewer artifacts + deterministic findings.json
```

## Non-goals for now

- Do not build a custom consensus CLI.
- Do not bypass PAL for model/provider execution.
- Do not require the dashboard for workflow integration; HTTP/API should remain scriptable.
- Do not make local files or keys reachable from non-local hosts.

## Milestone 0 — Working local sidecar baseline

Status: complete.

- Local-only HTTP dashboard.
- SSE run events.
- PAL MCP stdio subprocess launch.
- `.env` loading for provider keys.
- Plan-file allowlist including project root, `~/.pi`, and configured roots.
- Raw artifacts per reviewer.
- Deterministic `findings.json`.
- Cancellation, timeout, reload cleanup.
- Basic config and stack presets.

Acceptance:

- Demo plan completes with at least the configured `minSuccessfulReviewers`.
- `findings.json` contains recommendation, successful/failed reviewer counts, raw artifact paths, and extracted findings.

## Milestone 1 — Reviewer stacks and project configuration

Status: in progress.

Goal: make model/reviewer selection configurable, reproducible, and easy to override per project.

Implemented:

- Default config: `pal-sidecar.config.json`.
- Project overrides: `.pal-sidecar.json`, `.pi/pal-sidecar.json`, `PAL_SIDECAR_CONFIG`.
- Built-in stack presets:
  - `frontier-modern`
  - `standard-modern`
  - `china-open`
  - `budget`
- Dashboard stack selector.
- Deterministic auto-stack heuristic.

Next tasks:

- [ ] Add config validation errors with actionable messages.
- [ ] Display effective config source paths in `/api/config`.
- [ ] Include stack metadata in run list cards.
- [ ] Add a `copy project override` button or docs snippet in the dashboard.
- [ ] Add tests for config merge order and stack selection.

Acceptance:

- A repo can commit `.pal-sidecar.json` and change defaults without editing extension code.
- `auto` records `stack_id` and `stack_reason` in `findings.json`.
- Invalid config fails before PAL is launched.

## Milestone 2 — PAL model discovery and availability

Goal: stop guessing model aliases and let PAL report available models.

Tasks:

- [ ] Add `GET /api/pal/models` endpoint.
- [ ] Call PAL MCP `listmodels` with the same env/cwd as a real run.
- [ ] Cache model list briefly, with a refresh button.
- [ ] Show provider/model availability in the dashboard.
- [ ] Make stack presets visibly warn when a configured model is unavailable.
- [ ] Optionally offer nearest PAL-suggested replacement models.

Acceptance:

- Dashboard can list PAL-visible models.
- User can identify unavailable stack models before starting a run.
- A run with unavailable models fails validation early when possible.

## Milestone 3 — Run UX and artifact navigation

Goal: make completed and partial runs easy to inspect.

Tasks:

- [ ] Improve run cards with stack, model count, success count, and duration.
- [ ] Show partial vs complete status clearly.
- [ ] Add artifact path copy buttons.
- [ ] Add findings summary panel in the dashboard.
- [ ] Add per-reviewer status cards with links/paths for `.md` and `.json` artifacts.
- [ ] Preserve selected run on refresh via URL hash/query.

Acceptance:

- A user can tell which reviewers succeeded/failed without opening raw JSON.
- A user can copy `findings.json` and artifact dir paths from the dashboard.

## Milestone 4 — Deterministic findings hardening

Goal: make `findings.json` stable enough for workflow gates and regression tests.

Tasks:

- [ ] Add parser fixtures for representative reviewer markdown.
- [ ] Normalize severity, confidence, locations, and recommendations more consistently.
- [ ] Preserve raw excerpts for each finding.
- [ ] Add schema/version field to `findings.json`.
- [ ] Add diagnostics for parser misses.
- [ ] Keep deterministic parsing separate from any future LLM synthesis.

Acceptance:

- Fixture tests cover success, partial failure, malformed PAL responses, and empty findings.
- `findings.json` schema changes are versioned.

## Milestone 5 — Workflow integration

Goal: make Pi workflow stages able to consume sidecar output predictably.

Tasks:

- [ ] Document how workflow plan/spec files under `~/.pi` should be reviewed.
- [ ] Add a stable run API contract for external callers.
- [ ] Add optional `POST /api/runs` fields for workflow metadata.
- [ ] Add a machine-readable summary suitable for workflow annotations.
- [ ] Consider a Pi command that starts the sidecar and opens a prefilled plan path.

Acceptance:

- A Pi workflow can submit a plan path and read deterministic findings without scraping dashboard HTML.
- Plan roots remain safe and explicit.

## Milestone 6 — Safety, privacy, and operations polish

Goal: keep local execution safe as the sidecar becomes more useful.

Tasks:

- [ ] Add security checklist to README.
- [ ] Ensure raw artifacts never include env vars or keys from sidecar logs.
- [ ] Add configurable artifact retention/cleanup.
- [ ] Add maximum plan size and reviewer count limits.
- [ ] Add structured error types for CSRF, origin, allowlist, PAL startup, model validation, timeout, and cancellation.
- [ ] Consider pinning PAL MCP git SHA/tag in docs or config.

Acceptance:

- Unsafe hosts/origins remain rejected.
- Oversized or unsafe requests fail before PAL starts.
- Local artifact retention is controllable.

## Milestone 7 — Optional synthesis and cost visibility

Goal: improve decision support without undermining deterministic artifacts.

Tasks:

- [ ] Add optional LLM synthesis as a separate artifact, not a replacement for deterministic findings.
- [ ] Estimate token/model cost from PAL responses where available.
- [ ] Add per-run cost budget warnings.
- [ ] Add stack-level expected-cost labels.

Acceptance:

- Deterministic `findings.json` remains available and stable.
- Optional synthesis is clearly marked as model-generated.

## Suggested immediate next milestone

Do Milestone 2 next: PAL model discovery.

Reason: stack presets are only useful if users can see which models PAL/OpenRouter can actually access. Model availability already caused failures with aliases such as `pro` and `flashlite`, so discovery removes guesswork and improves confidence before expanding workflow integration.

## Working rules

- Keep each milestone independently shippable.
- Add tests when behavior becomes deterministic or config-driven.
- Prefer explicit JSON artifacts over dashboard-only state.
- Prefer improving PAL MCP integration over duplicating PAL logic.
- Keep browser dashboard as a client of the sidecar API, not the source of truth.
