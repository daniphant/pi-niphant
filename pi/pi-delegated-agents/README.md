# pi-delegated-agents

A Pi extension for **blocking delegated agent orchestration**.

It lets Pi route natural-language requests like “spawn an agent”, “run a frontend agent”, or “have backend and infra agents inspect this” into one or more specialist child agents, show live status as widgets in the main UI, and wait for results in the same turn.

## Features

- blocking delegated execution by default
- one or more specialist agents in parallel or sequential mode
- natural-language routing through the `spawn-agent` skill
- widget-first delegated-agent UX (no auto-open nested panel)
- optional delegated-agents panel with per-agent status rows
- per-agent inspector view with live output tail
- steer running child agents from the parent prompt
- read-only child agent execution
- file-based status and result transport under `~/.pi/delegated-agents/`
- tools for explicit orchestration:
  - `run_delegated_agents`
  - `infer_and_run_delegated_agents`

## Example agent profiles (optional)

Examples have been moved to `examples/agent-profiles/`.
Two ready-to-copy examples are included:
- `examples/agent-profiles/user-agents.example.json`
- `examples/agent-profiles/project-agents.example.json`

These are not required for the extension to function.
If a requested agent profile is missing, the extension creates a dynamic delegated profile from the requested role label.

## Commands

- `/delegated-agents-overlay`
- `/delegated-agents-jobs`
- `/run-agent <agent> <task>`
- `/delegated-agents-steer <run-id|latest> <agent-id|all> <instruction>`

## Shortcuts

- `Ctrl+Shift+B` — toggle delegated agents panel
- `Ctrl+Shift+X` — cancel running delegated agents for the current session

## Natural language examples

```txt
Spawn an agent to inspect this repo.
Run a frontend agent and backend agent on this architecture plan.
Have an infra agent inspect the deployment setup.
```

## Custom agent profiles

You can define/override profiles in:
- `~/.pi/agent/delegated-agents/agents.json` (user)
- `<project>/.pi/delegated-agents/agents.json` (project)

Quick start from the bundled examples:

```bash
# user-level example
mkdir -p ~/.pi/agent/delegated-agents
cp ./examples/agent-profiles/user-agents.example.json ~/.pi/agent/delegated-agents/agents.json

# project-level example
mkdir -p ./.pi/delegated-agents
cp ./examples/agent-profiles/project-agents.example.json ./.pi/delegated-agents/agents.json
```

Minimal format:

```json
{
  "agents": [
    {
      "name": "security-agent",
      "displayName": "Security Agent",
      "description": "Security-focused reviewer",
      "focus": "Focus on authn/authz, secrets handling, input validation, and exploit paths.",
      "model": "anthropic/claude-sonnet-4-20250514",
      "tools": ["read", "bash", "grep", "find", "ls"]
    }
  ]
}
```

## Installation

Install it like a normal local Pi extension package.

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
ln -sfn ~/projects/pi-delegated-agents/extensions/pi-delegated-agents ~/.pi/agent/extensions/pi-delegated-agents
ln -sfn ~/projects/pi-delegated-agents/skills/spawn-agent ~/.pi/agent/skills/spawn-agent
```

Then run `/reload` inside Pi.

## Files written

```txt
~/.pi/delegated-agents/
  projects/<project-name>-<hash>/
    runs/<run-id>/
      orchestrator.json
      status.json
      result.json
      child-0/
        status.json
        output.log
        result.json
        control.ndjson
```

## Development

```bash
npm install
npm run check
```

## Notes

- child runs use Pi in read-only mode with `read,bash,grep,find,ls`
- child progress is surfaced through Pi RPC event-stream parsing and log tailing
- steering commands are appended to each child `control.ndjson` and delivered live via RPC `steer`
- this project is focused on delegated orchestration UX, not fire-and-forget background jobs

## License

MIT
