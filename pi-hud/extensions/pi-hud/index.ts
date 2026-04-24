import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { QUOTA_TTL_MS } from "./constants.js";
import { formatCompactNumber, getAdaptiveLabel, getAdaptiveMeterWidth, getAdaptiveProjectLabel, clampPercent } from "./format.js";
import { getGitStatus } from "./git.js";
import { getModelLabel } from "./model.js";
import { fetchCodexQuota } from "./providers/codex.js";
import { detectQuotaProvider } from "./providers/detect.js";
import { fetchZaiQuota } from "./providers/zai.js";
import { formatGitBranch, renderQuotaBlock, buildBar } from "./render.js";
import { getSessionTotals } from "./session.js";
import { loadSettings, saveSettings } from "./settings.js";
import type { CachedQuotaEntry, GitStatus, HudSettings, PiExtensionContext, ProviderKey, ProviderQuotaSnapshot, ThemeLike } from "./types.js";

const GIT_STATUS_TTL_MS = 5_000;

export default function piHudExtension(pi: ExtensionAPI) {
  let enabled = true;
  let showWeeklyLimits = false;
  let latestCtx: PiExtensionContext | null = null;
  let requestRender: (() => void) | null = null;
  let quotaSnapshot: ProviderQuotaSnapshot = null;
  let quotaError: string | null = null;
  let quotaProviderKey: ProviderKey | null = null;
  let lastQuotaFetchAt = 0;
  let quotaCache: Partial<Record<ProviderKey, CachedQuotaEntry>> = {};
  let quotaFetchPromise: Promise<void> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let gitStatus: GitStatus | null = null;
  let gitStatusCwd: string | null = null;
  let lastGitFetchAt = 0;
  let gitFetchPromise: Promise<void> | null = null;

  const triggerRender = () => requestRender?.();

  const applyLoadedSettings = (settings: HudSettings) => {
    enabled = settings.enabled;
    showWeeklyLimits = settings.showWeeklyLimits;
    quotaCache = settings.quotaCache ?? {};
  };

  const persistSettings = async () => {
    try {
      await saveSettings({ enabled, showWeeklyLimits, quotaCache });
    } catch {
      // Non-fatal.
    }
  };

  const getActiveCtx = () => latestCtx;

  const refreshQuota = async (ctx: ExtensionContext, force = false) => {
    latestCtx = ctx;
    const provider = detectQuotaProvider(ctx.model);

    if (!provider) {
      quotaProviderKey = null;
      quotaSnapshot = null;
      quotaError = null;
      lastQuotaFetchAt = 0;
      triggerRender();
      return;
    }

    if (quotaProviderKey !== provider) {
      quotaProviderKey = provider;
      quotaError = null;
      lastQuotaFetchAt = 0;
      const cached = quotaCache[provider];
      if (cached?.snapshot) {
        quotaSnapshot = cached.snapshot;
        lastQuotaFetchAt = cached.fetchedAt;
      }
      triggerRender();
    }

    const cached = quotaCache[provider];
    if (!quotaSnapshot && cached?.snapshot) {
      quotaSnapshot = cached.snapshot;
      lastQuotaFetchAt = cached.fetchedAt;
      triggerRender();
    }

    const snapshotNeedsRepair = provider === "zai"
      && quotaSnapshot?.kind === "zai"
      && !!quotaSnapshot.primary
      && !quotaSnapshot.primary.resetAt;

    if (!force && !snapshotNeedsRepair && Date.now() - lastQuotaFetchAt < QUOTA_TTL_MS) return;
    if (quotaFetchPromise) return quotaFetchPromise;

    quotaFetchPromise = (async () => {
      try {
        const snapshot = provider === "codex" ? await fetchCodexQuota() : await fetchZaiQuota(ctx);
        quotaSnapshot = snapshot;
        quotaError = null;
        lastQuotaFetchAt = Date.now();
        quotaCache[provider] = { providerKey: provider, fetchedAt: lastQuotaFetchAt, snapshot };
        void persistSettings();
      } catch (error) {
        quotaError = error instanceof Error ? error.message : "Quota unavailable";
        if (!quotaSnapshot && cached?.snapshot) quotaSnapshot = cached.snapshot;
      } finally {
        quotaFetchPromise = null;
        triggerRender();
      }
    })();

    return quotaFetchPromise;
  };

  const refreshGitStatus = async (ctx: ExtensionContext, force = false) => {
    latestCtx = ctx;
    const cwd = ctx.cwd ?? null;

    // Wipe cached status when the working directory changes so a new project doesn't
    // inherit stale dirty/ahead counts from a previous session.
    if (gitStatusCwd && gitStatusCwd !== cwd) {
      gitStatus = null;
      gitStatusCwd = null;
      lastGitFetchAt = 0;
      triggerRender();
    }

    if (!cwd) {
      gitStatus = null;
      gitStatusCwd = null;
      lastGitFetchAt = 0;
      return;
    }

    if (!force && Date.now() - lastGitFetchAt < GIT_STATUS_TTL_MS) return;
    if (gitFetchPromise) return gitFetchPromise;

    gitFetchPromise = (async () => {
      try {
        const next = await getGitStatus(cwd);
        gitStatus = next;
        gitStatusCwd = cwd;
        lastGitFetchAt = Date.now();
      } catch {
        // Swallow probe failures; keep whatever status we had.
      } finally {
        gitFetchPromise = null;
        triggerRender();
      }
    })();

    return gitFetchPromise;
  };

  const ensureTicker = (ctx: ExtensionContext) => {
    if (ticker) return;
    ticker = setInterval(() => {
      triggerRender();
      const activeCtx = getActiveCtx() ?? ctx;
      if (enabled) {
        void refreshQuota(activeCtx);
        void refreshGitStatus(activeCtx);
      }
    }, 30_000);
  };

  const clearTicker = () => {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = null;
  };

  const installFooter = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubBranch = footerData.onBranchChange(() => {
        // A branch swap means ahead/behind and file stats are stale — force a fresh probe.
        const activeCtx = getActiveCtx() ?? ctx;
        void refreshGitStatus(activeCtx, true);
        tui.requestRender();
      });

      return {
        dispose() {
          if (requestRender) requestRender = null;
          unsubBranch();
        },
        invalidate() {},
        render(width: number): string[] {
          if (!enabled) return [];
          const activeCtx = getActiveCtx() ?? ctx;

          // Fall back to pi's synchronous branch accessor if the async probe hasn't landed yet,
          // so the very first render still shows *something* instead of flickering empty.
          const branchString = footerData.getGitBranch();
          const effectiveGitStatus: GitStatus | null = gitStatus
            ?? (branchString
              ? { branch: branchString, isDirty: false, ahead: 0, behind: 0, fileStats: null }
              : null);

          const modelLabel = theme.fg("accent", `[${getModelLabel(pi, activeCtx)}]`);
          const projectPath = theme.fg("text", getAdaptiveProjectLabel(activeCtx.cwd, width));
          const gitSegment = formatGitBranch(theme as ThemeLike, effectiveGitStatus);
          const projectLabel = gitSegment ? `${projectPath} ${gitSegment}` : projectPath;

          const usage = activeCtx.getContextUsage();
          const contextPercent = clampPercent(usage?.percent);
          const meterWidth = getAdaptiveMeterWidth(width);
          // Pi returns `{percent: null}` right after a compact (until the next assistant message
          // reports real token counts). Paint the bar muted in that state — omitting the color
          // would fall through to buildBar's quota-remaining heuristic and light the whole
          // empty bar up red, which looks like "context is full" when it actually means
          // "unknown".
          const contextColor = contextPercent === null
            ? "muted"
            : contextPercent >= 85 ? "error" : contextPercent >= 65 ? "warning" : "success";
          const contextBar = buildBar(theme as ThemeLike, contextPercent, meterWidth, { color: contextColor });
          const contextText = contextPercent === null
            ? theme.fg("muted", "--%")
            : theme.fg(contextColor, `${Math.round(contextPercent)}%`);
          // Abbreviate the label on narrow terminals so the whole block contracts, not just the
          // bar. Otherwise "Context" (7 chars) dominates a 4-wide bar and the block looks like
          // it isn't shrinking even though the bar itself is smaller.
          const contextLabel = getAdaptiveLabel("Context", "Ctx", width);
          const contextBlock = `${theme.fg("muted", contextLabel)} ${contextBar} ${contextText}`;

          const quotaBlock = renderQuotaBlock(theme as ThemeLike, quotaSnapshot, showWeeklyLimits, quotaError, quotaProviderKey, meterWidth, width);
          const pieces = [modelLabel, projectLabel, contextBlock, quotaBlock].filter(Boolean) as string[];
          const separator = theme.fg("dim", " | ");

          // Happy path: everything fits on one row.
          const single = pieces.join(separator);
          if (visibleWidth(single) <= width) return [single];

          // Otherwise wrap across rows the way claude-hud does: greedily pack pieces left-to-right,
          // and when a piece can't fit on the current row, start a new row with it. This keeps the
          // context *and* usage bars visible on narrow screens instead of dropping usage entirely.
          const lines: string[] = [];
          let current = "";
          let started = false;
          for (const piece of pieces) {
            if (!started) {
              current = piece;
              started = true;
              continue;
            }
            const candidate: string = `${current}${separator}${piece}`;
            if (visibleWidth(candidate) <= width) {
              current = candidate;
            } else {
              lines.push(current);
              current = piece;
            }
          }
          if (started) lines.push(current);

          // If a single piece is still wider than the terminal (e.g. a very long model name on a
          // cramped screen), truncate that row so we never emit a line that overflows.
          return lines.map((line) => (visibleWidth(line) <= width ? line : truncateToWidth(line, width)));
        },
      };
    });
  };

  const applyHudState = (ctx: ExtensionContext) => {
    latestCtx = ctx;
    if (!ctx.hasUI) {
      clearTicker();
      return;
    }
    if (enabled) {
      installFooter(ctx);
      ensureTicker(ctx);
      void refreshQuota(ctx, false);
      void refreshGitStatus(ctx, true);
    } else {
      ctx.ui.setFooter(undefined);
      clearTicker();
    }
  };

  const setEnabled = (ctx: ExtensionContext, next: boolean) => {
    enabled = next;
    applyHudState(ctx);
    void persistSettings();
    ctx.ui.notify(`PI HUD ${enabled ? "enabled" : "disabled"}`, "info");
  };

  pi.on("session_start", async (_event, ctx) => {
    applyLoadedSettings(await loadSettings());
    applyHudState(ctx);
  });

  pi.on("session_shutdown", async () => {
    clearTicker();
  });

  pi.on("model_select", async (_event, ctx) => {
    latestCtx = ctx;
    await refreshQuota(ctx, false);
  });

  pi.on("agent_start", async (_event, ctx) => {
    latestCtx = ctx;
    triggerRender();
  });

  pi.on("agent_end", async (_event, ctx) => {
    latestCtx = ctx;
    void refreshQuota(ctx);
    void refreshGitStatus(ctx);
    triggerRender();
  });

  pi.on("message_end", async (_event, ctx) => {
    latestCtx = ctx;
    triggerRender();
  });

  pi.on("turn_end", async (_event, ctx) => {
    latestCtx = ctx;
    void refreshQuota(ctx);
    // Agents tend to mutate files right up to turn boundaries, so hit git again here.
    void refreshGitStatus(ctx);
    triggerRender();
  });

  pi.registerCommand("hud", {
    description: "HUD controls: /hud on|off|status|weekly [on|off]",
    getArgumentCompletions: (prefix) => {
      const options = ["on", "off", "status", "weekly", "weekly on", "weekly off"];
      const normalized = prefix.toLowerCase();
      const items = options.filter((option) => option.startsWith(normalized)).map((option) => ({ value: option, label: option }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const trimmed = args.trim().toLowerCase();
      const action = trimmed || "toggle";
      const usageText = "Usage: /hud on|off|status|weekly [on|off]";

      if (trimmed === "help") {
        ctx.ui.notify(usageText, "info");
        return;
      }

      if (trimmed === "weekly on") {
        showWeeklyLimits = true;
        void persistSettings();
        triggerRender();
        ctx.ui.notify("PI HUD weekly limits enabled", "info");
        return;
      }
      if (trimmed === "weekly off") {
        showWeeklyLimits = false;
        void persistSettings();
        triggerRender();
        ctx.ui.notify("PI HUD weekly limits disabled", "info");
        return;
      }
      if (trimmed === "weekly") {
        showWeeklyLimits = !showWeeklyLimits;
        void persistSettings();
        triggerRender();
        ctx.ui.notify(`PI HUD weekly limits ${showWeeklyLimits ? "enabled" : "disabled"}`, "info");
        return;
      }

      switch (action) {
        case "on":
          setEnabled(ctx, true);
          return;
        case "off":
          setEnabled(ctx, false);
          return;
        case "status": {
          const totals = getSessionTotals(ctx);
          const quota = quotaProviderKey ? `; quota backend: ${quotaProviderKey}` : "";
          ctx.ui.notify(
            `PI HUD is ${enabled ? "enabled" : "disabled"}; weekly ${showWeeklyLimits ? "on" : "off"}; session ↑${formatCompactNumber(totals.input)} ↓${formatCompactNumber(totals.output)} $${totals.cost.toFixed(3)}${quota}`,
            "info",
          );
          return;
        }
        case "toggle":
          setEnabled(ctx, !enabled);
          return;
        default:
          ctx.ui.notify(usageText, "info");
      }
    },
  });
}
