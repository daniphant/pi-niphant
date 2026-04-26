import { BRAVE_DEFAULT_COUNT, BRAVE_ENDPOINT, BRAVE_MAX_COUNT, MAX_TIMEOUT_MS } from "./constants.js";
import { ConfigError } from "./errors.js";
import { getEnvValue } from "./env.js";
import { formatError, formatOutput } from "./output.js";
import type { WebSearchParams } from "./types.js";

export async function webSearch(params: WebSearchParams, signal?: AbortSignal): Promise<string> {
  try {
    const key = getEnvValue("BRAVE_SEARCH_API_KEY");
    if (!key) throw new ConfigError("BRAVE_SEARCH_API_KEY is required. Queries are sent to Brave Search when configured.");
    const count = Math.min(Math.max(Math.floor(params.count ?? BRAVE_DEFAULT_COUNT), 1), BRAVE_MAX_COUNT);
    const url = new URL(BRAVE_ENDPOINT); url.searchParams.set("q", params.query); url.searchParams.set("count", String(count));
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    const res = await fetch(url, { headers: { accept: "application/json", "x-subscription-token": key }, signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 429) throw new Error("Brave Search quota/rate limit reached; retry later (no automatic retry attempted)");
    if (!res.ok) throw new Error(`Brave Search API error ${res.status}`);
    const json: any = await res.json();
    const results = (json.web?.results ?? []).slice(0, count).map((r: any, i: number) => `${i+1}. ${r.title ?? "Untitled"}\n   ${r.url ?? ""}\n   ${r.description ?? ""}`).join("\n\n");
    return formatOutput("web_search result", { query: params.query, count, provider: "Brave Search", privacy: "query sent to Brave Search" }, results || "No results.");
  } catch (e) { return formatError("web_search failed", e); }
}
