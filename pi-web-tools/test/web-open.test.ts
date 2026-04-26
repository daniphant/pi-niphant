import { describe, expect, it, vi } from "vitest";
import { webOpen } from "../src/web-open.js";
import * as fetcher from "../src/web-open-fetch.js";

describe("web_open", () => {
  it("assembles markdown output", async () => { vi.spyOn(fetcher,"fetchWebOpen").mockResolvedValue({ body: Buffer.from("<h1>Hello</h1>"), metadata: { url:"https://e", finalUrl:"https://e", status:200, statusText:"OK", headers:{"content-type":"text/html"}, contentType:"text/html", redirects:[], allowlistActive:false } }); const out=await webOpen({url:"https://e"}); expect(out).toContain("# Hello"); expect(out).toContain("BEGIN UNTRUSTED"); });
  it("returns formatted errors", async () => expect(await webOpen({url:"ftp://x"})).toContain("web_open failed"));
});
