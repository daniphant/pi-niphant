import { describe, expect, it } from "vitest";

import { getModelLabel } from "../extensions/pi-hud/model.js";

describe("getModelLabel", () => {
  it("includes model name, thinking level, and context window", () => {
    const pi = { getThinkingLevel: () => "medium" } as const;
    const ctx = {
      model: {
        name: "GPT 5.4",
        contextWindow: 400_000,
      },
    } as any;

    expect(getModelLabel(pi as any, ctx)).toBe("GPT 5.4 medium (400k)");
  });

  it("omits thinking when off", () => {
    const pi = { getThinkingLevel: () => "off" } as const;
    const ctx = {
      model: {
        id: "glm-4.5",
        contextWindow: 128_000,
      },
    } as any;

    expect(getModelLabel(pi as any, ctx)).toBe("glm-4.5 (128k)");
  });
});
