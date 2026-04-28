# pi-ask-user

OpenCode-style `ask_user_question` tool for Pi.

Pi already exposes native user-interaction APIs to extensions via `ctx.ui` (`input`, `select`, `confirm`, `editor`, etc.), but it does not ship a built-in model-callable AskUserQuestion tool. This package adds a minimal native Pi extension tool that bridges model tool calls to those UI dialogs.

## Tool

`ask_user_question`

Parameters:

- `question` (string, required): concise question to ask the user.
- `suggestions` (string[], optional): suggested answers shown as a selection list.
- `allow_freeform` (boolean, optional, default `true`): allow an answer outside suggestions.
- `placeholder` (string, optional): placeholder for free-form input.
- `timeout_ms` (number, optional): auto-cancel timeout in milliseconds.

The tool returns the user's answer as text and includes structured details:

```json
{ "cancelled": false, "question": "...", "answer": "..." }
```

If the user cancels, times out, submits an empty answer, or Pi has no UI available, it returns `cancelled: true` in `details`.

## Install

From this repository:

```bash
./scripts/install.sh pi-ask-user
```

Then reload Pi:

```text
/reload
```

Or install the default package set, which includes this extension:

```bash
./scripts/install.sh
```
