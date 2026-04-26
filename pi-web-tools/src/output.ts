import { ALLOWED_METADATA_HEADERS, OUTPUT_MAX_BYTES, OUTPUT_MAX_LINES } from "./constants.js";

const SECRET_PATTERNS = [
  /BSA[a-zA-Z0-9_-]{20,}/g,
  /[A-Za-z0-9_-]{32,}/g,
  /(api[-_ ]?key\s*[:=]\s*)([^\s,;]+)/gi,
  /(authorization\s*[:=]\s*bearer\s+)([^\s,;]+)/gi,
  /(x-subscription-token\s*[:=]\s*)([^\s,;]+)/gi,
];

export function redactSecrets(input: unknown): string {
  let text = input instanceof Error ? `${input.message}\n${input.stack ?? ""}` : typeof input === "string" ? input : JSON.stringify(input, Object.getOwnPropertyNames(input as object));
  if (!text) return "";
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (...m) => m.length > 3 && String(m[1]).match(/[:=]/) ? `${m[1]}[REDACTED]` : "[REDACTED]");
  }
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (key && key.length >= 6) {
    text = text.split(key).join("[REDACTED]");
    text = text.split(key.slice(0, 8)).join("[REDACTED_PREFIX]");
  }
  return text;
}

export function truncateVisible(input: string, maxBytes = OUTPUT_MAX_BYTES, maxLines = OUTPUT_MAX_LINES): { text: string; truncated: boolean } {
  const lines = input.split(/\r?\n/);
  let text = lines.slice(0, maxLines).join("\n");
  let truncated = lines.length > maxLines;
  const bytes = Buffer.byteLength(text);
  if (bytes > maxBytes) {
    text = Buffer.from(text).subarray(0, maxBytes).toString("utf8").replace(/�$/u, "");
    truncated = true;
  }
  return { text, truncated };
}

export function filterHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (ALLOWED_METADATA_HEADERS.has(key) && v != null) out[key] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

export function frameUntrusted(content: string): string {
  return [`--- BEGIN UNTRUSTED WEB CONTENT ---`, content, `--- END UNTRUSTED WEB CONTENT ---`].join("\n");
}

export function formatOutput(title: string, metadata: Record<string, unknown>, content: string): string {
  const meta = Object.entries(metadata).map(([k, v]) => `- ${k}: ${redactSecrets(String(v))}`).join("\n");
  const truncated = truncateVisible(frameUntrusted(redactSecrets(content)));
  return [`# ${title}`, "", meta, "", truncated.text, truncated.truncated ? "\n[Output truncated to 50 KB / 2,000 lines]" : ""].join("\n").trimEnd();
}

export function formatError(message: string, cause?: unknown): string {
  const detail = cause ? `\n\n${redactSecrets(cause)}` : "";
  return `Error: ${redactSecrets(message)}${detail}`;
}
