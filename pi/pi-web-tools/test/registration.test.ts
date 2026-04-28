import { describe, expect, it } from "vitest";
import ext from "../index.js";

describe("registration", () => {
  it("registers constrained tools", () => { const tools:any[]=[]; ext({ registerTool:(t:any)=>tools.push(t) } as any); expect(tools.map(t=>t.name)).toEqual(["web_open","web_search"]); expect(Object.keys(tools[0].parameters.properties)).toEqual(["url","format","timeout"]); expect(Object.keys(tools[1].parameters.properties)).toEqual(["query","count"]); });
});
