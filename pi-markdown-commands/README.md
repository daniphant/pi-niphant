# pi-markdown-commands

OpenCode-style Markdown slash commands for Pi.

`pi-markdown-commands` loads `.md` command files from user and project command directories, registers them as Pi slash commands, and expands simple argument placeholders before sending the resulting prompt to Pi.

## Features

- user-level Markdown commands
- project-level Markdown commands
- OpenCode-compatible command directories
- frontmatter descriptions
- positional arguments
- `$ARGUMENTS` / `$@` expansion
- `/markdown-commands` listing command sources

## Command search paths

Commands are loaded from:

```txt
~/.pi/agent/commands
~/.config/opencode/commands
<project>/.pi/commands
<project>/.agents/commands
<project>/.opencode/commands
```

If multiple files have the same basename, the first discovered command wins.

## Install

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-markdown-commands
```

Then run `/reload` inside Pi.

## Example command

Create:

```txt
~/.pi/agent/commands/grill.md
```

```md
---
description: Ask rigorous design questions one at a time
---

Interview me relentlessly about this design. Ask one question at a time. For each question, include your recommended answer and the consequence of choosing differently.

Topic:
$ARGUMENTS
```

Use inside Pi:

```text
/grill new billing dashboard
```

## Argument expansion

Given:

```text
/my-command alpha "beta gamma" delta
```

Supported placeholders:

| Placeholder | Expands to |
| --- | --- |
| `$ARGUMENTS` | full raw argument string |
| `$@` | full raw argument string |
| `$1`, `$2`, ... | positional shell-like words |
| `${@:2}` | words from position 2 onward |
| `${@:2:2}` | two words starting at position 2 |

## List loaded commands

```text
/markdown-commands
```

## Development

```bash
npm install
npm run check
```

## License

MIT
