import { describe, expect, it } from "vitest";
import { extractContent } from "../src/extract.js";

describe("extract", () => {
  it("strips scripts/styles for text", () => expect(extractContent(Buffer.from("<h1>Hi</h1><script>bad()</script><style>x</style>"), "text/html", "text")).toBe("Hi"));
  it("converts html to markdown", () => expect(extractContent(Buffer.from("<h1>Hi</h1><p>There</p>"), "text/html", "markdown")).toContain("# Hi"));
  it("returns raw html", () => expect(extractContent(Buffer.from("<b>x</b>"), "text/html", "html")).toBe("<b>x</b>"));
  it("passes plain text", () => expect(extractContent(Buffer.from("plain"), "text/plain", "markdown")).toBe("plain"));
  it("rejects binary", () => expect(()=>extractContent(Buffer.from([0]), "image/png", "text")).toThrow());
});
