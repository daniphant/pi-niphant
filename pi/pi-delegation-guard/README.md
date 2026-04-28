# pi-delegation-guard

An opinionated guardrail for Pi delegated-agent tools.

`pi-delegation-guard` blocks accidental use of delegated/subagent tools for ordinary codebase exploration, while still allowing explicit delegation and artifact-producing verifier work.

## Philosophy

Use one strong main model for normal repository inspection.

Delegated agents are useful for:

- browser/E2E verification
- multi-model consensus/review
- independent verification
- long-running tests or benchmarks
- isolated artifact-producing work

Delegated agents are usually bad for:

- “explore this repo”
- “summarize the architecture”
- “find where X is implemented”
- ordinary file/code inspection that the main model can do directly

This extension enforces that preference at the tool-call boundary.

## What it blocks

The guard watches calls to:

- `run_delegated_agents`
- `infer_and_run_delegated_agents`

It blocks calls that look like generic exploration unless the user explicitly asked for delegation or the task has an objective artifact-producing/verifier shape.

## What it allows

Allowed examples:

```text
Spawn an independent verifier agent to check this final diff.
Run browser E2E verification in a delegated agent.
Ask consensus reviewers to critique this frozen implementation plan.
Run a long-running benchmark agent and report artifacts.
```

Blocked examples:

```text
Have an agent inspect the repo architecture.
Delegate to an agent to find where auth is implemented.
Spawn a subagent to summarize the frontend.
```

## Install

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-delegation-guard
```

Then run `/reload` inside Pi.

## Configuration

No configuration. This is deliberately small and opinionated.

If you want broad delegation, do not install this extension.

## Development

```bash
npm install
npm run check
```

## License

MIT
