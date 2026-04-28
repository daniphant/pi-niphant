import os from "node:os";
import path from "node:path";

import { DEFAULT_METER_WIDTH } from "./constants.js";

export const clampPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
};

export const formatCompactNumber = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
};

export const formatContextWindow = (tokens?: number) => {
  if (!tokens || !Number.isFinite(tokens)) return "?";
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return Number.isInteger(value) ? `${value}M` : `${value.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${tokens}`;
};

export const getProjectLabel = (cwd: string, home = os.homedir()) => {
  const normalizedCwd = cwd || ".";
  return normalizedCwd === home
    ? "~"
    : normalizedCwd.startsWith(`${home}${path.sep}`)
      ? `~${path.sep}${path.relative(home, normalizedCwd)}`
      : normalizedCwd;
};

// Shortens the project path so it fits on narrower terminals:
//   wide (≥100 cols)  → full relative label (e.g. ~/Projects/pi-niphant)
//   medium (≥60 cols) → last two segments (e.g. Projects/pi-niphant)
//   narrow (<60 cols) → basename only (e.g. pi-niphant)
// The home marker "~" is dropped once we start trimming, since the path is no longer
// rooted at home from the user's perspective.
export const getAdaptiveProjectLabel = (cwd: string, terminalWidth: number, home = os.homedir()) => {
  const fullLabel = getProjectLabel(cwd, home);
  if (!Number.isFinite(terminalWidth) || terminalWidth <= 0 || terminalWidth >= 100) return fullLabel;
  if (fullLabel === "~") return "~";

  const segments = fullLabel.split(path.sep).filter((segment) => segment.length > 0 && segment !== "~");
  if (segments.length === 0) return fullLabel;

  const keep = terminalWidth >= 60 ? 2 : 1;
  return segments.slice(-keep).join(path.sep);
};

// Scales progress-bar width to the terminal so the HUD stays legible on narrow screens.
// Tiers are finer-grained than claude-hud's original three so shrinkage is visible at every
// common terminal width instead of only kicking in once you drop below 100 or 60 columns.
export const getAdaptiveMeterWidth = (terminalWidth: number) => {
  if (!Number.isFinite(terminalWidth) || terminalWidth <= 0) return DEFAULT_METER_WIDTH;
  if (terminalWidth >= 140) return 12;
  if (terminalWidth >= 110) return 10;
  if (terminalWidth >= 85) return 8;
  if (terminalWidth >= 65) return 6;
  if (terminalWidth >= 45) return 4;
  return 3;
};

// Returns a short or long label depending on the terminal width — used to abbreviate
// "Context"/"Usage" to "Ctx"/"Use" on narrower screens so the whole block shrinks along
// with the bar, not just the bar in isolation.
export const getAdaptiveLabel = (long: string, short: string, terminalWidth: number) => {
  if (!Number.isFinite(terminalWidth) || terminalWidth <= 0) return long;
  return terminalWidth >= 85 ? long : short;
};

export const formatSessionDuration = (durationMs: number) => {
  if (!Number.isFinite(durationMs) || durationMs < 60_000) return "< 1m";
  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
};

export const formatResetCountdown = (epochMs: number | null, nowMs = Date.now()) => {
  if (!epochMs) return null;
  const diffMs = epochMs - nowMs;
  if (diffMs <= 0) return "now";
  const totalMinutes = Math.ceil(diffMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
};

export const normalizeZaiLimitLabel = (minutes: number | null, fallback: string) => {
  if (!minutes || !Number.isFinite(minutes)) return fallback;
  if (minutes === 300) return "5h";
  if (minutes === 60) return "1h";
  if (minutes === 24 * 60) return "1d";
  if (minutes === 7 * 24 * 60) return "7d";
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return fallback;
};

export const normalizeResetAt = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value > 10_000_000_000 ? value : value * 1000;
};
