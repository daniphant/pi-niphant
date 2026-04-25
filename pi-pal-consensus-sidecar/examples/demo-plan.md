# Demo Plan: PAL Consensus Dashboard Sidecar

## Goal

Build a local browser dashboard that reviews implementation plans with multiple role-specific LLM reviewers through PAL MCP. The dashboard should show live model progress, preserve raw feedback, and produce compact structured findings.

## Context

We already have:

- PAL MCP working locally with OpenRouter.
- A Pi extension sidecar that starts a local HTTP/SSE server.
- A dashboard at `http://127.0.0.1:8787`.
- Basic artifact writing under `.pi/pal-consensus-runs/<run-id>/`.

The next step is to harden the sidecar into a useful plan-review workflow.

## Requirements

1. Accept a markdown plan file path from the browser UI.
2. Let the user define reviewer roles, such as:
   - Security reviewer
   - Architecture reviewer
   - Cost/budget reviewer
   - UX/product reviewer
3. Call PAL MCP's `consensus` tool using the selected reviewer models and role prompts.
4. Stream run status to the browser with Server-Sent Events.
5. Save raw per-reviewer feedback as markdown and JSON artifacts.
6. Generate a compact `findings.json` file containing normalized findings.
7. Keep the implementation small and avoid building a custom model-provider layer.

## Proposed Design

The sidecar acts as a local HTTP service and MCP client.

```text
Browser Dashboard
  -> HTTP/SSE
Sidecar Server
  -> MCP stdio client
PAL MCP Server
  -> OpenRouter / configured providers
Models
```

### Server responsibilities

- Serve the dashboard HTML/CSS/JS.
- Accept `POST /api/runs` with:
  - `planFile`
  - reviewer role configs
  - optional PAL command override
- Start PAL MCP as a subprocess.
- Drive the PAL consensus workflow.
- Emit SSE events:
  - `run_started`
  - `pal_connected`
  - `reviewer_started`
  - `reviewer_completed`
  - `synthesis_completed`
  - `run_completed`
  - `run_failed`
- Persist run artifacts.

### Artifact layout

```text
.pi/pal-consensus-runs/<run-id>/
  security.md
  security.json
  architecture.md
  architecture.json
  budget.md
  budget.json
  findings.json
```

## Compact Findings Schema

The final normalized output should look like:

```json
{
  "run_id": "pal-2026-04-25-demo",
  "plan_file": "examples/demo-plan.md",
  "recommendation": "revise",
  "findings": [
    {
      "severity": "major",
      "reviewer": "security",
      "model": "o3",
      "issue": "The local HTTP server has no explicit origin or auth boundary.",
      "recommendation": "Bind to 127.0.0.1 only, document local-only access, and avoid exposing secret-bearing logs.",
      "confidence": "high"
    }
  ],
  "agreements": [
    "Keep PAL MCP as the provider/model layer rather than reimplementing OpenRouter calls."
  ],
  "disagreements": [
    "Whether schema normalization should be done by a final synthesis model or deterministic parser."
  ],
  "raw_artifacts": []
}
```

## Risks / Questions

1. PAL's consensus tool is workflow-oriented; the sidecar must correctly drive multiple steps.
2. Raw PAL output may not always be easy to parse into compact findings.
3. Cost awareness may require model-specific pricing metadata not returned by PAL.
4. Long model calls may need timeout, cancellation, and retry behavior.
5. The browser dashboard should not expose API keys or raw environment variables.

## Success Criteria

The spike is successful if:

- A user can start `/pal-sidecar` in Pi.
- The dashboard opens locally.
- This plan file can be submitted.
- At least two reviewers complete through PAL MCP.
- The browser shows live status updates.
- Raw reviewer artifacts appear on disk.
- `findings.json` is created.

## Non-Goals

- Do not build a custom consensus CLI yet.
- Do not replace PAL MCP's provider routing.
- Do not add multi-user auth or remote deployment.
- Do not require a frontend build system.
