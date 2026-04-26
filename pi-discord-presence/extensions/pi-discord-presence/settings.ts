import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { SETTINGS_FILE_NAME } from "./constants.js";
import type { DiscordPresenceSettings } from "./types.js";

export const DEFAULT_SETTINGS: DiscordPresenceSettings = {
  enabled: true,
  showProject: false,
  showModel: false,
  firstRunNoticeShown: false,
};

export const getSettingsPath = (home = os.homedir()) => path.join(home, ".pi", "agent", "extensions", SETTINGS_FILE_NAME);

export function parseSettings(raw: string): DiscordPresenceSettings {
  const parsed = JSON.parse(raw) as Partial<DiscordPresenceSettings>;
  const clientId = typeof parsed.clientId === "string" && parsed.clientId.trim() ? parsed.clientId.trim() : undefined;
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
    showProject: typeof parsed.showProject === "boolean" ? parsed.showProject : DEFAULT_SETTINGS.showProject,
    showModel: typeof parsed.showModel === "boolean" ? parsed.showModel : DEFAULT_SETTINGS.showModel,
    firstRunNoticeShown: typeof parsed.firstRunNoticeShown === "boolean" ? parsed.firstRunNoticeShown : DEFAULT_SETTINGS.firstRunNoticeShown,
    ...(clientId ? { clientId } : {}),
  };
}

export async function loadSettings(settingsPath = getSettingsPath()): Promise<DiscordPresenceSettings> {
  try {
    return parseSettings(await readFile(settingsPath, "utf8"));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: DiscordPresenceSettings, settingsPath = getSettingsPath()): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
