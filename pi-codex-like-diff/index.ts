import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";
import {
  VERSION,
  createEditToolDefinition,
  renderDiff as builtinRenderDiff,
  type AgentToolResult,
  type ExtensionAPI,
  type Theme,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyDiffRowBackground, renderCodexLikeDiff, renderCodexLikeDiffRows } from "./render-diff.js";

type EditArgs = { path?: string; file_path?: string; edits?: Array<{ oldText: string; newText: string }> | string; oldText?: string; newText?: string };
type Preview = { diff: string; firstChangedLine?: number } | { error: string };
type EditState = { callComponent?: EditCallComponent };
type EditCallComponent = Box & {
  preview?: Preview;
  previewArgsKey?: string;
  previewPending: boolean;
  settledError: boolean;
};

type ComputeEditsDiff = (path: string, edits: Array<{ oldText: string; newText: string }>, cwd: string) => Promise<Preview>;

let computeEditsDiffPromise: Promise<ComputeEditsDiff | null> | null = null;
let warnedVersion = false;

function warnOnce(message: string) {
  if (warnedVersion) return;
  warnedVersion = true;
  console.warn(`[pi-codex-like-diff] ${message}`);
}

async function loadComputeEditsDiff(): Promise<ComputeEditsDiff | null> {
  if (!computeEditsDiffPromise) {
    computeEditsDiffPromise = (async () => {
      try {
        const require = createRequire(import.meta.url);
        const indexPath = require.resolve("@mariozechner/pi-coding-agent");
        const distDir = dirname(indexPath);
        const mod = await import(pathToFileURL(join(distDir, "core/tools/edit-diff.js")).href) as { computeEditsDiff?: ComputeEditsDiff };
        return typeof mod.computeEditsDiff === "function" ? mod.computeEditsDiff : null;
      } catch (error) {
        warnOnce(`could not load Pi 0.70.2 preview diff helper; edit previews will show the header only (${error instanceof Error ? error.message : String(error)})`);
        return null;
      }
    })();
  }
  return computeEditsDiffPromise;
}

function createEditCallRenderComponent(): EditCallComponent {
  return Object.assign(new Box(1, 1, (text: string) => text), {
    preview: undefined,
    previewArgsKey: undefined,
    previewPending: false,
    settledError: false,
  });
}

function getEditCallRenderComponent(state: EditState, lastComponent: unknown): EditCallComponent {
  if (lastComponent instanceof Box) {
    const component = lastComponent as EditCallComponent;
    state.callComponent = component;
    return component;
  }
  if (state.callComponent) return state.callComponent;
  const component = createEditCallRenderComponent();
  state.callComponent = component;
  return component;
}

function getRenderablePreviewInput(args: EditArgs | undefined | null): { path: string; edits: Array<{ oldText: string; newText: string }> } | null {
  if (!args || typeof args !== "object") return null;
  const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : null;
  if (!path) return null;
  let edits = args.edits;
  if (typeof edits === "string") {
    try { edits = JSON.parse(edits); } catch { /* ignore */ }
  }
  if (Array.isArray(edits) && edits.length > 0 && edits.every((edit) => typeof edit?.oldText === "string" && typeof edit?.newText === "string")) {
    return { path, edits };
  }
  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    return { path, edits: [{ oldText: args.oldText, newText: args.newText }] };
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function shortenPath(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function formatEditCall(args: EditArgs | undefined, theme: Theme): string {
  const rawPath = str(args?.file_path ?? args?.path);
  const path = rawPath !== null ? shortenPath(rawPath) : null;
  const pathDisplay = path === null ? theme.fg("error", "invalid path") : path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
  return `${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`;
}

function getEditHeaderBg(preview: Preview | undefined, settledError: boolean, theme: Theme) {
  if (preview) return (text: string) => theme.bg("error" in preview ? "toolErrorBg" : "toolSuccessBg", text);
  if (settledError) return (text: string) => theme.bg("toolErrorBg", text);
  return (text: string) => theme.bg("toolPendingBg", text);
}

function setEditPreview(component: EditCallComponent, preview: Preview, argsKey: string | undefined): boolean {
  const current = component.preview;
  const changed = current === undefined ||
    ("error" in current && "error" in preview ? current.error !== preview.error : "error" in current !== "error" in preview) ||
    (!("error" in current) && !("error" in preview) && (current.diff !== preview.diff || current.firstChangedLine !== preview.firstChangedLine));
  component.preview = preview;
  component.previewArgsKey = argsKey;
  component.previewPending = false;
  return changed;
}

function renderSafeDiff(diff: string, theme: Theme, filePath?: string): string {
  try {
    return renderCodexLikeDiff(diff, theme, { filePath });
  } catch {
    try { return builtinRenderDiff(diff, { filePath }); } catch { return diff; }
  }
}

function addDiffRows(component: { addChild(child: unknown): void }, diff: string, theme: Theme, filePath: string | undefined, paddingX = 0) {
  try {
    for (const row of renderCodexLikeDiffRows(diff, theme, { filePath })) {
      const bgFn = row.bg ? (text: string) => applyDiffRowBackground(row.bg!, text) : undefined;
      component.addChild(new Text(row.text, paddingX, 0, bgFn));
    }
  } catch {
    component.addChild(new Text(renderSafeDiff(diff, theme, filePath), paddingX, 0));
  }
}

function buildEditCallComponent(component: EditCallComponent, args: EditArgs | undefined, theme: Theme): EditCallComponent {
  component.setBgFn(getEditHeaderBg(component.preview, component.settledError, theme));
  component.clear();
  component.addChild(new Text(formatEditCall(args, theme), 0, 0));
  if (!component.preview) return component;
  const rawPath = str(args?.file_path ?? args?.path) ?? undefined;
  component.addChild(new Spacer(1));
  if ("error" in component.preview) {
    component.addChild(new Text(theme.fg("error", component.preview.error), 0, 0));
  } else {
    addDiffRows(component, component.preview.diff, theme, rawPath, 0);
  }
  return component;
}

function formatEditResult(args: EditArgs | undefined, preview: Preview | undefined, result: AgentToolResult<any>, theme: Theme, isError: boolean): string | undefined {
  const rawPath = str(args?.file_path ?? args?.path) ?? undefined;
  const previewDiff = preview && !("error" in preview) ? preview.diff : undefined;
  const previewError = preview && "error" in preview ? preview.error : undefined;
  if (isError) {
    const errorText = result.content.filter((c) => c.type === "text").map((c) => c.text || "").join("\n");
    if (!errorText || errorText === previewError) return undefined;
    return theme.fg("error", errorText);
  }
  const resultDiff = (result.details as any)?.diff;
  if (typeof resultDiff === "string" && resultDiff !== previewDiff) return renderSafeDiff(resultDiff, theme, rawPath);
  return undefined;
}

export default function codexLikeDiffExtension(pi: ExtensionAPI) {
  if (VERSION !== "0.70.2") {
    warnOnce(`tested against Pi 0.70.2, detected ${VERSION}; registering renderer with built-in execution and safe fallbacks`);
  }

  const builtin = createEditToolDefinition(process.cwd()) as ToolDefinition<any, any, EditState>;
  const override = {
    ...builtin,
    renderCall(args: EditArgs, theme: Theme, context) {
      const component = getEditCallRenderComponent(context.state, context.lastComponent);
      const previewInput = getRenderablePreviewInput(args);
      const argsKey = previewInput ? JSON.stringify({ path: previewInput.path, edits: previewInput.edits }) : undefined;
      if (component.previewArgsKey !== argsKey) {
        component.preview = undefined;
        component.previewArgsKey = argsKey;
        component.previewPending = false;
        component.settledError = false;
      }
      if (context.argsComplete && previewInput && !component.preview && !component.previewPending) {
        component.previewPending = true;
        const requestKey = argsKey;
        void loadComputeEditsDiff().then((computeEditsDiff) => {
          if (!computeEditsDiff) {
            component.previewPending = false;
            return;
          }
          return computeEditsDiff(previewInput.path, previewInput.edits, context.cwd).then((preview) => {
            if (component.previewArgsKey === requestKey) {
              setEditPreview(component, preview, requestKey);
              context.invalidate();
            }
          });
        }).catch((error) => {
          component.previewPending = false;
          setEditPreview(component, { error: error instanceof Error ? error.message : String(error) }, requestKey);
          context.invalidate();
        });
      }
      return buildEditCallComponent(component, args, theme);
    },
    renderResult(result: AgentToolResult<any>, _options, theme: Theme, context) {
      const callComponent = (context.state as EditState).callComponent;
      const previewInput = getRenderablePreviewInput(context.args as EditArgs);
      const argsKey = previewInput ? JSON.stringify({ path: previewInput.path, edits: previewInput.edits }) : undefined;
      const resultDiff = !context.isError ? (result.details as any)?.diff : undefined;
      let changed = false;
      if (callComponent) {
        if (typeof resultDiff === "string") {
          changed = setEditPreview(callComponent, { diff: resultDiff, firstChangedLine: (result.details as any)?.firstChangedLine }, argsKey) || changed;
        }
        if (callComponent.settledError !== context.isError) {
          callComponent.settledError = context.isError;
          changed = true;
        }
        if (changed) context.invalidate();
      }
      const output = formatEditResult(context.args as EditArgs, callComponent?.preview, result, theme, context.isError);
      const component = context.lastComponent ?? new Container();
      component.clear();
      if (!output) return component;
      component.addChild(new Spacer(1));
      const rawPath = str((context.args as EditArgs)?.file_path ?? (context.args as EditArgs)?.path) ?? undefined;
      const previewDiff = callComponent?.preview && !("error" in callComponent.preview) ? callComponent.preview.diff : undefined;
      if (!context.isError && typeof resultDiff === "string" && resultDiff !== previewDiff) {
        addDiffRows(component, resultDiff, theme, rawPath, 1);
      } else {
        component.addChild(new Text(output, 1, 0));
      }
      return component;
    },
  } satisfies ToolDefinition<any, any, EditState>;

  pi.registerTool(override);
}
