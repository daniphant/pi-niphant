import { getLanguageFromPath, highlightCode, type Theme } from "@mariozechner/pi-coding-agent";

export interface CodexLikeDiffOptions {
  filePath?: string;
}

export interface ParsedDiffLine {
  prefix: "+" | "-" | " ";
  lineNum: string;
  content: string;
  raw: string;
}

export interface RenderedDiffRow {
  text: string;
  bg?: "added" | "removed";
}

// Slightly greener/redder than Pi's toolSuccessBg/toolErrorBg so changed rows
// remain visible inside the edit tool's success/error container background.
export const ADDED_ROW_BG = "\x1b[48;2;35;68;50m";
export const REMOVED_ROW_BG = "\x1b[48;2;74;38;52m";
export const RESET_BG = "\x1b[49m";

export function applyDiffRowBackground(kind: "added" | "removed", text: string): string {
  return `${kind === "added" ? ADDED_ROW_BG : REMOVED_ROW_BG}${text}${RESET_BG}`;
}

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export function parseDiffLine(line: string): ParsedDiffLine | null {
  const match = line.match(/^([+\-\s])(\s*\d*) (.*)$/);
  if (!match) return null;
  const prefix = match[1] === "+" || match[1] === "-" ? match[1] : " ";
  return { prefix, lineNum: match[2] ?? "", content: match[3] ?? "", raw: line };
}

function replaceTabs(text: string): string {
  return text.replace(/\t/g, "   ");
}

function highlightLine(code: string, filePath?: string): string {
  const lang = filePath ? getLanguageFromPath(filePath) : undefined;
  if (!lang) return code;
  const lines = highlightCode(code, lang);
  return lines[0] ?? code;
}

function visibleLength(styled: string): number {
  return styled.replace(ANSI_RE, "").length;
}

function styleVisibleRange(styled: string, start: number, end: number, style: (text: string) => string): string {
  if (end <= start) return styled;
  let out = "";
  let visible = 0;
  let open = false;
  for (let i = 0; i < styled.length;) {
    const esc = styled.slice(i).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
    if (esc) {
      // Keep existing syntax ANSI. Re-open emphasis after reset-like sequences.
      out += esc[0];
      i += esc[0].length;
      continue;
    }
    const ch = styled[i]!;
    if (!open && visible === start) {
      out += "\x1b[1m\x1b[4m";
      open = true;
    }
    if (open && visible === end) {
      out += "\x1b[24m\x1b[22m";
      open = false;
    }
    out += ch;
    visible++;
    i++;
  }
  if (open) out += "\x1b[24m\x1b[22m";
  return out;
}

function tokenize(text: string): string[] {
  return text.match(/\s+|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\sA-Za-z_$\d]+/g) ?? [];
}

function changedSpans(oldText: string, newText: string): { oldSpans: Array<[number, number]>; newSpans: Array<[number, number]> } {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const unchangedA = new Set<number>();
  const unchangedB = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      unchangedA.add(i++);
      unchangedB.add(j++);
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const toSpans = (tokens: string[], unchanged: Set<number>) => {
    const spans: Array<[number, number]> = [];
    let pos = 0;
    let spanStart: number | null = null;
    for (let k = 0; k < tokens.length; k++) {
      const token = tokens[k]!;
      const tokenStart = pos;
      const tokenEnd = pos + token.length;
      const changed = !unchanged.has(k) && token.trim().length > 0;
      if (changed && spanStart === null) spanStart = tokenStart;
      if ((!changed || k === tokens.length - 1) && spanStart !== null) {
        spans.push([spanStart, changed && k === tokens.length - 1 ? tokenEnd : tokenStart]);
        spanStart = null;
      }
      pos = tokenEnd;
    }
    return spans.filter(([s, e]) => e > s);
  };
  return { oldSpans: toSpans(a, unchangedA), newSpans: toSpans(b, unchangedB) };
}

function applySpans(styled: string, spans: Array<[number, number]>): string {
  for (let i = spans.length - 1; i >= 0; i--) {
    const [start, end] = spans[i]!;
    if (start < visibleLength(styled)) styled = styleVisibleRange(styled, start, Math.min(end, visibleLength(styled)), (s) => s);
  }
  return styled;
}

function renderLine(parsed: ParsedDiffLine, theme: Theme, filePath?: string, spans?: Array<[number, number]>): RenderedDiffRow {
  const content = replaceTabs(parsed.content);
  let renderedContent = parsed.prefix === " " ? content : highlightLine(content, filePath);
  if (spans?.length) renderedContent = applySpans(renderedContent, spans);
  const line = `${parsed.prefix}${parsed.lineNum} ${renderedContent}`;
  if (parsed.prefix === "+") return { text: line, bg: "added" };
  if (parsed.prefix === "-") return { text: line, bg: "removed" };
  return { text: theme.fg("toolDiffContext", line) };
}

export function renderCodexLikeDiffRows(diffText: string, theme: Theme, options: CodexLikeDiffOptions = {}): RenderedDiffRow[] {
  try {
    const lines = diffText.split("\n");
    const out: RenderedDiffRow[] = [];
    let i = 0;
    while (i < lines.length) {
      const parsed = parseDiffLine(lines[i]!);
      if (!parsed) {
        out.push({ text: theme.fg("toolDiffContext", lines[i]!) });
        i++;
        continue;
      }
      if (parsed.prefix === "-") {
        const removed: ParsedDiffLine[] = [];
        const added: ParsedDiffLine[] = [];
        while (i < lines.length) {
          const p = parseDiffLine(lines[i]!);
          if (!p || p.prefix !== "-") break;
          removed.push(p); i++;
        }
        while (i < lines.length) {
          const p = parseDiffLine(lines[i]!);
          if (!p || p.prefix !== "+") break;
          added.push(p); i++;
        }
        if (removed.length === 1 && added.length === 1) {
          const oldContent = replaceTabs(removed[0]!.content);
          const newContent = replaceTabs(added[0]!.content);
          const spans = changedSpans(oldContent, newContent);
          out.push(renderLine(removed[0]!, theme, options.filePath, spans.oldSpans));
          out.push(renderLine(added[0]!, theme, options.filePath, spans.newSpans));
        } else {
          for (const r of removed) out.push(renderLine(r, theme, options.filePath));
          for (const a of added) out.push(renderLine(a, theme, options.filePath));
        }
        continue;
      }
      out.push(renderLine(parsed, theme, options.filePath));
      i++;
    }
    return out;
  } catch (error) {
    return diffText.split("\n").map((text) => ({ text }));
  }
}

export function renderCodexLikeDiff(diffText: string, theme: Theme, options: CodexLikeDiffOptions = {}): string {
  return renderCodexLikeDiffRows(diffText, theme, options)
    .map((row) => row.bg ? applyDiffRowBackground(row.bg, row.text) : row.text)
    .join("\n");
}
