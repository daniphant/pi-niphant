import { describe, expect, it } from "vitest";
import { recommendStack } from "../src/core.js";

const config = {
  defaultStack: "standard-modern",
  stacks: {
    "budget": { reviewers: [] },
    "china-open": { reviewers: [] },
    "frontier-modern": { reviewers: [] },
    "standard-modern": { reviewers: [] },
  },
};

describe("recommendStack", () => {
  it("defaults ordinary technical plans to standard-modern", () => {
    const rec = recommendStack("Build a dashboard API integration with tests and docs.", config);
    expect(rec.stackId).toBe("standard-modern");
    expect(rec.scores["standard-modern"]).toBeGreaterThan(0);
  });

  it("chooses budget for explicit MVP/prototype/cost language", () => {
    const rec = recommendStack("Create a cheap MVP prototype and minimize spend for a quick demo.", config);
    expect(rec.stackId).toBe("budget");
    expect(rec.signals).toContain("explicit cost minimization");
  });

  it("chooses china-open for explicit provider diversity/open model language", () => {
    const rec = recommendStack("Review provider diversity using open model options like DeepSeek and Qwen.", config);
    expect(rec.stackId).toBe("china-open");
    expect(rec.signals).toContain("provider/model diversity language");
  });

  it("does not choose frontier for production or security words alone", () => {
    const rec = recommendStack("Production dashboard migration with security review and rollout notes.", config);
    expect(rec.stackId).toBe("standard-modern");
  });

  it("chooses frontier for auth/payment/PII/compliance risk", () => {
    const rec = recommendStack("Migrate multi-tenant auth, payment billing, and PII storage for a regulated enterprise app.", config);
    expect(rec.stackId).toBe("frontier-modern");
    expect(rec.scores["frontier-modern"]).toBeGreaterThanOrEqual(4);
  });

  it("falls back gracefully when preferred stack is missing", () => {
    const rec = recommendStack("Cheap MVP prototype", { defaultStack: "standard-modern", stacks: { "standard-modern": { reviewers: [] } } });
    expect(rec.stackId).toBe("standard-modern");
  });
});
