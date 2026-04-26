import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE_ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
const USER_ENV_PATH = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-web-tools", ".env");

export const DEFAULT_ENV_FILES = [USER_ENV_PATH, PACKAGE_ENV_PATH];

export function parseEnvValue(raw: string, key: string): string | undefined {
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

export function getEnvFileValue(key: string, envFiles = DEFAULT_ENV_FILES): string | undefined {
  if (process.env.PI_WEB_TOOLS_DISABLE_ENV_FILE === "1") return undefined;
  for (const envFile of envFiles) {
    try {
      const value = parseEnvValue(readFileSync(envFile, "utf8"), key);
      if (value) return value;
    } catch {
      // Missing/unreadable env files are non-fatal.
    }
  }
  return undefined;
}

export function getEnvValue(key: string, env = process.env, envFiles = DEFAULT_ENV_FILES): string | undefined {
  const direct = env[key];
  if (direct && direct.trim()) return direct.trim();
  return getEnvFileValue(key, envFiles);
}

export function getKnownSecretValues(): string[] {
  const values = [process.env.BRAVE_SEARCH_API_KEY, getEnvFileValue("BRAVE_SEARCH_API_KEY")]
    .filter((value): value is string => typeof value === "string" && value.length >= 6);
  return [...new Set(values)];
}
