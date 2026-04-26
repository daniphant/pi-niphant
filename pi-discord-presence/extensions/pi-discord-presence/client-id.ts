import { CLIENT_ID_ENV, DEFAULT_CLIENT_ID, PLACEHOLDER_DEFAULT_CLIENT_ID } from "./constants.js";
import type { ClientIdResolution, DiscordPresenceSettings } from "./types.js";

const SNOWFLAKE_RE = /^[1-9]\d{16,20}$/;

export function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && SNOWFLAKE_RE.test(value.trim());
}

export function redactedClientId(value: string | null | undefined): string {
  if (!value) return "missing";
  const trimmed = value.trim();
  if (trimmed.length < 8) return "configured-redacted";
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-3)}`;
}

export function resolveClientId(settings: Pick<DiscordPresenceSettings, "clientId">, env = process.env): ClientIdResolution {
  const envValue = env[CLIENT_ID_ENV];
  if (isValidClientId(envValue)) return { clientId: envValue.trim(), source: "env", configured: true };

  if (isValidClientId(settings.clientId)) return { clientId: settings.clientId.trim(), source: "settings", configured: true };

  if (DEFAULT_CLIENT_ID !== PLACEHOLDER_DEFAULT_CLIENT_ID && isValidClientId(DEFAULT_CLIENT_ID)) {
    return { clientId: DEFAULT_CLIENT_ID, source: "default", configured: true };
  }

  return { clientId: null, source: "missing", configured: false };
}
