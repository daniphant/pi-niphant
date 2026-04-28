import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { basename } from "node:path";

const DEFAULT_TITLE = (process.env.PI_NOTIFY_TITLE || "Pi").trim() || "Pi";
const DEFAULT_FALLBACK_BODY = (process.env.PI_NOTIFY_FALLBACK_BODY || "Ready for input").trim() || "Ready for input";
const SUMMARY_MAX_CHARS = clampNumber(process.env.PI_NOTIFY_MAX_BODY, 180, 40, 500);

function clampNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function sanitizeOscField(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[;:]/g, " ").trim();
}

function getProjectName(cwd: string): string {
  const name = basename(cwd);
  return name || cwd || "project";
}

function extractAssistantSummary(messages: any[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;

    const text = message.content
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("\n");

    const normalized = truncate(normalizeText(text), SUMMARY_MAX_CHARS);
    if (normalized) return normalized;
  }

  return undefined;
}

function writeOsc777(title: string, body: string): boolean {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(`\x1b]777;notify;${sanitizeOscField(title)};${sanitizeOscField(body)}\x07`);
  return true;
}

function writeOsc99(title: string, subtitle: string | undefined, body: string): boolean {
  if (!process.stdout.isTTY) return false;

  const id = String(Date.now());
  const writeSegment = (params: string, payload: string) => {
    process.stdout.write(`\x1b]99;${params}:${sanitizeOscField(payload)}\x1b\\`);
  };

  writeSegment(`i=${id};e=1;d=0;p=title`, title);
  if (subtitle) writeSegment(`i=${id};e=1;d=0;p=subtitle`, subtitle);
  writeSegment(`i=${id};e=1;d=1;p=body`, body);
  return true;
}

function appleScriptLiteral(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export default function agentNotifyExtension(pi: ExtensionAPI): void {
  let externalNotifyCliAvailable: boolean | undefined;

  async function canUseExternalNotifyCli(): Promise<boolean> {
    if (externalNotifyCliAvailable !== undefined) return externalNotifyCliAvailable;

    try {
      const result = await pi.exec("bash", ["-lc", "command -v cmux >/dev/null 2>&1"], { timeout: 2_000 });
      externalNotifyCliAvailable = result.code === 0;
    } catch {
      externalNotifyCliAvailable = false;
    }

    return externalNotifyCliAvailable;
  }

  async function sendNotification(cwd: string, body: string): Promise<void> {
    const title = DEFAULT_TITLE;
    const subtitle = getProjectName(cwd);

    // Prefer an external terminal-aware notifier when available.
    if (await canUseExternalNotifyCli()) {
      try {
        const args = ["notify", "--title", title, "--subtitle", subtitle, "--body", body];
        await pi.exec("cmux", args, { timeout: 5_000 });
        return;
      } catch {
        // Fall through to escape-sequence or OS notification mechanisms.
      }
    }

    // Kitty understands OSC 99. Many other terminals, including Ghostty,
    // WezTerm, and iTerm-compatible setups, understand OSC 777.
    if (process.env.KITTY_WINDOW_ID && writeOsc99(title, subtitle, body)) return;
    if (writeOsc777(title, body)) return;

    try {
      if (process.platform === "darwin") {
        await pi.exec("osascript", [
          "-e",
          `display notification ${appleScriptLiteral(body)} with title ${appleScriptLiteral(title)} subtitle ${appleScriptLiteral(subtitle)}`,
        ], { timeout: 5_000 });
        return;
      }
    } catch {
      // Ignore final fallback errors.
    }
  }

  pi.on("agent_end", async (event, ctx) => {
    if (!ctx.hasUI || !process.stdout.isTTY) return;
    const body = extractAssistantSummary((event as any)?.messages) || DEFAULT_FALLBACK_BODY;
    await sendNotification(ctx.cwd, body);
  });

  pi.registerCommand("agent-notify-test", {
    description: "Send a test desktop notification via terminal/OS fallback",
    handler: async (_args, ctx) => {
      await sendNotification(ctx.cwd, "Test notification from Pi");
      ctx.ui.notify("Sent test notification", "info");
    },
  });
}
