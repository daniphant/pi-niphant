import type { Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ChildStatus, RunStatus } from "./schema.ts";
import { formatDuration, readTail, shortenPath, truncate } from "./utils.ts";

const WIDGET_KEY = "delegated-agents";
const STATUS_KEY = "delegated-agents";
const OVERLAY_WIDTH = 120;
const POLL_INTERVAL_MS = 600;

function marker(theme: Theme, child: ChildStatus, selected = false): string {
  if (selected) return theme.fg("accent", "▶");
  if (child.state === "complete") return theme.fg("success", "✓");
  if (child.state === "failed") return theme.fg("error", "✕");
  if (child.state === "running") return theme.fg("warning", "●");
  return theme.fg("muted", "○");
}

function actionText(child: ChildStatus, max = 52): string {
  const phase = child.phase || (child.state === "queued" ? "Queued" : child.state === "running" ? "Running" : child.state === "complete" ? "Complete" : "Failed");
  const summary = child.state === "running" || child.state === "queued"
    ? child.task
    : child.summary || child.error || child.task;
  return truncate(`${phase} — ${summary}`, max);
}

function readLogWindow(filePath: string, lines = 18): string[] {
  return readTail(filePath, 24000).slice(-lines);
}

function wrapBlock(text: string, width: number): string[] {
  if (!text) return [""];
  return text
    .split(/\r?\n/)
    .flatMap((line) => wrapTextWithAnsi(line || " ", Math.max(8, width)));
}

export function renderDelegatedAgentWidget(ctx: ExtensionContext, runs: RunStatus[]): void {
  if (!ctx.hasUI) return;
  const activeRuns = runs.filter((run) => run.state === "queued" || run.state === "running");
  if (activeRuns.length === 0) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const activeChildren = activeRuns
    .flatMap((run) => run.children)
    .filter((child) => child.state === "queued" || child.state === "running");

  const leadRun = activeRuns[0];
  const lines: string[] = [ctx.ui.theme.fg("accent", `Delegated agents • ${leadRun?.runId ?? "active"}`)];
  for (const child of activeChildren.slice(0, 6)) {
    const id = truncate(child.id, 12).padEnd(12, " ");
    lines.push(`${marker(ctx.ui.theme, child)} ${id} ${actionText(child, 58)}`);
  }
  if (activeChildren.length > 6) {
    lines.push(ctx.ui.theme.fg("dim", `+ ${activeChildren.length - 6} more agents`));
  }
  if (activeRuns.length > 1) {
    lines.push(ctx.ui.theme.fg("dim", `+ ${activeRuns.length - 1} more runs active`));
  }
  lines.push(ctx.ui.theme.fg("dim", "Inspect: Ctrl+Shift+B"));
  lines.push(ctx.ui.theme.fg("dim", "Steer: /delegated-agents-steer latest <agent-id> <instruction>"));

  const statusText = activeChildren.slice(0, 2)
    .map((child) => `${child.id}: ${truncate(child.phase || child.state, 12)}`)
    .join(" • ");
  const remainder = activeChildren.length > 2 ? ` • +${activeChildren.length - 2} more` : "";

  ctx.ui.setWidget(WIDGET_KEY, lines);
  ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `● ${statusText}${remainder}`));
}

type OverlayHandleLike = {
  hide?: () => void;
  setHidden?: (hidden: boolean) => void;
  focus?: () => void;
  unfocus?: () => void;
  isFocused?: () => boolean;
};

function statusBadge(theme: Theme, child: ChildStatus): string {
  if (child.state === "complete") return theme.fg("success", "Complete");
  if (child.state === "failed") return theme.fg("error", "Failed");
  if (child.state === "running") return theme.fg("warning", child.phase || "Running");
  return theme.fg("muted", "Queued");
}

class DelegatedAgentsOverlay {
  private handle: OverlayHandleLike | null = null;
  private selected = 0;
  private inspectorMode = false;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly theme: Theme,
    private readonly getRun: () => RunStatus | null,
    private readonly done: () => void,
    private readonly requestRender: () => void,
  ) {
    this.ticker = setInterval(() => this.requestRender(), POLL_INTERVAL_MS);
    this.ticker.unref?.();
  }

  setHandle(handle: OverlayHandleLike): void {
    this.handle = handle;
  }

  handleInput(data: string): void {
    const run = this.getRun();
    const children = run?.children ?? [];
    if (matchesKey(data, "escape")) {
      this.handle?.unfocus?.();
      this.requestRender();
      return;
    }
    if (matchesKey(data, "q")) {
      this.done();
      return;
    }
    if (matchesKey(data, "return")) {
      this.inspectorMode = !this.inspectorMode;
      this.requestRender();
      return;
    }
    if (matchesKey(data, "up")) {
      if (!this.inspectorMode) this.selected = Math.max(0, this.selected - 1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, "down")) {
      if (!this.inspectorMode) this.selected = Math.min(Math.max(0, children.length - 1), this.selected + 1);
      this.requestRender();
    }
  }

  render(_width: number): string[] {
    const run = this.getRun();
    const children = run?.children ?? [];
    if (this.selected >= children.length) this.selected = Math.max(0, children.length - 1);

    const w = OVERLAY_WIDTH;
    const innerW = w - 2;
    const leftW = 56;
    const rightW = innerW - leftW - 1;
    const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - visibleWidth(s)));
    const line = (left = "", right = "") => this.theme.fg("border", "│") + pad(left, leftW) + " " + pad(right, rightW) + this.theme.fg("border", "│");
    const full = (content = "") => this.theme.fg("border", "│") + pad(content, innerW) + this.theme.fg("border", "│");
    const lines: string[] = [];

    const focused = this.handle?.isFocused?.() ?? true;

    lines.push(this.theme.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(full(` ${this.theme.fg("accent", "Delegated agents")}`));

    const running = children.filter((child) => child.state === "queued" || child.state === "running").length;
    lines.push(full(` ${this.theme.fg("dim", `${running} running • ${run?.mode ?? "parallel"} • ${run?.blocking ? "waiting" : "background"} • ${focused ? "focused" : "passive"}`)}`));
    lines.push(full());

    if (!run || children.length === 0) {
      lines.push(full(` ${this.theme.fg("muted", "No delegated runs yet.")}`));
      lines.push(this.theme.fg("border", `╰${"─".repeat(innerW)}╯`));
      return lines;
    }

    const selected = children[this.selected] ?? children[0]!;

    if (this.inspectorMode) {
      const logLines = readLogWindow(selected.outputLogPath, 18);
      const detailLines = [
        `${this.theme.fg("accent", selected.displayName)} ${this.theme.fg("dim", `(${selected.shortLabel} • ${selected.id})`)}`,
        `${statusBadge(this.theme, selected)} ${this.theme.fg("dim", formatDuration(selected.startedAt, selected.state === "complete" || selected.state === "failed" ? selected.updatedAt : undefined))}`,
        "",
        this.theme.fg("dim", "Task"),
        ...wrapBlock(selected.task, innerW - 2),
        "",
        this.theme.fg("dim", "Live output"),
        ...(logLines.length > 0 ? logLines.flatMap((entry) => wrapBlock(`> ${entry}`, innerW - 2)) : [this.theme.fg("muted", "No live output yet")]),
        "",
        this.theme.fg("dim", selected.state === "complete" ? "Summary" : selected.state === "failed" ? "Error" : "Path"),
        ...wrapBlock(selected.summary || selected.error || shortenPath(selected.cwd), innerW - 2),
        "",
        this.theme.fg("dim", "Steer"),
        ...wrapBlock(`/delegated-agents-steer ${run?.runId ?? "latest"} ${selected.id} <instruction>`, innerW - 2),
      ];

      for (const detailLine of detailLines) lines.push(full(` ${detailLine}`));
      lines.push(full());
      lines.push(full(` ${this.theme.fg("dim", focused ? "Enter back to agents list • Esc return to prompt • q hide panel" : "Ctrl+Shift+B focus panel • q hide panel")}`));
      lines.push(full(` ${this.theme.fg("dim", focused ? "Steer from prompt with /delegated-agents-steer" : "Panel is visible but passive • parent is waiting")}`));
      lines.push(this.theme.fg("border", `╰${"─".repeat(innerW)}╯`));
      return lines;
    }

    const selectedTail = readTail(selected.outputLogPath);
    const rightLines = [
      `${this.theme.fg("accent", selected.displayName)} ${this.theme.fg("dim", `(${selected.shortLabel} • ${selected.id})`)}`,
      `${statusBadge(this.theme, selected)} ${this.theme.fg("dim", formatDuration(selected.startedAt, selected.state === "complete" || selected.state === "failed" ? selected.updatedAt : undefined))}`,
      "",
      this.theme.fg("dim", "Task"),
      ...wrapBlock(selected.task, rightW),
      "",
      this.theme.fg("dim", "Recent activity"),
      ...(selectedTail.length > 0 ? selectedTail.flatMap((entry) => wrapBlock(`> ${entry}`, rightW)) : [this.theme.fg("muted", "No recent activity yet")]),
      "",
      this.theme.fg("dim", selected.state === "complete" ? "Summary" : selected.state === "failed" ? "Error" : "Path"),
      ...wrapBlock(selected.summary || selected.error || shortenPath(selected.cwd), rightW),
    ];

    const maxRows = Math.max(children.length * 2, rightLines.length);
    for (let i = 0; i < maxRows; i++) {
      const child = children[Math.floor(i / 2)];
      let left = "";
      if (child && i % 2 === 0) {
        const rowMarker = marker(this.theme, child, Math.floor(i / 2) === this.selected);
        left = ` ${rowMarker} ${truncate(child.id, 12).padEnd(12, " ")} ${truncate(child.phase || (child.state === "queued" ? "Queued" : child.state), 16)} ${this.theme.fg("dim", formatDuration(child.startedAt, child.state === "complete" || child.state === "failed" ? child.updatedAt : undefined))}`;
      } else if (child) {
        left = `    ${this.theme.fg("dim", truncate(`${child.displayName} — ${child.task}`, leftW - 6))}`;
      }
      const right = rightLines[i] ?? "";
      lines.push(line(left, right));
    }

    lines.push(full());
    lines.push(full(` ${this.theme.fg("dim", focused ? "Enter inspect selected agent • Esc return to prompt • q hide panel" : "Ctrl+Shift+B focus panel • q hide panel" )}`));
    lines.push(full(` ${this.theme.fg("dim", focused ? "↑↓ navigate • steer with /delegated-agents-steer" : "Panel is visible but passive • parent is waiting" )}`));
    lines.push(this.theme.fg("border", `╰${"─".repeat(innerW)}╯`));
    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }
}

export async function openDelegatedAgentsOverlay(ctx: ExtensionContext, getRun: () => RunStatus | null): Promise<void> {
  if (!ctx.hasUI) return;
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const component = new DelegatedAgentsOverlay(theme, getRun, () => done(undefined), () => tui.requestRender());
    return component;
  }, {
    overlay: true,
    overlayOptions: {
      width: OVERLAY_WIDTH,
      maxHeight: "84%",
      anchor: "right-center",
      offsetX: -1,
    },
  });
}

export function showDelegatedAgentsOverlay(
  ctx: ExtensionContext,
  getRun: () => RunStatus | null,
  options?: { focusOnShow?: boolean; onClose?: () => void },
): {
  hide: () => void;
  show: () => void;
  focus: () => void;
  unfocus: () => void;
  isFocused: () => boolean;
  isVisible: () => boolean;
  isAlive: () => boolean;
} {
  if (!ctx.hasUI) {
    return {
      hide: () => {},
      show: () => {},
      focus: () => {},
      unfocus: () => {},
      isFocused: () => false,
      isVisible: () => false,
      isAlive: () => false,
    };
  }

  let handle: OverlayHandleLike | undefined;
  let hidden = false;
  let alive = true;
  let component: DelegatedAgentsOverlay | undefined;
  ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    component = new DelegatedAgentsOverlay(theme, getRun, () => done(undefined), () => tui.requestRender());
    return component;
  }, {
    overlay: true,
    overlayOptions: {
      width: OVERLAY_WIDTH,
      maxHeight: "84%",
      anchor: "right-center",
      offsetX: -1,
      // @ts-ignore supported by overlay system; local typings may not include it
      nonCapturing: true,
    },
    onHandle: (value) => {
      handle = value as OverlayHandleLike;
      component?.setHandle(handle);
      hidden = false;
      if (options?.focusOnShow !== false) handle?.focus?.();
    },
  }).then(() => {
    alive = false;
    hidden = true;
    handle = undefined;
    component = undefined;
    options?.onClose?.();
  }).catch(() => {
    alive = false;
    hidden = true;
    handle = undefined;
    component = undefined;
    options?.onClose?.();
  });

  return {
    hide: () => {
      hidden = true;
      try {
        handle?.hide?.();
      } catch {}
    },
    show: () => {
      hidden = false;
      try {
        handle?.setHidden?.(false);
      } catch {}
    },
    focus: () => {
      hidden = false;
      try {
        handle?.setHidden?.(false);
        handle?.focus?.();
      } catch {}
    },
    unfocus: () => {
      try {
        handle?.unfocus?.();
      } catch {}
    },
    isFocused: () => handle?.isFocused?.() ?? false,
    isVisible: () => alive && !hidden,
    isAlive: () => alive,
  };
}
