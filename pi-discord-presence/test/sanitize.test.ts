import { describe, expect, it } from "vitest";
import { sanitizeLabel, sanitizeModelLabel, sanitizeProjectLabel } from "../extensions/pi-discord-presence/sanitize.js";

const allowed = /^[\p{L}\p{N} ._+\-#()…]+$/u;

describe("sanitizeLabel", () => {
  it("removes path separators, shell metacharacters, controls, and zero-width characters", () => {
    const result = sanitizeProjectLabel("/secret/Repo\u200b; rm -rf $HOME\n");
    expect(result).toBe("secret Repo rm -rf HOME");
    expect(result).toMatch(allowed);
  });

  it("falls back for empty or suspicious labels", () => {
    expect(sanitizeLabel("///", "Pi")).toBe("Pi");
    expect(sanitizeLabel("..", "Pi")).toBe("Pi");
  });

  it("normalizes unicode and truncates safely", () => {
    expect(sanitizeModelLabel("ＡＩ+Model#1")).toBe("AI+Model#1");
    expect([...sanitizeLabel("x".repeat(100), "Pi")].length).toBeLessThanOrEqual(64);
  });
});
