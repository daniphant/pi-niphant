import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { clampPercent } from "../format.js";
import type { CodexQuotaSnapshot, CodexUsageResponse } from "../types.js";

export const parseCodexQuota = (data: CodexUsageResponse): CodexQuotaSnapshot => ({
  kind: "codex",
  plan: data.plan_type ?? null,
  sessionUsedPercent: clampPercent(data.rate_limit?.primary_window?.used_percent),
  sessionResetAt: data.rate_limit?.primary_window?.reset_at ? data.rate_limit.primary_window.reset_at * 1000 : null,
  weeklyUsedPercent: clampPercent(data.rate_limit?.secondary_window?.used_percent),
  weeklyResetAt: data.rate_limit?.secondary_window?.reset_at ? data.rate_limit.secondary_window.reset_at * 1000 : null,
});

export const readCodexAuth = async (home = os.homedir()) => {
  const authPath = path.join(home, ".codex", "auth.json");
  const raw = await readFile(authPath, "utf8");
  const parsed = JSON.parse(raw) as {
    tokens?: {
      access_token?: string;
      account_id?: string;
    };
  };
  const accessToken = parsed.tokens?.access_token;
  const accountId = parsed.tokens?.account_id;
  if (!accessToken) throw new Error("Missing Codex access token in ~/.codex/auth.json");
  return { accessToken, accountId };
};

export const fetchCodexQuota = async (): Promise<CodexQuotaSnapshot> => {
  const { accessToken, accountId } = await readCodexAuth();
  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "codex-cli",
      ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
    },
  });

  if (!response.ok) throw new Error(`Codex usage HTTP ${response.status}`);
  return parseCodexQuota((await response.json()) as CodexUsageResponse);
};
