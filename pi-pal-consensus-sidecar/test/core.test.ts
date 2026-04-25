import { describe, expect, it } from "vitest";
import {
  artifactKind,
  artifactMediaType,
  classifyError,
  collectModelInfos,
  FINDINGS_PARSER_VERSION,
  FINDINGS_SCHEMA_VERSION,
  REVIEW_PROMPT_VERSION,
  SIDECAR_VERSION,
  isSafeArtifactName,
  stackAvailability,
} from "../src/core.js";

describe("artifact helpers", () => {
  it("classifies artifact names", () => {
    expect(artifactKind("findings.json")).toBe("findings");
    expect(artifactKind("security.md")).toBe("reviewer_markdown");
    expect(artifactKind("security.json")).toBe("reviewer_json");
    expect(artifactKind("pal-stderr.log")).toBe("log");
    expect(artifactKind("notes.txt")).toBe("text");
  });

  it("validates safe artifact filenames", () => {
    expect(isSafeArtifactName("findings.json")).toBe(true);
    expect(isSafeArtifactName("../secret.json")).toBe(false);
    expect(isSafeArtifactName("nested/file.md")).toBe(false);
    expect(isSafeArtifactName(".env")).toBe(false);
    expect(isSafeArtifactName("image.png")).toBe(false);
  });

  it("returns text media types for known artifact extensions", () => {
    expect(artifactMediaType("findings.json")).toContain("application/json");
    expect(artifactMediaType("review.md")).toContain("text/markdown");
    expect(artifactMediaType("pal-stderr.log")).toContain("text/plain");
  });
});

describe("collectModelInfos", () => {
  it("parses model ids from common JSON shapes", () => {
    const models = collectModelInfos({
      models: ["openai/gpt-5.5"],
      data: [{ id: "anthropic/claude-sonnet-4.6", aliases: ["claude-latest"] }],
    });
    expect(models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"]);
    expect(models.find((model) => model.id === "openai/gpt-5.5")?.provider).toBe("openai");
    expect(models.find((model) => model.id === "anthropic/claude-sonnet-4.6")?.aliases).toEqual(["claude-latest"]);
  });

  it("parses model ids from text responses and deduplicates", () => {
    const models = collectModelInfos({ text: "available: google/gemini-3.1-pro-preview, z-ai/glm-5.1, google/gemini-3.1-pro-preview" });
    expect(models.map((model) => model.id)).toEqual(["google/gemini-3.1-pro-preview", "z-ai/glm-5.1"]);
  });
});

describe("stackAvailability", () => {
  const config = {
    stacks: {
      standard: {
        reviewers: [
          { id: "a", label: "A", model: "openai/gpt-5.5" },
          { id: "b", label: "B", model: "claude-latest" },
          { id: "c", label: "C", model: "missing/model" },
        ],
      },
    },
  };

  it("counts available models, aliases, and unavailable models", () => {
    const availability = stackAvailability(config, [
      { id: "openai/gpt-5.5" },
      { id: "anthropic/claude-sonnet-4.6", aliases: ["claude-latest"] },
    ]).standard;
    expect(availability.available).toBe(2);
    expect(availability.unavailable).toBe(1);
    expect(availability.unknown).toBe(0);
    expect(availability.reviewers.map((reviewer) => reviewer.availability)).toEqual(["available", "available", "unavailable"]);
  });

  it("marks stack models unknown when discovery returns no models", () => {
    const availability = stackAvailability(config, []).standard;
    expect(availability.available).toBe(0);
    expect(availability.unavailable).toBe(0);
    expect(availability.unknown).toBe(3);
  });
});

describe("classifyError", () => {
  it.each([
    ["Plan file not found: nope.md", "plan_file_not_found", false],
    ["Plan file is too large: 999 bytes exceeds PAL_SIDECAR_MAX_PLAN_BYTES=10.", "plan_file_too_large", false],
    ["Concurrent run limit exceeded: 1 active run(s), max 1.", "concurrency_limit_exceeded", true],
    ["Plan file must be inside a trusted root", "plan_file_untrusted_root", false],
    ["PAL needs at least one provider key", "pal_provider_key_missing", false],
    ["PAL MCP did not expose a consensus tool", "pal_contract_mismatch", false],
    ["Timed out waiting for PAL consensus", "pal_timeout", true],
    ["Run cancelled.", "run_cancelled", true],
    ["Duplicate PAL model+stance pair", "invalid_reviewer_config", false],
    ["Selected stack has 1 reviewer model(s) not reported by PAL listmodels.", "model_unavailable", false],
    ["Only 2/5 reviewers succeeded; required 4.", "insufficient_successful_reviewers", true],
    ["Something else", "unknown_error", true],
  ])("maps %s", (message, code, retryable) => {
    expect(classifyError(message)).toMatchObject({ code, retryable });
  });
});

describe("version constants", () => {
  it("exposes stable artifact version metadata", () => {
    expect(FINDINGS_SCHEMA_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(FINDINGS_PARSER_VERSION).toBe("deterministic-markdown-v1");
    expect(REVIEW_PROMPT_VERSION).toBe("plan-review-v1");
    expect(SIDECAR_VERSION).toBe("0.1.0");
  });
});
