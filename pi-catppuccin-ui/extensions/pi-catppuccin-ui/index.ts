import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type MarkdownThemeLike = {
  codeBlockIndent?: string;
  heading: (text: string) => string;
  code: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  quote: (text: string) => string;
  quoteBorder: (text: string) => string;
  listBullet: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  highlightCode?: (code: string, lang?: string) => string[];
};

type MarkdownInternals = {
  theme: MarkdownThemeLike;
  renderInlineTokens?: (tokens: unknown[], styleContext?: unknown) => string;
};

type MarkdownPrototype = {
  [PATCH_FLAG]?: boolean;
  renderToken: (token: MarkdownToken, width: number, nextTokenType?: string, styleContext?: unknown) => string[];
  renderInlineTokens?: (tokens: unknown[], styleContext?: unknown) => string;
};

type MarkdownToken = {
  type?: string;
  text?: string;
  raw?: string;
  lang?: string;
  depth?: number;
  tokens?: unknown[];
};

const PATCH_FLAG = Symbol.for("pi.catppuccinMarkdownPolish.v5");
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CODE_BLOCK_BG = "\x1b[48;2;37;50;68m"; // catppuccin-mocha toolSuccessBg, matching edit/diff blocks
const RESET_BG = "\x1b[49m";

let currentCwd = process.cwd();

function pushBlankAfter(lines: string[], nextTokenType?: string) {
  if (nextTokenType && nextTokenType !== "space") lines.push("");
}

function fitLine(line: string, width: number): string {
  return visibleWidth(line) <= width ? line : truncateToWidth(line, width);
}

function codeBlockBlankLine(width: number): string {
  return `${CODE_BLOCK_BG}${" ".repeat(Math.max(0, width))}${RESET_BG}`;
}

function applyCodeBlockBackground(line: string, width: number): string {
  // Keep code blocks copy-friendly: background only, no extra visible border/prefix chars.
  // Pad the visual row so the background reads as a block, not just colored text spans.
  // Re-apply after full SGR resets from syntax highlighters so the block remains visually distinct.
  const padded = `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
  return `${CODE_BLOCK_BG}${padded.replace(/\x1b\[0m/g, `\x1b[0m${CODE_BLOCK_BG}`)}${RESET_BG}`;
}

function osc8(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

const fileRefPattern = /(^|[\s([{"'`])((?:\.{1,2}\/|\/)?(?:(?:[\w.@+-]+)\/)*(?:[\w.@+-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|sass|less|html|htm|py|go|rs|java|kt|kts|swift|rb|php|yml|yaml|toml|lock|sh|bash|zsh|fish|sql|graphql|gql|prisma|env|txt|xml|vue|svelte)|(?:[\w.@+-]+\/)+[\w.@+-]+))(?:\:(\d+))?(?:\:(\d+))?/g;

function toVSCodeFileUrl(fileRef: string, line?: string, column?: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(fileRef)) return null;

  const absolutePath = path.isAbsolute(fileRef) ? fileRef : path.resolve(currentCwd, fileRef);
  try {
    if (!fs.existsSync(absolutePath)) return null;
  } catch {
    return null;
  }

  const location = line ? `:${line}${column ? `:${column}` : ""}` : "";
  return `vscode://file/${encodeURI(absolutePath)}${location}`;
}

function linkifyFileRefs(text: string): string {
  if (text.includes("\x1b]8;;")) return text;

  return text.replace(fileRefPattern, (match, prefix: string, fileRef: string, line?: string, column?: string) => {
    const url = toVSCodeFileUrl(fileRef, line, column);
    if (!url) return match;
    const suffix = line ? `:${line}${column ? `:${column}` : ""}` : "";
    return `${prefix}${osc8(url, `${fileRef}${suffix}`)}`;
  });
}

function renderCodeBlock(ctx: MarkdownInternals, token: MarkdownToken, width: number, nextTokenType?: string): string[] {
  const theme = ctx.theme;
  const lang = (token.lang ?? "").trim();
  const code = token.text ?? "";
  const rendered = theme.highlightCode
    ? theme.highlightCode(code, lang || undefined)
    : code.split("\n").map((line) => theme.codeBlock(line));

  // Keep code blocks copy-friendly. Use syntax/color styling plus a subtle background,
  // but avoid selectable border glyphs, language labels, or injected shell prompts.
  const lines = [
    codeBlockBlankLine(width),
    ...rendered.map((line) => applyCodeBlockBackground(fitLine(line, width), width)),
    codeBlockBlankLine(width),
  ];
  pushBlankAfter(lines, nextTokenType);
  return lines;
}

function renderHeading(ctx: MarkdownInternals, token: MarkdownToken, width: number, nextTokenType?: string): string[] {
  const theme = ctx.theme;
  const depth = token.depth ?? 2;
  const text = ctx.renderInlineTokens?.(token.tokens ?? []) || token.text || "";
  const plainWidth = Math.max(0, width - 2);

  if (depth === 1) {
    const title = theme.heading(theme.bold(text));
    const rule = theme.heading("━".repeat(Math.min(width, 80)));
    const lines = [title, rule];
    pushBlankAfter(lines, nextTokenType);
    return lines;
  }

  if (depth === 2) {
    const prefix = theme.heading(theme.bold("▍ "));
    const line = fitLine(`${prefix}${theme.heading(theme.bold(text))}`, width);
    const lines = [line];
    pushBlankAfter(lines, nextTokenType);
    return lines;
  }

  const marker = theme.heading(`${"#".repeat(Math.min(depth, 6))} `);
  const line = fitLine(`${marker}${theme.heading(theme.bold(text))}`, plainWidth);
  const lines = [line];
  pushBlankAfter(lines, nextTokenType);
  return lines;
}

function parseCallout(raw: string | undefined): { kind: string; body: string[] } | null {
  if (!raw) return null;
  const quoteLines = raw
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""));
  const firstNonEmpty = quoteLines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty < 0) return null;
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(quoteLines[firstNonEmpty]!.trim());
  if (!match) return null;
  const body = quoteLines.slice(firstNonEmpty + 1).filter((line, index, all) => {
    if (line.trim()) return true;
    return index !== all.length - 1;
  });
  return { kind: match[1]!.toUpperCase(), body };
}

function renderCallout(ctx: MarkdownInternals, token: MarkdownToken, width: number, nextTokenType?: string): string[] | null {
  const callout = parseCallout(token.raw);
  if (!callout) return null;

  const theme = ctx.theme;
  const icons: Record<string, string> = {
    NOTE: "ℹ",
    TIP: "✦",
    IMPORTANT: "◆",
    WARNING: "⚠",
    CAUTION: "⛔",
  };
  const title = `${icons[callout.kind] ?? "•"} ${callout.kind}`;
  const lines = [fitLine(`${theme.quoteBorder("╭─ ")}${theme.bold(theme.quote(title))}`, width)];
  const bodyWidth = Math.max(1, width - 2);
  for (const bodyLine of callout.body.length ? callout.body : [""]) {
    const styled = bodyLine.trim() ? theme.quote(bodyLine) : "";
    lines.push(fitLine(`${theme.quoteBorder("│ ")}${styled}`, bodyWidth + 2));
  }
  lines.push(fitLine(theme.quoteBorder(`╰${"─".repeat(Math.max(1, Math.min(width - 1, 48)))}`), width));
  pushBlankAfter(lines, nextTokenType);
  return lines;
}

function installMarkdownPatch() {
  const proto = Markdown.prototype as unknown as MarkdownPrototype;

  if (proto[PATCH_FLAG]) return;

  const originalRenderToken = proto.renderToken;
  const originalRenderInlineTokens = proto.renderInlineTokens;

  if (originalRenderInlineTokens) {
    proto.renderInlineTokens = function patchedRenderInlineTokens(
      this: MarkdownInternals,
      tokens: unknown[],
      styleContext?: unknown,
    ): string {
      return linkifyFileRefs(originalRenderInlineTokens.call(this, tokens, styleContext));
    };
  }

  proto.renderToken = function patchedRenderToken(
    this: MarkdownInternals,
    token: MarkdownToken,
    width: number,
    nextTokenType?: string,
    styleContext?: unknown,
  ): string[] {
    if (token?.type === "code") return renderCodeBlock(this, token, width, nextTokenType);
    if (token?.type === "heading") return renderHeading(this, token, width, nextTokenType);
    if (token?.type === "blockquote") {
      const callout = renderCallout(this, token, width, nextTokenType);
      if (callout) return callout;
    }

    return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
  };

  proto[PATCH_FLAG] = true;
}

export default function catppuccinMarkdownPolish(pi: ExtensionAPI) {
  installMarkdownPatch();

  pi.on("resources_discover", async () => ({
    themePaths: [path.join(packageDir, "themes")],
  }));

  pi.on("session_start", async (_event, ctx) => {
    currentCwd = ctx.cwd || process.cwd();
  });

  pi.on("agent_start", async (_event, ctx) => {
    currentCwd = ctx.cwd || currentCwd;
  });
}
