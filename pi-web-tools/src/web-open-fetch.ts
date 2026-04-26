import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { MAX_REDIRECTS, MAX_RESPONSE_BYTES, USER_AGENT } from "./constants.js";
import { FetchError } from "./errors.js";
import { filterHeaders } from "./output.js";
import type { FetchResult } from "./types.js";
import { effectivePort, resolveAndValidate, resolveRedirect } from "./network-safety.js";

export async function fetchWebOpen(rawUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<FetchResult> {
  const redirects: string[] = []; const seen = new Set<string>(); let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (seen.has(current)) throw new FetchError("Redirect loop detected"); seen.add(current);
    const result = await requestOnce(current, timeoutMs, signal, redirects);
    if ([301,302,303,307,308].includes(result.metadata.status) && result.metadata.headers.location) {
      if (hop === MAX_REDIRECTS) throw new FetchError("Redirect limit exceeded");
      const next = resolveRedirect(new URL(current), result.metadata.headers.location);
      redirects.push(next.toString()); current = next.toString(); continue;
    }
    result.metadata.redirects = redirects; result.metadata.finalUrl = current; return result;
  }
  throw new FetchError("Redirect limit exceeded");
}

async function requestOnce(rawUrl: string, timeoutMs: number, signal: AbortSignal | undefined, redirects: string[]): Promise<FetchResult> {
  const validation = await resolveAndValidate(rawUrl); const url = validation.url;
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let rawBytes = 0; let done = false;
    const finish = (err?: unknown, res?: FetchResult) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", onAbort); err ? reject(err) : resolve(res!); };
    const onAbort = () => { req.destroy(); finish(new FetchError("Request aborted")); };
    const req = client.request({
      protocol: url.protocol, hostname: url.hostname, port: effectivePort(url), path: `${url.pathname}${url.search}`, method: "GET",
      headers: { "user-agent": USER_AGENT, accept: "text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.1", "accept-encoding": "gzip, br, deflate", host: url.host },
      agent: false, servername: url.hostname,
      lookup: (_hostname, _opts, cb) => cb(null, validation.selectedAddress, validation.selectedAddress.includes(":") ? 6 : 4),
    }, (res) => {
      res.on("data", (chunk: Buffer) => { rawBytes += chunk.length; if (rawBytes > MAX_RESPONSE_BYTES) { req.destroy(); finish(new FetchError("Response body exceeds size limit")); return; } chunks.push(chunk); });
      res.on("end", async () => {
        try {
          const raw = Buffer.concat(chunks); const body = await decompress(raw, String(res.headers["content-encoding"] ?? ""));
          if (body.length > MAX_RESPONSE_BYTES) throw new FetchError("Decompressed response exceeds size limit");
          const headers = filterHeaders(res.headers as Record<string,string|string[]|undefined>);
          if (res.headers.location) headers.location = String(res.headers.location);
          finish(undefined, { body, metadata: { url: rawUrl, finalUrl: rawUrl, status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers, contentType: String(res.headers["content-type"] ?? ""), redirects, allowlistActive: validation.allowlistActive } });
        } catch (e) { finish(e); }
      });
    });
    const timer = setTimeout(() => { req.destroy(); finish(new FetchError("Request timed out")); }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("socket", s => s.on("connect", () => { const addr = s.remoteAddress; if (addr && addr !== validation.selectedAddress) req.destroy(new FetchError("Connected address differed from validated DNS address")); }));
    req.on("error", (e) => finish(e)); req.end();
  });
}

function decompress(buf: Buffer, enc: string): Promise<Buffer> {
  const e = enc.toLowerCase();
  if (e.includes("gzip")) return new Promise((res, rej) => zlib.gunzip(buf, (er, out) => er ? rej(er) : res(out)));
  if (e.includes("br")) return new Promise((res, rej) => zlib.brotliDecompress(buf, (er, out) => er ? rej(er) : res(out)));
  if (e.includes("deflate")) return new Promise((res, rej) => zlib.inflate(buf, (er, out) => er ? rej(er) : res(out)));
  return Promise.resolve(buf);
}
