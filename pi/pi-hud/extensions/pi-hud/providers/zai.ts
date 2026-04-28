import { clampPercent, normalizeResetAt, normalizeZaiLimitLabel } from "../format.js";
import type { PiExtensionContext, ZaiQuotaResponse, ZaiQuotaSnapshot } from "../types.js";

const ZAI_UNIT_DAYS = 1;
const ZAI_UNIT_HOURS = 3;
const ZAI_UNIT_MINUTES = 5;
const ZAI_UNIT_WEEKS = 6;

export const computeZaiUsedPercent = (limit: {
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
}) => {
  const hardLimit = typeof limit.usage === "number" ? limit.usage : null;
  const currentValue = typeof limit.currentValue === "number" ? limit.currentValue : null;
  const remaining = typeof limit.remaining === "number" ? limit.remaining : null;

  if (hardLimit && hardLimit > 0) {
    let usedRaw: number | null = null;
    if (remaining !== null) {
      const usedFromRemaining = hardLimit - remaining;
      usedRaw = currentValue !== null ? Math.max(usedFromRemaining, currentValue) : usedFromRemaining;
    } else if (currentValue !== null) {
      usedRaw = currentValue;
    }
    if (usedRaw !== null) {
      return clampPercent((Math.max(0, Math.min(hardLimit, usedRaw)) / hardLimit) * 100);
    }
  }

  return clampPercent(typeof limit.percentage === "number" ? limit.percentage : null);
};

export const parseZaiQuota = (payload: ZaiQuotaResponse): ZaiQuotaSnapshot => {
  if (!payload.success || payload.code !== 200 || !payload.data) {
    throw new Error(payload.msg || "Invalid z.ai quota response");
  }

  const limits = payload.data.limits ?? [];
  const tokenLimits = limits
    .filter((limit) => limit.type === "TOKENS_LIMIT")
    .map((limit) => {
      const unit = limit.unit ?? 0;
      const number = limit.number ?? 0;
      const minutes = unit === ZAI_UNIT_MINUTES
        ? number
        : unit === ZAI_UNIT_HOURS
          ? number * 60
          : unit === ZAI_UNIT_DAYS
            ? number * 24 * 60
            : unit === ZAI_UNIT_WEEKS
              ? number * 7 * 24 * 60
              : null;
      return {
        label: normalizeZaiLimitLabel(minutes, "quota"),
        minutes,
        usedPercent: computeZaiUsedPercent(limit),
        resetAt: normalizeResetAt(limit.nextResetTime),
      };
    })
    .sort((a, b) => (a.minutes ?? Number.MAX_SAFE_INTEGER) - (b.minutes ?? Number.MAX_SAFE_INTEGER));

  const timeLimitRaw = limits.find((limit) => limit.type === "TIME_LIMIT");
  const timeLimit = timeLimitRaw
    ? {
        label: "time",
        usedPercent: computeZaiUsedPercent(timeLimitRaw),
        resetAt: normalizeResetAt(timeLimitRaw.nextResetTime),
      }
    : null;

  const primaryToken = tokenLimits.length > 0 ? tokenLimits[tokenLimits.length - 1]! : null;
  const sessionToken = tokenLimits.length > 1 ? tokenLimits[0]! : null;
  const primary = sessionToken
    ? { label: sessionToken.label, usedPercent: sessionToken.usedPercent, resetAt: sessionToken.resetAt }
    : primaryToken
      ? { label: primaryToken.label, usedPercent: primaryToken.usedPercent, resetAt: primaryToken.resetAt }
      : null;

  const secondary = sessionToken && primaryToken && sessionToken !== primaryToken
    ? { label: primaryToken.label, usedPercent: primaryToken.usedPercent, resetAt: primaryToken.resetAt }
    : timeLimit;

  const plan = payload.data.planName || payload.data.plan || payload.data.plan_type || payload.data.packageName || null;

  return {
    kind: "zai",
    plan,
    primary,
    secondary,
  };
};

export const fetchZaiQuota = async (ctx: PiExtensionContext): Promise<ZaiQuotaSnapshot> => {
  if (!ctx.model) throw new Error("No active model");
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) throw new Error(auth.ok ? "Missing z.ai API key" : (auth.error ?? "z.ai auth failed"));

  const quotaUrl = process.env.Z_AI_QUOTA_URL
    || (process.env.Z_AI_API_HOST
      ? `${process.env.Z_AI_API_HOST.replace(/\/$/, "")}/api/monitor/usage/quota/limit`
      : "https://api.z.ai/api/monitor/usage/quota/limit");

  const response = await fetch(quotaUrl, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${auth.apiKey}`,
      accept: "application/json",
    },
  });

  if (!response.ok) throw new Error(`z.ai quota HTTP ${response.status}`);
  return parseZaiQuota((await response.json()) as ZaiQuotaResponse);
};
