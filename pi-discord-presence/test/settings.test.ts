import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, getSettingsPath, loadSettings, parseSettings, saveSettings } from "../extensions/pi-discord-presence/settings.js";

describe("settings", () => {
  it("parses defaults defensively", () => {
    expect(parseSettings("{}")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ enabled: false, showProject: true, showModel: true, firstRunNoticeShown: true, clientId: " 123 " }))).toEqual({
      enabled: false,
      showProject: true,
      showModel: true,
      firstRunNoticeShown: true,
      clientId: "123",
    });
  });

  it("loads defaults on missing or invalid files", async () => {
    expect(await loadSettings(path.join(os.tmpdir(), "missing-pi-discord-settings.json"))).toEqual(DEFAULT_SETTINGS);
  });

  it("saves settings as JSON under the expected path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-discord-presence-"));
    const file = getSettingsPath(dir);
    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false }, file);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ enabled: false });
  });
});
