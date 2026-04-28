# pi-catppuccin-ui

Catppuccin Mocha theme and Markdown rendering polish for Pi.

## Includes

- `catppuccin-mocha` Pi theme
- Markdown code blocks without raw backtick fences
- Copy-friendly code block rendering: syntax highlighting with a subtle background, without selectable border glyphs, language labels, or injected shell prompts
- Improved heading rendering
- GitHub-style callout boxes (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`)
- Existing file references rendered as VS Code `vscode://file/...` terminal hyperlinks when supported by the terminal

## Use

Install with this repo's installer, then select the theme in Pi settings or set:

```json
{
  "theme": "catppuccin-mocha"
}
```

Run `/reload` in Pi after installing.
