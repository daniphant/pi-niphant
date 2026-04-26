import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { MAX_EXTRACT_BYTES } from "./constants.js";
import { FetchError } from "./errors.js";
import type { WebOpenFormat } from "./types.js";

export function extractContent(body: Buffer, contentType: string, format: WebOpenFormat): string {
  const lower = contentType.toLowerCase();
  const textLike = lower.includes("text/") || lower.includes("json") || lower.includes("xml") || lower.includes("html") || !lower;
  if (!textLike) throw new FetchError(`Unsupported binary content type: ${contentType || "unknown"}`);
  if (body.length > MAX_EXTRACT_BYTES && lower.includes("html")) throw new FetchError("HTML exceeds extraction conversion limit");
  const source = body.toString("utf8");
  if (format === "html") return source;
  if (!lower.includes("html")) return source;
  const $ = cheerio.load(source); $("script,style,noscript,iframe,object,embed").remove();
  if (format === "text") return $.root().text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown($.html()).trim();
}
