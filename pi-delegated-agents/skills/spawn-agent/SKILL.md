---
name: spawn-agent
description: Explicit delegated execution only. Use when the user asks to spawn/delegate/run a separate agent, or for browser E2E testing, consensus review, isolated verification, or long-running artifact-producing tasks. Do not use for ordinary code exploration, repo inspection, architecture discovery, or planning unless the user explicitly requests delegation.
---

# Spawn Agent

Use this skill only when the user wants delegated/sub-agent execution rather than synchronous work in the current session.

## Opinionated policy

Delegated agents are allowed for:
- browser/E2E execution that produces screenshots, traces, console logs, network logs, or objective pass/fail results
- consensus/review across multiple models
- independent verification of a completed change or proposed plan
- long-running or isolated tasks with objective artifacts
- explicit user requests such as "spawn an agent", "delegate this", "ask a subagent", or "run a reviewer agent"

Delegated agents are not allowed for ordinary first-pass development work, including:
- exploring a repository or codebase
- finding where code lives
- summarizing architecture
- inspecting frontend/backend structure
- planning implementation when the primary model can read the relevant files directly

If the user asks for ordinary exploration, inspect the files yourself in the main context. Do not call delegated-agent tools.

## What to do

When the request matches the allowed cases above, prefer `run_delegated_agents`.
Use `infer_and_run_delegated_agents` only when the user explicitly requested delegation but did not specify agent names.

Examples of matching requests:
- "spawn an e2e agent to test the login flow"
- "delegate browser verification for this page"
- "run a reviewer agent to independently verify my plan"
- "ask several models for consensus on this migration plan"
- "have a subagent run the long test suite and report failures"

Examples that do not match unless the user explicitly says to delegate:
- "explore this repo"
- "inspect the frontend"
- "analyze the architecture"
- "find where auth is implemented"
- "review this code"

## Tool usage

Call `run_delegated_agents` with one or more clear, scoped tasks.

Good task shape:
- the exact artifact-producing job to perform
- inputs such as URL, plan text, branch, command, or file path
- constraints such as read-only, no edits, collect screenshots/logs, or return pass/fail

Example task:

```text
Run browser verification against http://localhost:3000. Test the signup flow, collect screenshots and console/network errors, and return pass/fail with reproduction steps. Do not edit files.
```

## Agent selection

Use agent profiles that are available in the current environment.
If no named profile is available, use a role label such as `e2e-agent`, `browser-agent`, `consensus-reviewer`, or `verification-agent` and let the extension resolve a dynamic delegated profile.

Use parallel mode when multiple independent verification or consensus agents can work at the same time.

## Response style

Before waiting, briefly tell the user:
- which agent(s) you are delegating to
- what objective artifact/result they are producing
- that you are waiting for results now

Do not manually poll logs unless the user asks.
