# pi-codex-compaction

Codex-style checkpoint handoff compaction for [Pi](https://github.com/mariozechner/pi-coding-agent).

This extension overrides Pi's default compaction summary with a concise, structured handoff summary inspired by OpenAI Codex CLI.

It uses Pi's public `session_before_compact` hook and does **not** call Codex's private `responses/compact` endpoint.

## Features

- Codex-style “another model will resume this task” handoff prefix
- structured continuation summaries
- preserves user preferences and constraints
- preserves important file paths, commands, URLs, model names, and decisions
- carries forward read/modified file metadata when available
- configurable model and token budget
- graceful fallback to Pi's default compaction if anything fails

## Summary sections

The compaction prompt asks for:

```md
## Current Goal
## User Preferences / Constraints
## Work Completed
## Current State
## Files / Symbols / Commands That Matter
## Decisions Made
## Remaining Work
## Risks / Gotchas
## Exact Continuation Instructions
```

## Install

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-codex-compaction
```

Then run `/reload` inside Pi.

## Configuration

```bash
# Optional. Defaults to the active Pi model, then openai-codex/gpt-5.5 if resolvable.
export PI_CODEX_COMPACTION_MODEL="openai-codex/gpt-5.5"

# Optional. Defaults to 12000.
export PI_CODEX_COMPACTION_MAX_TOKENS=12000

# Optional. Defaults to true.
export PI_CODEX_COMPACTION_NOTIFY=false
```

## Notes

- If the configured model is unavailable or unauthenticated, Pi's default compaction is used.
- The extension is local-first and provider-agnostic as long as Pi can resolve/authenticate the selected model.
- This pairs well with `pi-checkpoint` and `pi-workflow`.

## Development

```bash
npm install
npm run check
```

## License

MIT
