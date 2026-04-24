---
name: systematic-debugging
description: Use when encountering any bug, test failure, build failure, flaky test, performance issue, integration issue, or unexpected behavior, before proposing fixes.
---

# Systematic Debugging

Inspired by Superpowers' systematic-debugging discipline, adapted for Pi.

## Iron Law

```text
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
```

If Phase 1 is not complete, do not propose or implement a fix. Symptom patches are failure.

## Pi-specific posture

- The main model investigates directly. Do **not** spawn exploration subagents.
- Use `get_project_diagnostics` or shell commands for evidence.
- Use browser/E2E tools only when the bug is UI/browser-observable.
- Use consensus only for frozen hypotheses/plans when the issue is risky or architectural.
- Create a user-local debug log with `/debug-start <issue>` for non-trivial bugs. Logs live under `~/.pi/agent/debugging/<project>/` and should not be committed.
- Continuous WIP auto-commits are recovery checkpoints only; do not treat a commit as proof of correctness.

## When to use

Use for:

- test failures
- production bugs
- build/type/lint failures
- flaky tests
- performance regressions
- integration failures
- unexpected behavior
- any issue where a quick fix feels tempting

Especially use when:

- already tried a fix and it failed
- under time pressure
- stack trace is deep
- multiple components are involved
- the user says “stop guessing”, “is that actually happening?”, or similar

## Four phases

### Phase 1 — Root Cause Investigation

Before any fix:

1. **Read error output completely**
   - stack traces
   - file paths and line numbers
   - error codes
   - warnings before the fatal error

2. **Reproduce or gather evidence**
   - exact command/steps
   - frequency
   - environment
   - whether the issue is deterministic

3. **Check recent changes**
   - `git status --short`
   - `git diff`
   - recent commits when useful
   - dependency/config/env changes

4. **Instrument component boundaries when needed**
   - log data entering each layer
   - log data leaving each layer
   - verify env/config propagation
   - identify the first layer where reality diverges

5. **Trace bad data backward**
   - where is the symptom observed?
   - what immediate operation fails?
   - what called it?
   - where did the bad value/state originate?
   - fix at the source, not the symptom

### Phase 2 — Pattern Analysis

Find the pattern before fixing:

1. Locate similar working code in the repo.
2. Read relevant reference implementations fully enough to understand the pattern.
3. List differences between working and broken code.
4. Identify required dependencies, config, timing, state, and assumptions.

### Phase 3 — Hypothesis and Test

Use the scientific method:

1. State one hypothesis:
   - “I think X is the root cause because Y.”
2. Test with the smallest possible change or instrumentation.
3. Change one variable at a time.
4. If wrong, remove/revert the probe and form a new hypothesis.
5. If you do not understand something, say so and gather more evidence.

### Phase 4 — Implementation

Only after root cause is identified:

1. Create the smallest failing reproduction or regression test possible.
2. Implement one fix addressing the source cause.
3. Verify with fresh evidence.
4. Run relevant diagnostics.
5. Do not claim completion without command output proving it.

If three fix attempts fail, stop. Treat that as a likely architectural/design problem and discuss before attempting fix #4.

## Defense in depth

When invalid data/state caused the bug, prefer layered safeguards:

1. **Entry validation** — reject invalid input at API/user boundary.
2. **Domain validation** — assert invariants where the operation happens.
3. **Environment guards** — prevent dangerous operations in tests/CI/dev.
4. **Diagnostic breadcrumbs** — log enough context for future forensics.

Do not add noisy logs permanently unless they are useful operational diagnostics.

## Flaky tests and async bugs

Never use arbitrary sleeps as a first fix.

Prefer condition-based waiting:

```ts
await waitFor(() => state.ready, "state to become ready");
```

A timeout is acceptable only when:

1. you first waited for the triggering condition,
2. the duration is based on known timing behavior,
3. a comment explains why the delay is needed.

## Verification before completion

Before any claim like “fixed”, “passing”, “done”, or “works”:

1. Identify what command proves the claim.
2. Run the full command fresh.
3. Read the output and exit code.
4. State the actual result with evidence.

No fresh evidence means no completion claim.

## Debugging response template

For non-trivial bugs, report:

```text
Root cause status: investigating | identified | fixed | blocked
Evidence gathered:
- ...
Current hypothesis:
- I think X because Y
Next test:
- ...
Fix status:
- no fix yet; still in Phase 1/2/3
```

Once fixed:

```text
Root cause:
- ...
Fix:
- ...
Verification:
- command: ...
- result: ...
Remaining risk:
- ...
```
