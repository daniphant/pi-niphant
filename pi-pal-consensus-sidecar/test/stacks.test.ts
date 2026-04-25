import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Reviewer = {
  id?: unknown;
  label?: unknown;
  model?: unknown;
  stance?: unknown;
  prompt?: unknown;
};

type Stack = {
  label?: unknown;
  description?: unknown;
  costTier?: unknown;
  reviewers?: unknown;
  minSuccessfulReviewers?: unknown;
};

const stackDir = resolve(process.cwd(), "stacks");
const stackFiles = readdirSync(stackDir).filter((file) => file.endsWith(".json")).sort();
const catalog = new Set<string>(JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/pal-models.json"), "utf8")).models);
const validCostTiers = new Set(["low", "medium", "high", "frontier"]);
const validStances = new Set(["for", "against", "neutral"]);

function readStack(file: string): Stack {
  return JSON.parse(readFileSync(resolve(stackDir, file), "utf8")) as Stack;
}

describe("built-in reviewer stacks", () => {
  it("has stack fixture files", () => {
    expect(stackFiles).toEqual(["budget.json", "china-open.json", "frontier-modern.json", "standard-modern.json"]);
  });

  for (const file of stackFiles) {
    describe(file, () => {
      const stack = readStack(file);

      it("has required metadata", () => {
        expect(typeof stack.label).toBe("string");
        expect(String(stack.label).trim().length).toBeGreaterThan(0);
        expect(typeof stack.description).toBe("string");
        expect(String(stack.description).trim().length).toBeGreaterThan(0);
        expect(validCostTiers.has(String(stack.costTier))).toBe(true);
      });

      it("has a valid reviewer list", () => {
        expect(Array.isArray(stack.reviewers)).toBe(true);
        const reviewers = stack.reviewers as Reviewer[];
        expect(reviewers.length).toBeGreaterThanOrEqual(2);
        expect(reviewers.length).toBeLessThanOrEqual(16);
      });

      it("has valid reviewer fields and no duplicate ids/model-stance pairs", () => {
        const reviewers = stack.reviewers as Reviewer[];
        const ids = new Set<string>();
        const modelStances = new Set<string>();
        for (const reviewer of reviewers) {
          expect(typeof reviewer.id).toBe("string");
          expect(String(reviewer.id)).toMatch(/^[a-z0-9_-]+$/);
          expect(ids.has(String(reviewer.id))).toBe(false);
          ids.add(String(reviewer.id));

          expect(typeof reviewer.label).toBe("string");
          expect(String(reviewer.label).trim().length).toBeGreaterThan(0);
          expect(typeof reviewer.model).toBe("string");
          expect(String(reviewer.model).trim().length).toBeGreaterThan(0);
          expect(typeof reviewer.prompt).toBe("string");
          expect(String(reviewer.prompt).trim().length).toBeGreaterThan(0);
          expect(validStances.has(String(reviewer.stance ?? "neutral"))).toBe(true);

          const pair = `${String(reviewer.model)}:${String(reviewer.stance ?? "neutral")}`;
          expect(modelStances.has(pair)).toBe(false);
          modelStances.add(pair);
        }
      });

      it("has a valid minSuccessfulReviewers threshold", () => {
        const reviewers = stack.reviewers as Reviewer[];
        expect(Number.isInteger(stack.minSuccessfulReviewers)).toBe(true);
        expect(Number(stack.minSuccessfulReviewers)).toBeGreaterThanOrEqual(1);
        expect(Number(stack.minSuccessfulReviewers)).toBeLessThanOrEqual(reviewers.length);
      });

      it("uses model ids present in the PAL catalog fixture", () => {
        const reviewers = stack.reviewers as Reviewer[];
        const missing = reviewers.map((reviewer) => String(reviewer.model)).filter((model) => !catalog.has(model));
        expect(missing).toEqual([]);
      });
    });
  }
});
