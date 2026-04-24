import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { CachedQuotaEntry, HudSettings, ProviderKey } from "./types.js";

export const getSettingsPath = (home = os.homedir()) => path.join(home, ".pi", "agent", "extensions", "pi-hud.json");

const sanitizeCacheEntry = (providerKey: ProviderKey, value: unknown): CachedQuotaEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CachedQuotaEntry>;
  if (candidate.providerKey !== providerKey) return null;
  if (typeof candidate.fetchedAt !== "number") return null;
  if (!candidate.snapshot || typeof candidate.snapshot !== "object") return null;

  const snapshot = candidate.snapshot as { kind?: unknown };
  if (snapshot.kind !== providerKey) return null;

  return candidate as CachedQuotaEntry;
};

export const parseSettings = (raw: string): HudSettings => {
  const defaults: HudSettings = { enabled: true, showWeeklyLimits: false, quotaCache: {} };
  const parsed = JSON.parse(raw) as Partial<HudSettings>;
  const quotaCache: Partial<Record<ProviderKey, CachedQuotaEntry>> = {};

  const codex = sanitizeCacheEntry("codex", parsed.quotaCache?.codex);
  if (codex) quotaCache.codex = codex;
  const zai = sanitizeCacheEntry("zai", parsed.quotaCache?.zai);
  if (zai) quotaCache.zai = zai;

  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaults.enabled,
    showWeeklyLimits: typeof parsed.showWeeklyLimits === "boolean" ? parsed.showWeeklyLimits : defaults.showWeeklyLimits,
    quotaCache,
  };
};

export const loadSettings = async (settingsPath = getSettingsPath()): Promise<HudSettings> => {
  try {
    const raw = await readFile(settingsPath, "utf8");
    return parseSettings(raw);
  } catch {
    return { enabled: true, showWeeklyLimits: false, quotaCache: {} };
  }
};

export const saveSettings = async (
  settings: Pick<HudSettings, "enabled" | "showWeeklyLimits" | "quotaCache">,
  settingsPath = getSettingsPath(),
) => {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
};
