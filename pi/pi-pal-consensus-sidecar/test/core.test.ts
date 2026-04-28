import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  artifactKind,
  artifactMediaType,
  buildFindingsHotspots,
  classifyError,
  classifyFindingBucket,
  collectModelInfos,
  extractCompactFindingsSummary,
  FINDINGS_PARSER_VERSION,
  FINDINGS_SCHEMA_VERSION,
  REVIEW_PROMPT_VERSION,
  SIDECAR_VERSION,
  isSafeArtifactName,
  markdownSection,
  parseReviewerFindings,
  renderFindingsSummaryMarkdown,
  sanitizeErrorMessage,
  stackAvailability,
  stackAvailabilityPolicyErrorMessage,
  stackAvailabilityWarnings,
} from "../src/core.js";

describe("artifact helpers", () => {
  it("classifies artifact names", () => {
    expect(artifactKind("findings.json")).toBe("findings");
    expect(artifactKind("findings-summary.md")).toBe("findings_summary");
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
    expect(availability.runtimeUnhealthy).toBe(0);
    expect(availability.runtimeDegraded).toBe(0);
  });

  it("annotates reviewers with recent runtime health failures", () => {
    const availability = stackAvailability(config, [{ id: "openai/gpt-5.5" }], {
      "openai/gpt-5.5": {
        model: "openai/gpt-5.5",
        status: "unhealthy",
        code: "pal_model_no_endpoint",
        message: "No endpoints found for openai/gpt-5.5",
        retryable: false,
        guidance: "Replace the model.",
        failedAt: "2026-04-25T00:00:00.000Z",
        expiresAt: "2026-04-25T01:00:00.000Z",
        runId: "run-1",
        reviewer: "a",
      },
      "missing/model": {
        model: "missing/model",
        status: "degraded",
        code: "pal_rate_limited",
        message: "rate limited",
        retryable: true,
        failedAt: "2026-04-25T00:00:00.000Z",
        expiresAt: "2026-04-25T01:00:00.000Z",
      },
    }).standard;
    expect(availability.runtimeUnhealthy).toBe(1);
    expect(availability.runtimeDegraded).toBe(1);
    expect(availability.reviewers[0].runtimeHealth?.code).toBe("pal_model_no_endpoint");
    expect(availability.reviewers[2].runtimeHealth?.status).toBe("degraded");
  });

  it("emits runtime health warnings under warn policy", () => {
    const availability = stackAvailability(config, [{ id: "openai/gpt-5.5" }, { id: "claude-latest" }], {
      "openai/gpt-5.5": {
        model: "openai/gpt-5.5",
        status: "unhealthy",
        code: "pal_model_no_endpoint",
        message: "No endpoints found",
        retryable: false,
        failedAt: "2026-04-25T00:00:00.000Z",
        expiresAt: "2026-04-25T01:00:00.000Z",
      },
    }).standard;
    const warnings = stackAvailabilityWarnings("standard", availability, "warn");
    expect(warnings.map((warning) => warning.code)).toEqual(["model_availability_warning", "model_runtime_health_warning"]);
    expect(warnings[1].message).toContain("1 unhealthy and 0 degraded");
  });

  it("suppresses warnings when availability policy is off", () => {
    const availability = stackAvailability(config, [{ id: "openai/gpt-5.5" }], {
      "openai/gpt-5.5": {
        model: "openai/gpt-5.5",
        status: "unhealthy",
        code: "pal_model_no_endpoint",
        message: "No endpoints found",
        retryable: false,
        failedAt: "2026-04-25T00:00:00.000Z",
        expiresAt: "2026-04-25T01:00:00.000Z",
      },
    }).standard;
    expect(stackAvailabilityWarnings("standard", availability, "off")).toEqual([]);
  });

  it("builds a blocking policy error for runtime health warnings", () => {
    const availability = stackAvailability(config, [{ id: "openai/gpt-5.5" }, { id: "claude-latest" }, { id: "missing/model" }], {
      "missing/model": {
        model: "missing/model",
        status: "degraded",
        code: "pal_rate_limited",
        message: "rate limited",
        retryable: true,
        failedAt: "2026-04-25T00:00:00.000Z",
        expiresAt: "2026-04-25T01:00:00.000Z",
      },
    }).standard;
    const warnings = stackAvailabilityWarnings("standard", availability, "block");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("model_runtime_health_warning");
    expect(stackAvailabilityPolicyErrorMessage(warnings)).toContain("Set PAL_SIDECAR_MODEL_AVAILABILITY_POLICY=warn");
  });
});

describe("reviewer markdown parser", () => {
  const fixture = (name: string) => readFileSync(resolve(process.cwd(), "test/fixtures/reviewer-markdown", name), "utf8");
  const artifact = (markdown: string) => ({ reviewer: { id: "qa", label: "QA Reviewer", model: "openai/o3-mini" }, status: "success" as const, markdown, mdPath: "/tmp/qa.md" });

  it("extracts sections without leaking later headings", () => {
    const text = fixture("structured-list.md");
    const findings = markdownSection(text, "Findings");
    expect(findings).toContain("Direct production deploy");
    expect(findings).not.toContain("Raw Concerns");
  });

  it("parses numbered structured findings cleanly", () => {
    const findings = parseReviewerFindings(artifact(fixture("structured-list.md")));
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ severity: "major", location: "Lines 10-12", issue: "Direct production deploy skips staging and can break auth.", recommendation: "Add staging and canary gates." });
    expect(findings[0].issue).not.toMatch(/^##/);
  });

  it("splits ### Severity blocks into multiple findings", () => {
    const findings = parseReviewerFindings(artifact(fixture("heading-blocks.md")));
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.severity)).toEqual(["major", "minor"]);
    expect(findings[0].recommendation).toBe("Define reversible migration steps and a tested restore path.");
  });

  it("splits Finding N labels into multiple findings", () => {
    const findings = parseReviewerFindings(artifact(fixture("finding-labels.md")));
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe("critical");
    expect(findings[1].issue).toBe("Validation relies on manual smoke tests only.");
  });

  it("strips raw concerns and approval recommendation contamination", () => {
    const findings = parseReviewerFindings(artifact(fixture("contaminated-fields.md")));
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings[0].recommendation).toBe("Reassess downtime and data consistency risks.");
    expect(findings[0].recommendation).not.toContain("Raw Concerns");
    expect(findings[0].recommendation).not.toContain("Approval Recommendation");
  });
});

describe("findings normalization helpers", () => {
  it.each([
    [{ severity: "critical", issue: "Missing validation can cause data loss", recommendation: "Must fix before approval" }, "blocking"],
    [{ severity: "minor", issue: "Consider adding copy polish", recommendation: "Optional" }, "suggestion"],
    [{ severity: "unknown", issue: "Unclear whether rollback is required", recommendation: "Clarify TBD" }, "question"],
  ] as const)("classifies finding buckets", (finding, bucket) => {
    expect(classifyFindingBucket(finding)).toBe(bucket);
  });

  it("builds deterministic hotspots", () => {
    const hotspots = buildFindingsHotspots([
      { reviewer: "ops", issue: "Rollback plan is missing" },
      { reviewer: "security", issue: "Migration can cause data loss without rollback" },
      { reviewer: "qa", issue: "Tests are missing" },
      { reviewer: "maintainer", issue: "Validation command is missing" },
    ]);
    expect(hotspots).toContainEqual({ topic: "rollback and migration safety", count: 2, reviewers: ["ops", "security"] });
    expect(hotspots).toContainEqual({ topic: "validation and tests", count: 2, reviewers: ["maintainer", "qa"] });
  });

  it("extracts compact findings summaries from v2 findings", () => {
    expect(extractCompactFindingsSummary({ summary: { recommendation: "revise", blocking_count: 2, suggestion_count: 3, question_count: 1, reviewer_success: "4/4", failed_reviewer_count: 0, warning_count: 1, total_findings: 6 } })).toEqual({
      recommendation: "revise",
      blocking_count: 2,
      suggestion_count: 3,
      question_count: 1,
      reviewer_success: "4/4",
      failed_reviewer_count: 0,
      warning_count: 1,
      total_findings: 6,
    });
    expect(extractCompactFindingsSummary({ recommendation: "revise" })).toBeUndefined();
    expect(extractCompactFindingsSummary("not json")).toBeUndefined();
  });

  it("renders stable markdown summaries", () => {
    const markdown = renderFindingsSummaryMarkdown({
      run_id: "pal-test",
      status: "complete",
      recommendation: "revise",
      reviewer_success: { successful: 2, total: 2, minimum: 2 },
      warning_count: 0,
      failed_reviewers: [],
      blocking_findings: [{ reviewer: "security", reviewer_label: "Security", model: "openai/o3", issue: "Missing auth validation", recommendation: "Add auth tests" }],
      suggestion_findings: [],
      question_findings: [],
      hotspots: [{ topic: "validation and tests", count: 2, reviewers: ["qa", "security"] }],
      artifactDir: "/tmp/pal-test",
    });
    expect(markdown).toContain("# PAL Consensus Findings Summary");
    expect(markdown).toContain("Recommendation: revise");
    expect(markdown).toContain("## Blocking Findings");
    expect(markdown).toContain("Missing auth validation");
    expect(markdown).toContain("validation and tests: 2 finding(s) from qa, security");
  });
});

describe("classifyError", () => {
  it("sanitizes provider metadata in structured messages", () => {
    const message = "OpenRouter error {'user_id': 'user_38Utdy8H2nXUBp87Bji661qO9pY'} with sk-or-v1-abcdefghijklmnopqrstuvwxyz";
    expect(sanitizeErrorMessage(message)).not.toContain("user_38Utdy8H2nXUBp87Bji661qO9pY");
    expect(sanitizeErrorMessage(message)).not.toContain("sk-or-v1-abcdefghijklmnopqrstuvwxyz");
    expect(classifyError(message).message).toContain("[redacted]");
  });

  it.each([
    ["Plan file not found: nope.md", "plan_file_not_found", false],
    ["Plan file is too large: 999 bytes exceeds PAL_SIDECAR_MAX_PLAN_BYTES=10.", "plan_file_too_large", false],
    ["Concurrent run limit exceeded: 1 active run(s), max 1.", "concurrency_limit_exceeded", true],
    ["Plan file must be inside a trusted root", "plan_file_untrusted_root", false],
    ["PAL needs at least one provider key", "pal_provider_key_missing", false],
    ["PAL MCP did not expose a consensus tool", "pal_contract_mismatch", false],
    ["Timed out waiting for PAL consensus", "pal_timeout", true],
    ["Run cancelled.", "run_cancelled", true],
    ["Duplicate PAL model+stance pair", "duplicate_model_stance", false],
    ["No reviewers configured for run", "no_reviewers_configured", false],
    ["Selected stack has 1 reviewer model(s) not reported by PAL listmodels.", "model_unavailable", false],
    ["OpenRouter returned 429 rate limit exceeded", "pal_rate_limited", true],
    ["Quota exceeded: insufficient credits", "pal_quota_exceeded", false],
    ["Provider returned 401 invalid API key", "pal_provider_auth_failed", false],
    ["No endpoints found for meta-llama/llama-3-70b", "pal_model_no_endpoint", false],
    ["Model not found: openai/missing-model", "pal_model_not_found", false],
    ["openai/not-real is not a valid model ID", "pal_model_not_found", false],
    ["Maximum context length exceeded: too many tokens", "pal_context_length_exceeded", false],
    ["Request blocked by content policy", "pal_content_policy_block", false],
    ["Provider returned 503 service unavailable", "pal_upstream_unavailable", true],
    ["Network ECONNRESET while calling provider", "pal_network_error", true],
    ["Malformed provider response: invalid JSON", "pal_malformed_response", true],
    ["PAL subprocess exited with exit code 1", "pal_subprocess_failed", true],
    ["Only 2/5 reviewers succeeded; required 4.", "insufficient_successful_reviewers", true],
    ["Invalid sidecar config: bad reviewer", "invalid_reviewer_config", false],
    ["Something else", "unknown_error", true],
  ])("maps %s", (message, code, retryable) => {
    const classified = classifyError(message);
    expect(classified).toMatchObject({ code, retryable });
    expect(classified.guidance).toBeTruthy();
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
