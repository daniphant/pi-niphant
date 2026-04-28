import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import dns from "node:dns/promises";
import { fetchWebOpen } from "../src/web-open-fetch.js";

async function server(handler: http.RequestListener) { const s=http.createServer(handler); await new Promise<void>(r=>s.listen(0,"127.0.0.1",r)); return { url:`http://localhost:${(s.address() as any).port}`, close:()=>new Promise<void>(r=>s.close(()=>r())) }; }

describe("web_open fetch", () => {
  beforeEach(()=>{ process.env.PI_WEB_ALLOW_PRIVATE_NETWORK="localhost:1"; vi.spyOn(dns,"resolveCname").mockRejectedValue(new Error("none")); });
  afterEach(()=>{ vi.restoreAllMocks(); delete process.env.PI_WEB_ALLOW_PRIVATE_NETWORK; });
  it("fetches through prevalidated lookup and records metadata", async () => { const srv=await server((_q,r)=>r.end("ok")); process.env.PI_WEB_ALLOW_PRIVATE_NETWORK=`localhost:${new URL(srv.url).port}`; vi.spyOn(dns,"lookup").mockResolvedValue([{address:"127.0.0.1",family:4}] as any); const res=await fetchWebOpen(srv.url,5000); expect(res.body.toString()).toBe("ok"); await srv.close(); });
  it("detects redirect loop", async () => { const srv=await server((_q,r)=>{ r.statusCode=302; r.setHeader("location","/"); r.end(); }); process.env.PI_WEB_ALLOW_PRIVATE_NETWORK=`localhost:${new URL(srv.url).port}`; vi.spyOn(dns,"lookup").mockResolvedValue([{address:"127.0.0.1",family:4}] as any); await expect(fetchWebOpen(srv.url,5000)).rejects.toThrow(/loop/); await srv.close(); });
});
