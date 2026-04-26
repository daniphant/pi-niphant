import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { CLIENT_ID_ENV, DEFAULT_CLIENT_ID, EXTENSION_NAME, PLACEHOLDER_DEFAULT_CLIENT_ID } from "./constants.js";
import type { ClientIdResolution, DiscordPresenceSettings } from "./types.js";

const SNOWFLAKE_RE = /^[1-9]\d{16,20}$/;
const PACKAGE_ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
const USER_ENV_PATH = path.join(os.homedir(), ".pi", "agent", "extensions", EXTENSION_NAME, ".env");

export function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && SNOWFLAKE_RE.test(value.trim());
}

export function redactedClientId(value: string | null | undefined): string {
  if (!value) return "missing";
  const trimmed = value.trim();
  if (trimmed.length < 8) return "configured-redacted";
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-3)}`;
}

export function parseEnvValue(raw: string, key = CLIENT_ID_ENV): string | undefined {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || match[1] !== key) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  return undefined;
}

export function readEnvFileClientId(envFiles = [USER_ENV_PATH, PACKAGE_ENV_PATH]): string | undefined {
  for (const envFile of envFiles) {
    try {
      const value = parseEnvValue(readFileSync(envFile, "utf8"));
      if (isValidClientId(value)) return value.trim();
    } catch {
      // Missing or unreadable .env files are non-fatal.
    }
  }
  return undefined;
}

export function resolveClientId(
  settings: Pick<DiscordPresenceSettings, "clientId">,
  env = process.env,
  envFiles?: string[],
): ClientIdResolution {
  const envValue = env[CLIENT_ID_ENV];
  if (isValidClientId(envValue)) return { clientId: envValue.trim(), source: "env", configured: true };

  const envFileValue = readEnvFileClientId(envFiles);
  if (isValidClientId(envFileValue)) return { clientId: envFileValue.trim(), source: "env-file", configured: true };

  if (isValidClientId(settings.clientId)) return { clientId: settings.clientId.trim(), source: "settings", configured: true };

  if (DEFAULT_CLIENT_ID !== PLACEHOLDER_DEFAULT_CLIENT_ID && isValidClientId(DEFAULT_CLIENT_ID)) {
    return { clientId: DEFAULT_CLIENT_ID, source: "default", configured: true };
  }

  return { clientId: null, source: "missing", configured: false };
}
