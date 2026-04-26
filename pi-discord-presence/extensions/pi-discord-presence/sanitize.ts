import { DISCORD_FIELD_MAX_CHARS, LABEL_MAX_CHARS } from "./constants.js";

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const DISALLOWED_RE = /[^\p{L}\p{N} ._+\-#()]/gu;
const PATH_AND_SHELL_RE = /[\\/:;|&<>`$!?'"*[\]{}=,@~]/g;

export function truncateText(text: string, maxChars = LABEL_MAX_CHARS): string {
  const cap = Math.max(1, Math.min(maxChars, DISCORD_FIELD_MAX_CHARS));
  if ([...text].length <= cap) return text;
  return [...text].slice(0, cap - 1).join("").trimEnd() + "…";
}

export function sanitizeLabel(value: unknown, fallback: string, maxChars = LABEL_MAX_CHARS): string {
  const raw = typeof value === "string" ? value : "";
  let normalized = raw.normalize("NFKC");
  normalized = normalized.replace(ZERO_WIDTH_RE, "");
  normalized = normalized.replace(CONTROL_RE, " ");
  normalized = normalized.replace(PATH_AND_SHELL_RE, " ");
  normalized = normalized.replace(DISALLOWED_RE, " ");
  normalized = normalized.replace(/\s+/g, " ").trim();

  const suspicious = normalized === "." || normalized === ".." || /^[-_. ]+$/.test(normalized);
  if (!normalized || suspicious) return fallback;
  return truncateText(normalized, maxChars);
}

export function sanitizeProjectLabel(value: unknown): string {
  return sanitizeLabel(value, "Pi");
}

export function sanitizeModelLabel(value: unknown): string {
  return sanitizeLabel(value, "AI model");
}

export function safeStatusLine(value: string): string {
  return value.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
}
