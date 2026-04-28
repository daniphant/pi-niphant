---
name: spawn-agent
description: Explicit spawn-only delegated execution. Use only when the user's prompt contains the word "spawn" and asks to spawn a delegated/sub-agent. Do not use for consensus, review, browser/E2E, verification, or long-running tasks unless the prompt explicitly says "spawn".
---

# Spawn Agent

Use this skill only when the user's prompt contains the word "spawn" and asks for delegated/sub-agent execution rather than synchronous work in the current session.

Do not use this skill for phrases like "run consensus", "run PAL consensus", "review this", "verify this", "test this", or "run browser review" unless the user also explicitly says to spawn an agent.

## Opinionated policy

Delegated agents are allowed only for explicit spawn requests, such as:
- "spawn an agent to ..."
- "spawn an e2e agent to test the login flow"
- "spawn a reviewer agent to independently verify my plan"
- "spawn several agents for consensus on this migration plan"

Delegated agents are not allowed merely because a task involves browser/E2E work, consensus, review, independent verification, or long-running execution. Those tasks should use their direct tools/workflows unless the user explicitly says "spawn".

Delegated agents are not allowed when the prompt does not contain "spawn", including:
- running PAL/consensus review (for example, "yes, run consensus")
- browser/E2E work or browser review
- code review or plan review
- independent verification
- long-running test execution
- ordinary first-pass development work
- exploring a repository or codebase
- finding where code lives
- summarizing architecture
- inspecting frontend/backend structure
- planning implementation when the primary model can read the relevant files directly

If the user asks for work without saying "spawn", do the work yourself in the main context or use the direct non-delegated tool/workflow. Do not call delegated-agent tools.

## What to do

When the request contains "spawn" and matches the allowed cases above, prefer `run_delegated_agents`.
Use `infer_and_run_delegated_agents` only when the user explicitly said "spawn" but did not specify agent names.

Examples of matching requests:
- "spawn an e2e agent to test the login flow"
- "spawn a browser agent to verify this page"
- "spawn a reviewer agent to independently verify my plan"
- "spawn several agents for consensus on this migration plan"
- "spawn a subagent to run the long test suite and report failures"

Examples that do not match:
- "yes, run consensus"
- "run PAL consensus"
- "delegate browser verification for this page"
- "run a reviewer agent to independently verify my plan"
- "ask several models for consensus on this migration plan"
- "have a subagent run the long test suite and report failures"
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
