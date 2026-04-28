import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadSettings, parseSettings, saveSettings } from "../extensions/pi-hud/settings.js";

describe("settings", () => {
  it("parses valid settings", () => {
    const parsed = parseSettings(JSON.stringify({
      enabled: false,
      showWeeklyLimits: true,
      quotaCache: {
        codex: {
          providerKey: "codex",
          fetchedAt: 123,
          snapshot: { kind: "codex", plan: null, sessionUsedPercent: 1, sessionResetAt: null, weeklyUsedPercent: null, weeklyResetAt: null },
        },
      },
    }));

    expect(parsed.enabled).toBe(false);
    expect(parsed.showWeeklyLimits).toBe(true);
    expect(parsed.quotaCache?.codex?.providerKey).toBe("codex");
  });

  it("drops invalid cache entries with mismatched snapshot kinds", () => {
    const parsed = parseSettings(JSON.stringify({
      quotaCache: {
        codex: {
          providerKey: "codex",
          fetchedAt: 123,
          snapshot: { kind: "zai" },
        },
      },
    }));

    expect(parsed.quotaCache?.codex).toBeUndefined();
  });

  it("falls back for missing settings", async () => {
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), "pi-hud-")), "settings.json");
    const settings = await loadSettings(file);
    expect(settings).toEqual({ enabled: true, showWeeklyLimits: false, quotaCache: {} });
  });

  it("writes settings to disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-hud-"));
    const file = path.join(dir, "settings.json");
    await saveSettings({ enabled: true, showWeeklyLimits: true, quotaCache: {} }, file);
    const raw = await readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ enabled: true, showWeeklyLimits: true, quotaCache: {} });
  });
});
