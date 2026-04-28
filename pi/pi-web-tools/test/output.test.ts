import { describe, expect, it } from "vitest";
import { filterHeaders, formatOutput, frameUntrusted, truncateVisible } from "../src/output.js";

describe("output", () => {
  it("frames untrusted content", () => expect(frameUntrusted("hello")).toContain("BEGIN UNTRUSTED WEB CONTENT"));
  it("truncates by lines", () => expect(truncateVisible(Array(2100).fill("x").join("\n")).truncated).toBe(true));
  it("filters sensitive headers", () => expect(filterHeaders({ "content-type": "text/html", "set-cookie": "a=b", authorization: "x" })).toEqual({ "content-type": "text/html" }));
  it("formats metadata and content", () => expect(formatOutput("t", { status: 200 }, "body")).toContain("body"));
});
