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
}

export const SIDECAR_VERSION = "0.1.0";
export const FINDINGS_SCHEMA_VERSION = "2026-04-25.1";
export const FINDINGS_PARSER_VERSION = "deterministic-markdown-v1";
export const REVIEW_PROMPT_VERSION = "plan-review-v1";

export function classifyError(error: unknown, details?: unknown): StructuredError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("plan file not found")) return { code: "plan_file_not_found", message, retryable: false, details };
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
