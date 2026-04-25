export interface StructuredError {
  code: string;
  message: string;
  retryable: boolean;
  guidance?: string;
  details?: unknown;
}

export interface PalModelInfo {
  id: string;
  provider?: string;
  aliases?: string[];
  raw?: unknown;
}

export interface ModelRuntimeHealth {
  model: string;
  status: "unhealthy" | "degraded";
  code: string;
  message: string;
  retryable: boolean;
  guidance?: string;
  failedAt: string;
  expiresAt: string;
  runId?: string;
  reviewer?: string;
}

export interface StackAvailability {
  available: number;
  unknown: number;
  unavailable: number;
  runtimeUnhealthy: number;
  runtimeDegraded: number;
  reviewers: Array<{
    id: string;
    label: string;
    model: string;
    availability: "available" | "unavailable" | "unknown";
    runtimeHealth?: ModelRuntimeHealth;
  }>;
}

export interface ReviewerLike {
  id: string;
  label: string;
  model: string;
}

export interface StackLike {
  reviewers: ReviewerLike[];
}

export interface ConfigLike {
  stacks: Record<string, StackLike>;
  defaultStack?: string;
}

export interface StackRecommendation {
  stackId: string;
  reason: string;
  scores: Record<string, number>;
  signals: string[];
}

export type ArtifactKind = "findings" | "findings_summary" | "reviewer_markdown" | "reviewer_json" | "log" | "text" | "unknown";
export type FindingBucket = "blocking" | "suggestion" | "question";

export interface FindingLike {
  severity?: string;
  reviewer?: string;
  reviewer_label?: string;
  model?: string;
  location?: string;
  issue: string;
  recommendation?: string;
  confidence?: "high" | "medium" | "low" | "unknown";
  artifact?: string;
}

export interface ReviewerArtifactLike {
  reviewer: { id: string; label: string; model: string };
  status: "success" | "error";
  markdown: string;
  mdPath: string;
}

export interface CompactFindingsSummary {
  recommendation: string;
  blocking_count: number;
  suggestion_count: number;
  question_count: number;
  reviewer_success: string;
  failed_reviewer_count: number;
  warning_count: number;
  total_findings: number;
}

export interface FindingsSummaryInput {
  run_id: string;
  status: string;
  recommendation: string;
  reviewer_success: { successful: number; total: number; minimum: number };
  warning_count: number;
  failed_reviewers: Array<{ reviewer: string; model?: string; error?: string; structured_error?: StructuredError }>;
  blocking_findings: FindingLike[];
  suggestion_findings: FindingLike[];
  question_findings: FindingLike[];
  hotspots: Array<{ topic: string; count: number; reviewers: string[] }>;
  artifactDir?: string;
}

export const SIDECAR_VERSION = "0.1.0";
export const FINDINGS_SCHEMA_VERSION = "2026-04-25.1";
export const FINDINGS_PARSER_VERSION = "deterministic-markdown-v1";
export const REVIEW_PROMPT_VERSION = "plan-review-v1";

export function markdownSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^#{1,6}\\s+${escaped}\\s*$([\\s\\S]*?)(?=^#{1,6}\\s+|(?![\\s\\S]))`, "im"));
  return (match?.[1] ?? "").trim();
}

export function normalizeFindingSeverity(text: string): "critical" | "major" | "minor" | "nit" | "unknown" {
  const lower = text.toLowerCase();
  if (/\b(critical|blocker|severe|approval-blocking|catastrophic)\b/.test(lower)) return "critical";
  if (/\b(major|high|urgent)\b/.test(lower)) return "major";
  if (/\b(moderate|medium|minor)\b/.test(lower)) return "minor";
  if (/\b(low|nit|info|informational)\b/.test(lower)) return lower.includes("nit") ? "nit" : "minor";
  return "unknown";
}

export function confidenceFromFindingSeverity(severity: FindingLike["severity"]): "high" | "medium" | "low" | "unknown" {
  if (severity === "critical" || severity === "major") return "high";
  if (severity === "minor") return "medium";
  if (severity === "nit") return "low";
  return "unknown";
}

function stripInlineContamination(text: string): string {
  return text
    .replace(/\s+#{1,6}\s+(Verdict|Analysis|Findings|Raw Concerns|Approval Recommendation|Confidence Score|Key Takeaways)[\s\S]*$/i, "")
    .replace(/\s+\b(Finding\s+\d+\s*:)\s*$/i, "")
    .trim();
}

export function cleanupFindingText(text: string, maxLength = 800): string {
  const cleaned = stripInlineContamination(text)
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\s*[•*-]\s*/gm, "")
    .replace(/^\s*\d+[.)]\s*/gm, "")
    .replace(/\*\*(Severity|Location|Issue|Recommendation|Confidence)\*\*\s*[:：]/gi, "$1:")
    .replace(/\*(Severity|Location|Issue|Recommendation|Confidence)\*\s*[:：]/gi, "$1:")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}…` : cleaned;
}

export function extractFindingField(block: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:Severity|Location|Issue|Recommendation|Confidence)(?:\\*\\*)?\\s*[:：]|\\n\\s*(?:Finding\\s+\\d+|#{1,6})\\b|$)`, "i");
    const match = block.match(pattern);
    if (match?.[1]) return cleanupFindingText(match[1]);
  }
  return undefined;
}

export function splitFindingBlocks(findingsText: string): string[] {
  const normalized = findingsText.replace(/\r\n/g, "\n");
  const headingBlocks = normalized.split(/(?=^#{3,6}\s+(?:Severity|Finding|Issue|High|Major|Critical|Medium|Minor)\b.*$)/gim).map((block) => block.trim()).filter(Boolean);
  if (headingBlocks.length > 1) return headingBlocks;
  const labelBlocks = normalized.split(/(?=^\s*Finding\s+\d+\s*[:.-])/gim).map((block) => block.trim()).filter(Boolean);
  if (labelBlocks.length > 1) return labelBlocks;
  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  const startsBlock = (line: string) => /^\s*\d+[.)]\s+/.test(line) || (/^\s*[-*]\s+/.test(line) && /\b(severity|critical|major|high|moderate|medium|minor|low|nit|issue)\b/i.test(line));
  for (const line of lines) {
    if (startsBlock(line) && current.join("\n").trim()) {
      blocks.push(current.join("\n").trim());
      current = [line];
    } else current.push(line);
  }
  if (current.join("\n").trim()) blocks.push(current.join("\n").trim());
  return blocks.length ? blocks : normalized.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

export function parseReviewerFindings(artifact: ReviewerArtifactLike): FindingLike[] {
  if (artifact.status !== "success") return [];
  const findingsText = markdownSection(artifact.markdown, "Findings") || artifact.markdown;
  const blocks = splitFindingBlocks(findingsText);
  const parsed: FindingLike[] = [];
  for (const block of blocks) {
    if (!/\b(issue|recommendation|risk|missing|should|must|severity|major|high|medium|low|critical|rollback|validation)\b/i.test(block)) continue;
    const severity = normalizeFindingSeverity(extractFindingField(block, ["Severity"]) || block);
    const location = extractFindingField(block, ["Location"]) || block.match(/\b(?:Lines?|Plan lines?)\s+\d+(?:\s*-\s*\d+)?\b/i)?.[0];
    const rawIssue = extractFindingField(block, ["Issue"])
      || cleanupFindingText(block.split(/Recommendation\s*[:：]/i)[0] || block);
    const issue = rawIssue.replace(/^Finding\s+\d+\s*[:.-]\s*/i, "").replace(/^Severity\s*[:：]\s*\w+\s*/i, "").trim();
    const recommendation = extractFindingField(block, ["Recommendation"]);
    if (!issue) continue;
    parsed.push({
      severity,
      reviewer: artifact.reviewer.id,
      reviewer_label: artifact.reviewer.label,
      model: artifact.reviewer.model,
      location,
      issue: cleanupFindingText(issue),
      recommendation,
      confidence: confidenceFromFindingSeverity(severity),
      artifact: artifact.mdPath,
    });
  }
  return parsed;
}

export function extractCompactFindingsSummary(value: unknown): CompactFindingsSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const summary = (value as Record<string, unknown>).summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return undefined;
  const record = summary as Record<string, unknown>;
  if (typeof record.recommendation !== "string") return undefined;
  const numberField = (key: string) => typeof record[key] === "number" ? record[key] as number : 0;
  return {
    recommendation: record.recommendation,
    blocking_count: numberField("blocking_count"),
    suggestion_count: numberField("suggestion_count"),
    question_count: numberField("question_count"),
    reviewer_success: typeof record.reviewer_success === "string" ? record.reviewer_success : "unknown",
    failed_reviewer_count: numberField("failed_reviewer_count"),
    warning_count: numberField("warning_count"),
    total_findings: numberField("total_findings"),
  };
}

export function classifyFindingBucket(finding: FindingLike): FindingBucket {
  const text = `${finding.severity ?? ""} ${finding.issue ?? ""} ${finding.recommendation ?? ""}`.toLowerCase();
  if (/\b(question|unclear|clarify|clarification|ambiguous|tbd|open question|unknown requirement)\b/.test(text)) return "question";
  if (/\b(optional|nice to have|nice-to-have|polish|consider|could|may want|minor|nit|low priority)\b/.test(text)) return "suggestion";
  if (/\b(critical|major|blocker|blocking|must fix|must address|cannot approve|reject|unsafe|security vulnerability|data loss|contradiction|missing validation|rollback|secrets?|pii|auth|payment)\b/.test(text)) return "blocking";
  if (finding.severity === "critical" || finding.severity === "major") return "blocking";
  if (finding.severity === "minor" || finding.severity === "nit") return "suggestion";
  return "suggestion";
}

function topicForFinding(finding: FindingLike): string {
  const text = `${finding.issue} ${finding.recommendation ?? ""}`.toLowerCase();
  const topics: Array<[RegExp, string]> = [
    [/\b(rollback|revert|migration|data loss|destructive)\b/, "rollback and migration safety"],
    [/\b(test|tests|validation|validate|diagnostic|diagnostics|ci|coverage|command|commands)\b/, "validation and tests"],
    [/\b(auth|oauth|permission|session|credential)\b/, "authentication and authorization"],
    [/\b(secret|api key|token|credential)\b/, "secrets handling"],
    [/\b(pii|privacy|personal data|customer data)\b/, "privacy and customer data"],
    [/\b(cost|budget|quota|rate limit|spend)\b/, "cost and quota controls"],
    [/\b(timeout|cancel|retry|concurrency)\b/, "timeouts retries and concurrency"],
    [/\b(path|traversal|filesystem|artifact)\b/, "artifact and path safety"],
    [/\b(model|provider|openrouter|pal|mcp)\b/, "model/provider configuration"],
    [/\b(ui|dashboard|ux|browser)\b/, "dashboard UX"],
  ];
  for (const [pattern, topic] of topics) if (pattern.test(text)) return topic;
  return text.split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["should", "would", "could", "this", "that", "with", "from", "plan", "need", "needs"].includes(word)).slice(0, 3).join(" ") || "general plan quality";
}

export function buildFindingsHotspots(findings: FindingLike[]): Array<{ topic: string; count: number; reviewers: string[] }> {
  const byTopic = new Map<string, { topic: string; count: number; reviewers: Set<string> }>();
  for (const finding of findings) {
    const topic = topicForFinding(finding);
    const entry = byTopic.get(topic) ?? { topic, count: 0, reviewers: new Set<string>() };
    entry.count += 1;
    if (finding.reviewer) entry.reviewers.add(finding.reviewer);
    byTopic.set(topic, entry);
  }
  return [...byTopic.values()]
    .filter((entry) => entry.count > 1 || entry.reviewers.size > 1)
    .map((entry) => ({ topic: entry.topic, count: entry.count, reviewers: [...entry.reviewers].sort() }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

function renderFindingList(findings: FindingLike[]): string {
  if (!findings.length) return "_None._\n";
  return findings.map((finding, index) => {
    const parts = [
      `${index + 1}. **${finding.reviewer_label || finding.reviewer || "Reviewer"}**${finding.model ? ` (${finding.model})` : ""}`,
      finding.location ? `   - Location: ${finding.location}` : undefined,
      `   - Issue: ${finding.issue}`,
      finding.recommendation ? `   - Recommendation: ${finding.recommendation}` : undefined,
    ].filter(Boolean);
    return parts.join("\n");
  }).join("\n\n") + "\n";
}

export function renderFindingsSummaryMarkdown(input: FindingsSummaryInput): string {
  const lines = [
    "# PAL Consensus Findings Summary",
    "",
    `Run: ${input.run_id}`,
    `Status: ${input.status}`,
    `Recommendation: ${input.recommendation}`,
    `Reviewer success: ${input.reviewer_success.successful}/${input.reviewer_success.total} (minimum ${input.reviewer_success.minimum})`,
    `Warnings: ${input.warning_count}`,
    `Failed reviewers: ${input.failed_reviewers.length}`,
    input.artifactDir ? `Artifacts: ${input.artifactDir}` : undefined,
    "",
    "## Blocking Findings",
    "",
    renderFindingList(input.blocking_findings),
    "## Suggestions",
    "",
    renderFindingList(input.suggestion_findings),
    "## Questions / Clarifications",
    "",
    renderFindingList(input.question_findings),
    "## Hotspots",
    "",
    input.hotspots.length ? input.hotspots.map((hotspot) => `- ${hotspot.topic}: ${hotspot.count} finding(s) from ${hotspot.reviewers.join(", ") || "unknown reviewers"}`).join("\n") : "_None._",
    "",
    "## Failed Reviewers",
    "",
    input.failed_reviewers.length ? input.failed_reviewers.map((failed) => `- ${failed.reviewer}${failed.model ? ` (${failed.model})` : ""}: ${failed.structured_error?.code ?? failed.error ?? "failed"}${failed.structured_error?.guidance ? ` — ${failed.structured_error.guidance}` : ""}`).join("\n") : "_None._",
    "",
  ].filter((line): line is string => line !== undefined);
  return lines.join("\n");
}

export function artifactKind(name: string): ArtifactKind {
  if (name === "findings.json") return "findings";
  if (name === "findings-summary.md") return "findings_summary";
  if (name === "pal-stderr.log" || name.endsWith(".log")) return "log";
  if (name.endsWith(".md")) return "reviewer_markdown";
  if (name.endsWith(".json")) return "reviewer_json";
  if (name.endsWith(".txt")) return "text";
  return "unknown";
}

export function artifactMediaType(name: string): string {
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (name.endsWith(".log") || name.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function isSafeArtifactName(name: string): boolean {
  if (!name || name.length > 160) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.startsWith(".")) return false;
  return /\.(json|md|log|txt)$/i.test(name);
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(['"]?user_id['"]?\s*:\s*)['"][^'"]+['"]/gi, "$1'[redacted]'")
    .replace(/\b(user_[A-Za-z0-9_-]{8,})\b/g, "[redacted-user-id]")
    .replace(/\b(sk-or-v1-[A-Za-z0-9_-]{16,})\b/g, "[redacted-api-key]")
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, "[redacted-api-key]");
}

function structuredError(code: string, message: string, retryable: boolean, guidance: string, details?: unknown): StructuredError {
  return { code, message: sanitizeErrorMessage(message), retryable, guidance, details };
}

export function classifyError(error: unknown, details?: unknown): StructuredError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("plan file not found")) return structuredError("plan_file_not_found", message, false, "Check the plan file path and rerun with an existing markdown file.", details);
  if (lower.includes("plan file is too large") || lower.includes("plan text is too large")) return structuredError("plan_file_too_large", message, false, "Reduce the reviewed text, split the review, or raise PAL_SIDECAR_MAX_PLAN_BYTES intentionally.", details);
  if (lower.includes("concurrent run limit")) return structuredError("concurrency_limit_exceeded", message, true, "Wait for the active PAL run to finish, cancel it, or raise PAL_SIDECAR_MAX_CONCURRENT_RUNS intentionally.", details);
  if (lower.includes("trusted root") || lower.includes("allowed roots")) return structuredError("plan_file_untrusted_root", message, false, "Move the plan under cwd/~/.pi or add the directory to PAL_SIDECAR_ALLOWED_ROOTS.", details);
  if (lower.includes("provider key") || lower.includes("api_key") || lower.includes("api key missing") || lower.includes("missing api key")) return structuredError("pal_provider_key_missing", message, false, "Set the required PAL/OpenRouter/provider API key environment variables and restart Pi/the sidecar.", details);
  if (lower.includes("did not expose") && lower.includes("tool")) return structuredError("pal_contract_mismatch", message, false, "Update PAL MCP or verify the configured PAL command exposes the required consensus/listmodels tools.", details);
  if (lower.includes("cancelled")) return structuredError("run_cancelled", message, true, "Rerun the review if cancellation was accidental.", details);
  if (lower.includes("duplicate") && lower.includes("model+stance")) return structuredError("duplicate_model_stance", message, false, "Use a unique PAL model+stance pair for each reviewer in the selected stack or custom reviewer list.", details);
  if (lower.includes("no reviewers") || lower.includes("at least one reviewer") || lower.includes("reviewer list is empty")) return structuredError("no_reviewers_configured", message, false, "Select a built-in stack or configure at least one reviewer before starting consensus.", details);
  if (lower.includes("not reported by pal listmodels")) return structuredError("model_unavailable", message, false, "Run PAL model discovery and update stack model IDs to currently available PAL/OpenRouter catalog entries.", details);
  if (/\b429\b/.test(lower) || lower.includes("rate limit") || lower.includes("too many requests")) return structuredError("pal_rate_limited", message, true, "Wait and retry later, or use fewer reviewers/a lower-cost stack to reduce provider pressure.", details);
  if (lower.includes("quota") || lower.includes("insufficient credits") || lower.includes("credit balance") || lower.includes("billing hard limit")) return structuredError("pal_quota_exceeded", message, false, "Add provider credits, raise quota, or switch to a stack/provider with available quota.", details);
  if (/\b(401|403)\b/.test(lower) || lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("invalid api key") || lower.includes("invalid_api_key") || lower.includes("permission denied")) return structuredError("pal_provider_auth_failed", message, false, "Verify provider credentials, account permissions, and PAL/OpenRouter API key configuration.", details);
  if (lower.includes("no endpoints found") || lower.includes("no endpoint found") || lower.includes("no available endpoints")) return structuredError("pal_model_no_endpoint", message, false, "PAL/OpenRouter lists the model but has no serving endpoint for it. Replace the model in the stack and rerun discovery.", details);
  if (lower.includes("model not found") || lower.includes("model_not_found") || lower.includes("does not exist") || lower.includes("unknown model") || lower.includes("invalid model") || lower.includes("not a valid model id")) return structuredError("pal_model_not_found", message, false, "Run PAL model discovery and replace unavailable model IDs in the selected stack.", details);
  if (lower.includes("context length") || lower.includes("maximum context") || lower.includes("token limit") || lower.includes("too many tokens") || lower.includes("context window")) return structuredError("pal_context_length_exceeded", message, false, "Shorten planText, review a smaller artifact, or choose models with a larger context window.", details);
  if (lower.includes("content policy") || lower.includes("safety policy") || lower.includes("policy violation") || lower.includes("blocked by policy") || lower.includes("moderation")) return structuredError("pal_content_policy_block", message, false, "Remove or redact policy-triggering content from the reviewed artifact before retrying.", details);
  if (/\b(500|502|503|504)\b/.test(lower) || lower.includes("service unavailable") || lower.includes("bad gateway") || lower.includes("gateway timeout") || lower.includes("upstream") || lower.includes("overloaded")) return structuredError("pal_upstream_unavailable", message, true, "Retry later, or switch stacks/providers if the upstream provider remains unavailable.", details);
  if (lower.includes("enotfound") || lower.includes("econnreset") || lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("network") || lower.includes("dns")) return structuredError("pal_network_error", message, true, "Check network connectivity and retry; if persistent, verify PAL/OpenRouter endpoint configuration.", details);
  if (lower.includes("malformed") || lower.includes("invalid json") || lower.includes("unexpected token") || lower.includes("parse") && lower.includes("response")) return structuredError("pal_malformed_response", message, true, "Retry once; if it persists, inspect PAL/provider raw artifacts and update the parser or provider configuration.", details);
  if (lower.includes("subprocess") || lower.includes("exit code") || lower.includes("spawn") || lower.includes("epipe")) return structuredError("pal_subprocess_failed", message, true, "Verify the PAL MCP command is installed and runnable, then retry or inspect pal-stderr.log.", details);
  if (lower.includes("only") && lower.includes("reviewers succeeded")) return structuredError("insufficient_successful_reviewers", message, true, "Inspect failed reviewers, fix provider/model issues, lower the success threshold intentionally, or rerun with a healthier stack.", details);
  if (lower.includes("invalid sidecar config") || lower.includes("invalid reviewer")) return structuredError("invalid_reviewer_config", message, false, "Fix the sidecar stack/reviewer configuration before retrying.", details);
  if (lower.includes("timed out") || lower.includes("timeout")) return structuredError("pal_timeout", message, true, "Retry later, use fewer reviewers, or raise PAL_SIDECAR_TOOL_WAIT_TIMEOUT_MS for long reviews.", details);
  return structuredError("unknown_error", message, true, "Inspect run artifacts and PAL stderr; retry once if the failure appears transient.", details);
}

export function providerFromModelId(id: string): string | undefined {
  const provider = id.includes("/") ? id.split("/")[0] : undefined;
  return provider || undefined;
}

export function normalizeModelInfo(value: unknown): PalModelInfo | undefined {
  if (typeof value === "string") return { id: value, provider: providerFromModelId(value) };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const idValue = record.id ?? record.model ?? record.name ?? record.slug;
  if (typeof idValue !== "string" || !idValue.trim()) return undefined;
  const aliases = Array.isArray(record.aliases) ? record.aliases.filter((alias): alias is string => typeof alias === "string" && Boolean(alias.trim())) : undefined;
  const provider = typeof record.provider === "string" ? record.provider : providerFromModelId(idValue);
  return { id: idValue.trim(), provider, aliases, raw: value };
}

export function collectModelInfos(raw: unknown): PalModelInfo[] {
  const byId = new Map<string, PalModelInfo>();
  const add = (model: PalModelInfo | undefined) => {
    if (!model) return;
    const existing = byId.get(model.id);
    if (!existing) byId.set(model.id, model);
    else if (!existing.aliases && model.aliases) existing.aliases = model.aliases;
  };
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(trimmed)) add(normalizeModelInfo(trimmed));
      for (const match of trimmed.matchAll(/\b[a-z0-9_.-]+\/[a-z0-9_.:-]+\b/gi)) add(normalizeModelInfo(match[0]));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const normalized = normalizeModelInfo(item);
        if (normalized) add(normalized);
        else visit(item, depth + 1);
      }
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const normalized = normalizeModelInfo(record);
      if (normalized) add(normalized);
      for (const key of ["models", "available_models", "data", "items", "result", "providers", "text", "content"]) visit(record[key], depth + 1);
      if (record.providers && typeof record.providers === "object" && !Array.isArray(record.providers)) {
        for (const providerValue of Object.values(record.providers as Record<string, unknown>)) visit(providerValue, depth + 1);
      }
    }
  };
  visit(raw);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function keywordHits(text: string, patterns: Array<[RegExp, string, number]>): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  for (const [pattern, signal, weight] of patterns) {
    if (pattern.test(text)) {
      score += weight;
      signals.push(signal);
    }
  }
  return { score, signals };
}

export function recommendStack(planText: string, config: ConfigLike): StackRecommendation {
  const text = planText.toLowerCase();
  const hasStack = (id: string) => Boolean(config.stacks[id]);
  const scores: Record<string, number> = {};
  for (const id of Object.keys(config.stacks)) scores[id] = 0;
  const signals: string[] = [];

  const budget = keywordHits(text, [
    [/\b(budget|cheap|cheaper|low[- ]cost|minimi[sz]e spend|cost[- ]sensitive)\b/, "explicit cost minimization", 4],
    [/\b(prototype|spike|mvp|quick demo|demo|smallest useful|low[- ]risk)\b/, "prototype or smallest-useful-scope language", 3],
    [/\b(token cap|spend cap|cost cap|avoid expensive|limit retries)\b/, "spend guard language", 2],
  ]);
  if (hasStack("budget")) scores["budget"] = budget.score;
  signals.push(...budget.signals);

  const open = keywordHits(text, [
    [/\b(open[- ]source model|open model|oss model|local model|provider diversity|non[- ]us provider)\b/, "provider/model diversity language", 4],
    [/\b(china model|qwen|deepseek|glm|kimi|moonshot|z[- ]ai)\b/, "China/open model ecosystem language", 4],
    [/\b(self[- ]hosted|local[- ]first model|offline model)\b/, "local/open model deployment language", 2],
  ]);
  if (hasStack("china-open")) scores["china-open"] = open.score;
  signals.push(...open.signals);

  const frontier = keywordHits(text, [
    [/\b(payment|billing|checkout|bank|financial|money movement)\b/, "payment or financial risk", 4],
    [/\b(auth|authentication|authorization|oauth|session|multi[- ]tenant)\b/, "identity or multi-tenant risk", 4],
    [/\b(pii|phi|personal data|customer data|secrets?|api keys?|credential)\b/, "sensitive data or secrets", 4],
    [/\b(compliance|regulated|soc2|hipaa|gdpr|audit|legal)\b/, "compliance or regulated domain", 4],
    [/\b(data loss|destructive|irreversible|rollback impossible|customer[- ]visible migration)\b/, "irreversible/data-loss risk", 4],
    [/\b(enterprise security|high[- ]stakes|critical production)\b/, "explicit high-stakes production language", 3],
  ]);
  if (hasStack("frontier-modern")) scores["frontier-modern"] = frontier.score;
  signals.push(...frontier.signals);

  const standardSignals = keywordHits(text, [
    [/\b(production|migration|security|privacy|rollout|release)\b/, "ordinary engineering quality signal", 1],
    [/\b(architecture|refactor|dashboard|api|workflow|integration)\b/, "general technical plan signal", 1],
  ]);
  if (hasStack("standard-modern")) scores["standard-modern"] = Math.max(2, standardSignals.score + 2);
  signals.push(...standardSignals.signals);

  let stackId = hasStack("standard-modern") ? "standard-modern" : (config.defaultStack || Object.keys(config.stacks)[0] || "standard-modern");
  if (hasStack("budget") && scores["budget"] >= 4) stackId = "budget";
  if (hasStack("china-open") && scores["china-open"] >= 4 && scores["china-open"] >= (scores[stackId] ?? 0)) stackId = "china-open";
  if (hasStack("frontier-modern") && scores["frontier-modern"] >= 4 && scores["frontier-modern"] > Math.max(scores["budget"] ?? 0, scores["china-open"] ?? 0)) stackId = "frontier-modern";

  const reasonByStack: Record<string, string> = {
    budget: "Plan explicitly emphasizes cost, budget, prototype, MVP, demo, or smallest-useful-scope concerns.",
    "china-open": "Plan explicitly asks for open/local/provider-diverse model ecosystem review.",
    "frontier-modern": "Plan contains strong high-stakes signals such as payments, auth, sensitive data, compliance, or irreversible customer-data risk.",
    "standard-modern": "Default balanced stack for ordinary technical plans; quality matters but frontier-level risk signals are not strong enough.",
  };
  return {
    stackId,
    reason: reasonByStack[stackId] || `Fallback to configured stack '${stackId}'.`,
    scores,
    signals: Array.from(new Set(signals)),
  };
}

export function stackAvailability(config: ConfigLike, models: PalModelInfo[], runtimeHealth: Record<string, ModelRuntimeHealth> = {}): Record<string, StackAvailability> {
  const availableIds = new Set<string>();
  for (const model of models) {
    availableIds.add(model.id);
    for (const alias of model.aliases ?? []) availableIds.add(alias);
  }
  const known = models.length > 0;
  const stacks: Record<string, StackAvailability> = {};
  for (const [stackId, stack] of Object.entries(config.stacks)) {
    const reviewers = stack.reviewers.map((reviewer) => {
      const availability: "available" | "unavailable" | "unknown" = known ? (availableIds.has(reviewer.model) ? "available" : "unavailable") : "unknown";
      return { id: reviewer.id, label: reviewer.label, model: reviewer.model, availability, runtimeHealth: runtimeHealth[reviewer.model] };
    });
    stacks[stackId] = {
      available: reviewers.filter((reviewer) => reviewer.availability === "available").length,
      unavailable: reviewers.filter((reviewer) => reviewer.availability === "unavailable").length,
      unknown: reviewers.filter((reviewer) => reviewer.availability === "unknown").length,
      runtimeUnhealthy: reviewers.filter((reviewer) => reviewer.runtimeHealth?.status === "unhealthy").length,
      runtimeDegraded: reviewers.filter((reviewer) => reviewer.runtimeHealth?.status === "degraded").length,
      reviewers,
    };
  }
  return stacks;
}
