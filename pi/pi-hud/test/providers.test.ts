import { describe, expect, it } from "vitest";

import { parseCodexQuota } from "../extensions/pi-hud/providers/codex.js";
import { detectQuotaProvider } from "../extensions/pi-hud/providers/detect.js";
import { computeZaiUsedPercent, parseZaiQuota } from "../extensions/pi-hud/providers/zai.js";

describe("provider detection", () => {
  it("detects codex", () => {
    expect(detectQuotaProvider({ provider: "openai", id: "codex-mini-latest" })).toBe("codex");
  });

  it("detects zai", () => {
    expect(detectQuotaProvider({ provider: "zai", id: "glm-4.5" })).toBe("zai");
    expect(detectQuotaProvider({ provider: "openai", name: "GLM 4.5" })).toBe("zai");
  });

  it("returns null for unsupported providers", () => {
    expect(detectQuotaProvider({ provider: "anthropic", id: "claude-sonnet" })).toBeNull();
  });

  it("handles nullish and dotted zai model names", () => {
    expect(detectQuotaProvider(null)).toBeNull();
    expect(detectQuotaProvider(undefined)).toBeNull();
    expect(detectQuotaProvider({ provider: "", name: "z.ai glm" })).toBe("zai");
  });
});

describe("codex parsing", () => {
  it("parses usage windows", () => {
    expect(parseCodexQuota({
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 12, reset_at: 100 },
        secondary_window: { used_percent: 40, reset_at: 200 },
      },
    })).toEqual({
      kind: "codex",
      plan: "plus",
      sessionUsedPercent: 12,
      sessionResetAt: 100000,
      weeklyUsedPercent: 40,
      weeklyResetAt: 200000,
    });
  });
});

describe("zai parsing", () => {
  it("computes used percent from limit fields", () => {
    expect(computeZaiUsedPercent({ usage: 1000, remaining: 900 })).toBe(10);
    expect(computeZaiUsedPercent({ usage: 1000, remaining: 1200 })).toBe(0);
    expect(computeZaiUsedPercent({ percentage: 7 })).toBe(7);
  });

  it("parses token windows and resets", () => {
    const parsed = parseZaiQuota({
      success: true,
      code: 200,
      data: {
        planName: "glm-pro",
        limits: [
          { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 1, nextResetTime: 1776053603881 },
          { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 2, nextResetTime: 1776537076997 },
        ],
      },
    });

    expect(parsed.kind).toBe("zai");
    expect(parsed.plan).toBe("glm-pro");
    expect(parsed.primary).toEqual({ label: "5h", usedPercent: 1, resetAt: 1776053603881 });
    expect(parsed.secondary).toEqual({ label: "7d", usedPercent: 2, resetAt: 1776537076997 });
  });
});
