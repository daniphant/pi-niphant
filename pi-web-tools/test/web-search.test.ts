import { describe, expect, it, vi, afterEach } from "vitest";
import { webSearch } from "../src/web-search.js";

describe("web_search", () => {
  afterEach(()=>{ vi.restoreAllMocks(); delete process.env.BRAVE_SEARCH_API_KEY; });
  it("reports missing key without network", async () => { const fetchSpy=vi.spyOn(globalThis,"fetch"); const out=await webSearch({query:"x"}); expect(out).toContain("BRAVE_SEARCH_API_KEY"); expect(fetchSpy).not.toHaveBeenCalled(); });
  it("maps results and clamps count", async () => { process.env.BRAVE_SEARCH_API_KEY="BSA_SECRET_TOKEN_123456789012345"; vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({web:{results:[{title:"A",url:"https://a",description:"D"}]}}), {status:200, headers:{"content-type":"application/json"}})); const out=await webSearch({query:"hello", count:50}); expect(out).toContain("https://a"); expect(out).toContain("count: 20"); expect(out).not.toContain(process.env.BRAVE_SEARCH_API_KEY); });
  it("maps quota", async () => { process.env.BRAVE_SEARCH_API_KEY="BSA_SECRET_TOKEN_123456789012345"; vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("", {status:429})); expect(await webSearch({query:"x"})).toContain("quota/rate limit"); });
});
