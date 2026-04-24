# pi-codex-like-diff

Codex-like edit diffs for Pi. This extension overrides the built-in `edit` tool renderer so added/removed lines use subtle background tints while code content can retain language syntax foreground highlighting.

## What changes

- Registers a same-name `edit` tool override.
- Reuses Pi's built-in `createEditToolDefinition()` for edit execution, schema, prompt metadata, validation, and result shape.
- Replaces only `renderCall` and `renderResult`.
- Uses Pi `0.70.2`'s private `dist/core/tools/edit-diff.js` preview helper for preview diffs, isolated behind a runtime loader.
- Renders added lines with `toolSuccessBg` and removed lines with `toolErrorBg`.
- Applies syntax highlighting from `getLanguageFromPath()` / `highlightCode()` for known file extensions.
- Unknown file types remain plain readable text on the diff background.
- Adjacent one-removed/one-added modification pairs receive conservative word-level bold + underline emphasis on changed code spans. It intentionally does not use inverse video.

## Compatibility note

Target Pi version: `0.70.2`.

Verified contracts for this version:

- `@mariozechner/pi-coding-agent` publicly exports `VERSION`, `createEditToolDefinition`, `renderDiff`, `getLanguageFromPath`, `highlightCode`, and `Theme`.
- `createEditToolDefinition(cwd)` returns the full built-in edit definition with fields: `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters`, `renderShell`, `prepareArguments`, `execute`, `renderCall`, and `renderResult`.
- Built-in result shape is preserved: `content` plus `details.diff` and `details.firstChangedLine`.
- Pi extension docs state same-name registration overrides built-in tools, renderer inheritance is per slot, and prompt metadata is not inherited unless included. This extension spreads the built-in definition and then replaces renderer slots.
- Generated edit diff grammar is `^([+\\-\\s])(\\s*\\d*) (.*)$`: sign column, padded line-number column, one separator space, and code text. Examples: `-2   const x = 1;`, `+2   const x = 2;`, ` 3 }`, and skipped context marker `   ...`.
- Theme background methods reset background only (`\u001b[49m`); foreground methods reset foreground only (`\u001b[39m`).

If Pi reports a version other than `0.70.2`, the extension logs a warning and still registers using built-in execution plus renderer fallbacks. If preview diff helper loading fails, execution remains built-in; preview rendering degrades to the edit header until result rendering is available.

## Validation

Run renderer checks:

```bash
npm --prefix pi-codex-like-diff test
```

The tests assert added/removed background escapes, known-language syntax foreground escapes, unknown-language readable background rendering, prefix/line-number preservation, bold+underline changed spans, and absence of inverse styling (`\u001b[7m`).

## Install

```bash
scripts/install.sh pi-codex-like-diff
# then run /reload inside Pi
```

It is also included in the repository default install set.

## Rollback / disable

```bash
scripts/install.sh pi-codex-like-diff --uninstall
# or: rm -f ~/.pi/agent/extensions/pi-codex-like-diff
# then run /reload inside Pi
```

To remove it from default installation, delete or comment out `pi-codex-like-diff` in `scripts/install.sh`'s `DEFAULT_PACKAGES` array.

## Limitations

- Exact visual parity with Codex CLI is behavioral, not source-level; Codex source was not copied.
- Syntax highlighting is line-oriented through Pi's existing helper.
- Full terminal-row background fill is not attempted; background covers the rendered text extent.
- Preview diff computation intentionally uses a private Pi `0.70.2` helper because that helper is not publicly exported.
