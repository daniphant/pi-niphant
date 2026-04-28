import { describe, expect, it, vi } from "vitest";
import ext from "../index.js";

describe("integration", () => {
  it("loads extension without browser dependencies", async () => { const tools:any[]=[]; ext({ registerTool:(t:any)=>tools.push(t) } as any); expect(tools.length).toBe(2); expect(JSON.stringify(tools)).not.toMatch(/agent-browser|playwright/i); });
  it("web_search missing key smoke", async () => { delete process.env.BRAVE_SEARCH_API_KEY; const tools:any[]=[]; ext({ registerTool:(t:any)=>tools.push(t) } as any); const res=await tools[1].execute("1", {query:"x"}, new AbortController().signal); expect(res.content[0].text).toContain("BRAVE_SEARCH_API_KEY"); });
  it("repeated mocked search remains bounded", async () => { process.env.BRAVE_SEARCH_API_KEY="BSA_SECRET_TOKEN_123456789012345"; vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({web:{results:[]}}), {status:200})); const tools:any[]=[]; ext({ registerTool:(t:any)=>tools.push(t) } as any); for(let i=0;i<5;i++) expect((await tools[1].execute("1", {query:"x"})).content[0].text.length).toBeLessThan(10_000); });
});
