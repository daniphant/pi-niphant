import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from "./constants.js";
import { formatError, formatOutput } from "./output.js";
import type { WebOpenParams } from "./types.js";
import { fetchWebOpen } from "./web-open-fetch.js";
import { extractContent } from "./extract.js";

export async function webOpen(params: WebOpenParams, signal?: AbortSignal): Promise<string> {
  try {
    const format = params.format ?? "markdown";
    if (!["markdown", "text", "html"].includes(format)) throw new Error("format must be markdown, text, or html");
    const timeout = Math.min(Math.max(params.timeout ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
    const fetched = await fetchWebOpen(params.url, timeout, signal);
    const content = extractContent(fetched.body, fetched.metadata.contentType, format);
    return formatOutput("web_open result", { url: params.url, finalUrl: fetched.metadata.finalUrl, status: `${fetched.metadata.status} ${fetched.metadata.statusText}`.trim(), format, redirects: fetched.metadata.redirects.length, allowlistActive: fetched.metadata.allowlistActive, ...fetched.metadata.headers }, content);
  } catch (e) { return formatError("web_open failed", e); }
}
