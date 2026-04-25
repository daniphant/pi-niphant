export interface StructuredError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export interface PalModelInfo {
  id: string;
  provider?: string;
  aliases?: string[];
  raw?: unknown;
}

export interface StackAvailability {
  available: number;
  unknown: number;
  unavailable: number;
  reviewers: Array<{
    id: string;
    label: string;
    model: string;
    availability: "available" | "unavailable" | "unknown";
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

export type ArtifactKind = "findings" | "reviewer_markdown" | "reviewer_json" | "log" | "text" | "unknown";

export const SIDECAR_VERSION = "0.1.0";
export const FINDINGS_SCHEMA_VERSION = "2026-04-25.1";
export const FINDINGS_PARSER_VERSION = "deterministic-markdown-v1";
export const REVIEW_PROMPT_VERSION = "plan-review-v1";

export function artifactKind(name: string): ArtifactKind {
  if (name === "findings.json") return "findings";
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

export function classifyError(error: unknown, details?: unknown): StructuredError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("plan file not found")) return { code: "plan_file_not_found", message, retryable: false, details };
  if (lower.includes("plan file is too large") || lower.includes("plan text is too large")) return { code: "plan_file_too_large", message, retryable: false, details };
  if (lower.includes("concurrent run limit")) return { code: "concurrency_limit_exceeded", message, retryable: true, details };
  if (lower.includes("trusted root") || lower.includes("allowed roots")) return { code: "plan_file_untrusted_root", message, retryable: false, details };
  if (lower.includes("provider key") || lower.includes("api_key")) return { code: "pal_provider_key_missing", message, retryable: false, details };
  if (lower.includes("did not expose") && lower.includes("tool")) return { code: "pal_contract_mismatch", message, retryable: false, details };
  if (lower.includes("timed out") || lower.includes("timeout")) return { code: "pal_timeout", message, retryable: true, details };
  if (lower.includes("cancelled")) return { code: "run_cancelled", message, retryable: true, details };
  if (lower.includes("duplicate") && lower.includes("model+stance")) return { code: "invalid_reviewer_config", message, retryable: false, details };
  if (lower.includes("not reported by pal listmodels")) return { code: "model_unavailable", message, retryable: false, details };
  if (lower.includes("only") && lower.includes("reviewers succeeded")) return { code: "insufficient_successful_reviewers", message, retryable: true, details };
  return { code: "unknown_error", message, retryable: true, details };
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

export function stackAvailability(config: ConfigLike, models: PalModelInfo[]): Record<string, StackAvailability> {
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
      return { id: reviewer.id, label: reviewer.label, model: reviewer.model, availability };
    });
    stacks[stackId] = {
      available: reviewers.filter((reviewer) => reviewer.availability === "available").length,
      unavailable: reviewers.filter((reviewer) => reviewer.availability === "unavailable").length,
      unknown: reviewers.filter((reviewer) => reviewer.availability === "unknown").length,
      reviewers,
    };
  }
  return stacks;
}
