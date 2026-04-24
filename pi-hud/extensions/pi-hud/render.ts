import { DEFAULT_METER_WIDTH } from "./constants.js";
import { clampPercent, formatResetCountdown, getAdaptiveLabel } from "./format.js";
import type { GitStatus, ProviderQuotaSnapshot, ThemeLike } from "./types.js";

export const getMeterColor = (remainingPercent: number | null) => {
  const value = remainingPercent ?? 0;
  if (value <= 15) return "error";
  if (value <= 35) return "warning";
  return "success";
};

export const buildBar = (
  theme: ThemeLike,
  percent: number | null | undefined,
  width = DEFAULT_METER_WIDTH,
  options?: { invert?: boolean; color?: string },
) => {
  const clamped = clampPercent(percent);
  const safePercent = clamped ?? 0;
  const displayed = options?.invert ? 100 - safePercent : safePercent;
  const filled = Math.round((displayed / 100) * width);
  const empty = Math.max(0, width - filled);
  const text = `${"█".repeat(filled)}${"░".repeat(empty)}`;
  // getMeterColor is designed for the inverted/"remaining" semantic (low = bad = red).
  // When the caller didn't pick a color and percent is unknown, default to muted so an
  // empty bar doesn't flash red — it would otherwise look identical to a full quota.
  const fallbackColor = clamped === null ? "muted" : getMeterColor(displayed);
  return theme.fg(options?.color || fallbackColor, text);
};

export type GitRenderOptions = {
  showAheadBehind?: boolean;
  showFileStats?: boolean;
};

// Renders the git status the way claude-hud does: colored `git:(branch…)` with optional
// dirty marker, ahead/behind counts, and file-stat indicators. Each indicator uses a
// distinct semantic color so the segment stays scannable at a glance.
//   branch        → accent
//   * (dirty)     → warning
//   ↑N / +N       → success (ahead / added)
//   ↓N / ✘N       → error (behind / deleted)
//   !N            → warning (modified)
//   ?N            → muted (untracked)
// Parens and the `git:` prefix use customMessageLabel so the wrapper visually frames the
// whole segment. Returns null when there's no branch info to show.
export const formatGitBranch = (
  theme: ThemeLike,
  status: GitStatus | null | undefined,
  options: GitRenderOptions = {},
) => {
  if (!status) return null;
  const { showAheadBehind = true, showFileStats = true } = options;
  const parens = (segment: string) => theme.fg("customMessageLabel", segment);

  const inner: string[] = [theme.fg("accent", status.branch)];
  if (status.isDirty) inner.push(theme.fg("warning", "*"));

  if (showAheadBehind) {
    if (status.ahead > 0) inner.push(` ${theme.fg("success", `↑${status.ahead}`)}`);
    if (status.behind > 0) inner.push(` ${theme.fg("error", `↓${status.behind}`)}`);
  }

  if (showFileStats && status.fileStats) {
    const { modified, added, deleted, untracked } = status.fileStats;
    const statParts: string[] = [];
    if (modified > 0) statParts.push(theme.fg("warning", `!${modified}`));
    if (added > 0) statParts.push(theme.fg("success", `+${added}`));
    if (deleted > 0) statParts.push(theme.fg("error", `✘${deleted}`));
    if (untracked > 0) statParts.push(theme.fg("muted", `?${untracked}`));
    if (statParts.length > 0) inner.push(` ${statParts.join(" ")}`);
  }

  return `${parens("git:(")}${inner.join("")}${parens(")")}`;
};

export const renderQuotaWindow = (
  theme: ThemeLike,
  usedPercent: number | null,
  resetAt: number | null,
  width = DEFAULT_METER_WIDTH,
  terminalWidth?: number,
) => {
  const used = clampPercent(usedPercent);
  const bar = buildBar(theme, used, width, { color: "accent" });
  const percentText = used === null ? theme.fg("muted", "--%") : theme.fg("accent", `${Math.round(used)}%`);
  const reset = formatResetCountdown(resetAt);
  // Drop the verbose "(resets in …)" wrapper on narrow terminals — the bare countdown keeps
  // the block short enough to show both bars side-by-side.
  const showVerboseReset = terminalWidth === undefined || terminalWidth >= 85;
  const resetText = reset
    ? theme.fg("dim", showVerboseReset ? `(resets in ${reset})` : `(${reset})`)
    : theme.fg("dim", showVerboseReset ? "(reset unknown)" : "(—)");
  return `${bar} ${percentText} ${resetText}`;
};

export const renderQuotaBlock = (
  theme: ThemeLike,
  snapshot: ProviderQuotaSnapshot,
  showWeeklyLimits: boolean,
  quotaError: string | null,
  quotaProviderKey: string | null,
  width = DEFAULT_METER_WIDTH,
  terminalWidth?: number,
) => {
  const usageLabel = terminalWidth !== undefined ? getAdaptiveLabel("Usage", "Use", terminalWidth) : "Usage";

  if (snapshot?.kind === "codex") {
    const usage = `${theme.fg("muted", usageLabel)} ${renderQuotaWindow(theme, snapshot.sessionUsedPercent, snapshot.sessionResetAt, width, terminalWidth)}`;
    const weekly = showWeeklyLimits && snapshot.weeklyUsedPercent !== null
      ? renderQuotaWindow(theme, snapshot.weeklyUsedPercent, snapshot.weeklyResetAt, width, terminalWidth)
      : null;
    return weekly ? `${usage}${theme.fg("dim", " | ")}${weekly}` : usage;
  }

  if (snapshot?.kind === "zai") {
    const usage = snapshot.primary
      ? `${theme.fg("muted", usageLabel)} ${renderQuotaWindow(theme, snapshot.primary.usedPercent, snapshot.primary.resetAt, width, terminalWidth)}`
      : null;
    const weekly = showWeeklyLimits && snapshot.secondary
      ? renderQuotaWindow(theme, snapshot.secondary.usedPercent, snapshot.secondary.resetAt, width, terminalWidth)
      : null;
    if (!usage && !weekly) return null;
    return [usage, weekly].filter(Boolean).join(theme.fg("dim", " | "));
  }

  if (quotaError && quotaProviderKey) return theme.fg("warning", "Usage unavailable");
  return null;
};
