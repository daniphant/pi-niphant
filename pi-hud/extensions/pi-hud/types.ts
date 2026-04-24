import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ThemeLike = {
  fg: (color: string, text: string) => string;
};

export type SessionTotals = {
  input: number;
  output: number;
  cost: number;
};

export type CodexQuotaSnapshot = {
  kind: "codex";
  plan: string | null;
  sessionUsedPercent: number | null;
  sessionResetAt: number | null;
  weeklyUsedPercent: number | null;
  weeklyResetAt: number | null;
};

export type ZaiQuotaWindow = {
  label: string;
  usedPercent: number | null;
  resetAt: number | null;
};

export type ZaiQuotaSnapshot = {
  kind: "zai";
  plan: string | null;
  primary: ZaiQuotaWindow | null;
  secondary: ZaiQuotaWindow | null;
};

export type ProviderKey = "codex" | "zai";
export type ProviderQuotaSnapshot = CodexQuotaSnapshot | ZaiQuotaSnapshot | null;

export type GitFileStats = {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
};

export type GitStatus = {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  fileStats: GitFileStats | null;
};

export type CachedQuotaEntry = {
  providerKey: ProviderKey;
  fetchedAt: number;
  snapshot: Exclude<ProviderQuotaSnapshot, null>;
};

export type HudSettings = {
  enabled: boolean;
  showWeeklyLimits: boolean;
  quotaCache?: Partial<Record<ProviderKey, CachedQuotaEntry>>;
};

export type CodexUsageResponse = {
  plan_type?: string;
  rate_limit?: {
    primary_window?: { used_percent?: number; reset_at?: number };
    secondary_window?: { used_percent?: number; reset_at?: number };
  };
};

export type ZaiQuotaResponse = {
  code?: number;
  success?: boolean;
  msg?: string;
  data?: {
    planName?: string;
    plan?: string;
    plan_type?: string;
    packageName?: string;
    limits?: Array<{
      type?: string;
      unit?: number;
      number?: number;
      usage?: number;
      currentValue?: number;
      remaining?: number;
      percentage?: number;
      nextResetTime?: number;
    }>;
  };
};

export type PiAssistantMessage = AssistantMessage;
export type PiExtensionContext = ExtensionContext;
