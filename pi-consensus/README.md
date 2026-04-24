# pi-consensus

Multi-model consensus reviews for [Pi](https://github.com/mariozechner/pi-coding-agent).

`pi-consensus` asks several configured models to review the **same frozen prompt** and returns their independent responses in one packet. It is designed for plans, architecture choices, risky migrations, security-sensitive work, and final implementation reviews.

It is intentionally **not** a repo-exploration subagent system. Consensus models run with tools, skills, extensions, context files, and sessions disabled, so they review only the context you explicitly pass.

## Features

- `/consensus` slash command
- `run_consensus` tool for Pi agents
- default model set:
  - `openai-codex/gpt-5.5`
  - `zai/glm-5.1`
- optional model override per call
- frozen-context prompt discipline
- structured Markdown output from each reviewer
- failure reporting when one model cannot run

## Why this exists

A strong main model should usually inspect code directly. But for high-impact decisions, it is valuable to ask independent models to critique a frozen plan without letting each one wander the repository and invent different context.

Use this for:

- spec review
- implementation plan review
- architecture tradeoffs
- migration risk analysis
- security/backcompat review
- post-implementation sanity checks

Do **not** use it for:

- ordinary codebase exploration
- “find where this lives” tasks
- replacing local diagnostics/tests

## Install

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-consensus
ln -sfn "$PWD/skills/consensus" ~/.pi/agent/skills/consensus
```

Then run `/reload` inside Pi.

## Usage

### Slash command

```text
/consensus Should we migrate this package from CommonJS to ESM? Context: ...
```

With explicit models:

```text
/consensus --models openai-codex/gpt-5.5,zai/glm-5.1 Review this plan: ...
```

### Tool

Pi agents can call:

```ts
run_consensus({
  prompt: "Frozen plan/spec/context goes here",
  mode: "plan",
  models: ["openai-codex/gpt-5.5", "zai/glm-5.1"],
  timeoutMs: 180000
})
```

## Configuration

Default models can be changed with:

```bash
export PI_CONSENSUS_MODELS="openai-codex/gpt-5.5,zai/glm-5.1"
```

## Output shape

Each reviewer is asked to return:

```md
## Verdict
## Key Agreement Points
## Disagreements or Uncertainties
## Risks / Blocking Concerns
## Recommended Changes
```

The extension then returns all responses plus model status and timing.

## Development

```bash
npm install
npm run check
```

## License

MIT
