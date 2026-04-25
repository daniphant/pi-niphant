import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync as fsMkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "extensions", "pi-checkpoint.json");

type CheckpointMode = "smart" | "continuous" | "explicit" | "off";

interface Config {
  mode: CheckpointMode;
  includePiArtifacts: boolean;
  notify: boolean;
}

const DEFAULT_CONFIG: Config = {
  mode: "smart",
  includePiArtifacts: true,
  notify: true,
};

function readConfig(): Config {
  try {
    if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function writeConfig(config: Config) {
  mkdirSync(dirname(CONFIG_PATH));
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function mkdirSync(path: string) {
  try {
    fsMkdirSync(path, { recursive: true });
  } catch {}
}

function sh(cwd: string, command: string): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile("bash", ["-lc", command], { cwd, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
      const anyError = error as NodeJS.ErrnoException | null;
      resolve({ ok: !error, stdout, stderr: stderr + (error ? `\n${error.message}` : ""), code: typeof anyError?.code === "number" ? anyError.code : anyError ? 1 : 0 });
    });
  });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function checkpointDir(cwd: string) {
  const dir = join(cwd, ".pi", "checkpoints");
  await mkdir(dir, { recursive: true });
  return dir;
}

async function saveCheckpoint(cwd: string, label = "manual") {
  const git = await sh(cwd, "git rev-parse --show-toplevel");
  if (!git.ok) throw new Error("Not inside a git repository.");
  const diff = await sh(cwd, "git diff --binary");
  const staged = await sh(cwd, "git diff --cached --binary");
  const status = await sh(cwd, "git status --short");
  const dir = await checkpointDir(cwd);
  const id = `${stamp()}-${label.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40) || "checkpoint"}`;
  const patchPath = join(dir, `${id}.patch`);
  const metaPath = join(dir, `${id}.json`);
  await writeFile(patchPath, [`# unstaged`, diff.stdout, `\n# staged`, staged.stdout].join("\n"));
  await writeFile(metaPath, JSON.stringify({ id, label, createdAt: new Date().toISOString(), cwd, status: status.stdout, patchPath }, null, 2));
  return { id, patchPath, metaPath, status: status.stdout };
}

async function latestCheckpoint(cwd: string) {
  const dir = await checkpointDir(cwd);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".patch")).sort();
  if (!files.length) return null;
  return join(dir, files[files.length - 1]);
}

async function listCheckpoints(cwd: string) {
  const dir = await checkpointDir(cwd);
  return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
}

async function gitStatus(cwd: string) {
  const result = await sh(cwd, "git status --short");
  return result.ok ? result.stdout.trim() : "";
}

function parseStatusLine(line: string) {
  if (!line.trim()) return null;
  const porcelain = line.match(/^(.{2})\s+(.+)$/);
  const nameStatus = line.match(/^([A-Z])\s+(.+)$/);
  const code = porcelain?.[1] ?? nameStatus?.[1] ?? "";
  const rawPath = (porcelain?.[2] ?? nameStatus?.[2] ?? "").trim();
  if (!rawPath) return null;
  const file = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()!.trim() : rawPath;
  return { code, file };
}

function summarizeStatus(status: string) {
  const entries = status.split(/\r?\n/).map(parseStatusLine).filter(Boolean) as Array<{ code: string; file: string }>;
  const allFiles = entries.map((entry) => entry.file);
  const files = allFiles.slice(0, 12);
  return {
    count: entries.length,
    entries,
    allFiles,
    files,
    text: files.length ? files.map((f) => `- ${f}`).join("\n") : "- no files listed",
  };
}

function commonTopLevel(files: string[]) {
  if (!files.length) return null;
  const [first, ...rest] = files.map((file) => file.split(/[\\/]/)[0]).filter(Boolean);
  if (!first) return null;
  return rest.every((part) => part === first) ? first : null;
}

function scopeForFiles(files: string[]) {
  const topLevel = commonTopLevel(files);
  if (topLevel) return topLevel;
  if (files.some((file) => file.startsWith("pi-"))) return "repo";
  return "repo";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
    return "";
  }).filter(Boolean).join("\n");
}

function getRecentMessageText(messages: unknown[] | undefined, role: "user" | "assistant") {
  for (const message of [...(messages ?? [])].reverse()) {
    if (!message || typeof message !== "object" || !("role" in message) || message.role !== role) continue;
    return textFromContent("content" in message ? message.content : undefined).trim();
  }
  return "";
}

function classifyCommitType(files: string[], promptText: string, assistantText: string) {
  const allText = `${promptText}\n${assistantText}`.toLowerCase();
  const nonDocs = files.filter((file) => !/(^|\/)(readme|docs?\/|changelog|contributing|license)(\.|\/|$)/i.test(file) && !/\.md$/i.test(file));
  const onlyDocs = files.length > 0 && nonDocs.length === 0;
  const onlyTests = files.length > 0 && files.every((file) => /(^|\/)(test|tests|__tests__)\//i.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file));
  const onlyConfig = files.length > 0 && files.every((file) => /(^|\/)(package(-lock)?\.json|tsconfig\.json|vite\.config\.|vitest\.config\.|\.github\/|scripts\/)/i.test(file));

  if (onlyDocs) return "docs";
  if (onlyTests) return "test";
  if (onlyConfig) return "chore";
  if (/\b(fix|bug|broken|error|failure|regression|repair|resolve|correct)\b/.test(allText)) return "fix";
  if (/\b(add|added|implement|implemented|support|feature|new|create|created)\b/.test(allText)) return "feat";
  if (/\b(refactor|cleanup|simplif|rework|restructure)\b/.test(allText)) return "refactor";
  if (/\b(test|coverage|spec)\b/.test(allText)) return "test";
  if (/\b(doc|readme|documentation)\b/.test(allText)) return "docs";
  return "chore";
}

function normalizeSubjectPhrase(text: string) {
  return text
    .replace(/[`*_#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?:;]+$/g, "")
    .trim()
    .replace(/^(i('|’)ll|i will|i can|we can|let('|’)s|please|cool,?|okay,?|alright,?)\s+/i, "")
    .replace(/^(implemented|implements|implementing)\s+/i, "implement ")
    .replace(/^(added|adds|adding)\s+/i, "add ")
    .replace(/^(updated|updates|updating)\s+/i, "update ")
    .replace(/^(fixed|fixes|fixing)\s+/i, "fix ")
    .replace(/^(moved|moves|moving)\s+/i, "move ")
    .replace(/^(removed|removes|removing)\s+/i, "remove ")
    .replace(/^(documented|documents|documenting)\s+/i, "document ")
    .replace(/^(changed|changes|changing)\s+/i, "change ");
}

function inferSubjectPhrase(files: string[], promptText: string, assistantText: string) {
  const combined = `${assistantText}\n${promptText}`;
  const completionMatch = combined.match(/\b(implemented|added|updated|fixed|moved|removed|documented|changed|renamed|refactored)\s+([^\n.]{6,90})/i);
  if (completionMatch) return normalizeSubjectPhrase(`${completionMatch[1]} ${completionMatch[2]}`).toLowerCase();

  const prompt = promptText.toLowerCase();
  if (/move|moved|end|after/.test(prompt) && /reset/.test(prompt)) return "move stopwatch timer after reset";
  if (/session|tui|duration|timer|clock|stopwatch|⏱/.test(prompt) && /hud|pi-hud/.test(prompt)) return "add session timer to hud";
  if (/gstack/.test(prompt)) return "remove gstack checkpoint metadata";
  if (/commit/.test(prompt) && /message|format|title/.test(prompt)) return "improve auto-commit messages";

  const summary = summarizeStatus(files.map((file) => `M  ${file}`).join("\n"));
  if (summary.count === 1) {
    const file = summary.allFiles[0] ?? "working tree";
    if (/\.md$/i.test(file)) return "update documentation";
    if (/(^|\/)(test|tests|__tests__)\//i.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file)) return "update tests";
    return `update ${file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "working tree"}`;
  }
  const topLevel = commonTopLevel(files);
  return topLevel ? `update ${topLevel}` : "update working tree";
}

function buildCommitSubject(status: string, messages?: unknown[]) {
  const summary = summarizeStatus(status);
  const files = summary.allFiles;
  const scope = scopeForFiles(files);
  const promptText = getRecentMessageText(messages, "user");
  const assistantText = getRecentMessageText(messages, "assistant");
  const type = classifyCommitType(files, promptText, assistantText);
  const phrase = inferSubjectPhrase(files, promptText, assistantText).replace(/^\w+\([^)]*\):\s*/i, "");
  return `${type}(${scope}): ${phrase}`.slice(0, 120);
}

function shouldSmartCommit(messages: unknown[] | undefined, status: string) {
  const summary = summarizeStatus(status);
  if (summary.count === 0) return { ok: false, reason: "no changes" };

  const assistantText = getRecentMessageText(messages, "assistant").toLowerCase();
  if (!assistantText) return { ok: true, reason: "no assistant summary available" };

  const incomplete = [
    /\b(no implementation yet|research pass|research only|no code changes?)\b/,
    /\b(i('|’)ll|i will|next i('|’)ll|next i will|need to|still need to|remaining work|not done|incomplete|midway|follow[- ]?up)\b/,
    /\b(validation|tests?|checks?)\s+(failed|failing|pending|still needed|not run|not yet)\b/,
    /\b(need|needs)\s+to\s+(rerun|run|fix|finish|complete)\b/,
  ];
  if (incomplete.some((pattern) => pattern.test(assistantText))) return { ok: false, reason: "turn appears incomplete" };

  const complete = /\b(done|implemented|added|updated|fixed|moved|removed|validated|passed|complete|created|documented)\b/.test(assistantText);
  if (!complete) return { ok: false, reason: "no completion signal" };
  return { ok: true, reason: "complete turn" };
}

async function autoCommit(ctx: ExtensionContext, reason: string, options: { messages?: unknown[]; manualSubject?: string } = {}) {
  const config = readConfig();
  if (!["smart", "continuous"].includes(config.mode)) return { skipped: true, reason: `mode=${config.mode}` };

  const inside = await sh(ctx.cwd, "git rev-parse --is-inside-work-tree");
  if (!inside.ok || inside.stdout.trim() !== "true") return { skipped: true, reason: "not a git repository" };

  const statusBefore = await gitStatus(ctx.cwd);
  if (!statusBefore) return { skipped: true, reason: "no changes" };

  if (config.mode === "smart" && !options.manualSubject) {
    const decision = shouldSmartCommit(options.messages, statusBefore);
    if (!decision.ok) return { skipped: true, reason: decision.reason };
  }

  const addCommand = config.includePiArtifacts
    ? "git add -A && git reset -- .pi/checkpoints .pi/workflows .pi/plans 2>/dev/null || true"
    : "git add -A && git reset -- .pi 2>/dev/null || true";
  await sh(ctx.cwd, addCommand);

  const staged = await sh(ctx.cwd, "git diff --cached --name-status");
  if (!staged.ok || !staged.stdout.trim()) return { skipped: true, reason: "no staged changes after filters" };

  const subject = (options.manualSubject?.trim() || buildCommitSubject(staged.stdout, options.messages)).replace(/[\r\n]+/g, " ").slice(0, 120);
  const commit = await sh(ctx.cwd, `git commit -m ${JSON.stringify(subject)}`);
  if (!commit.ok) return { skipped: false, error: commit.stderr || commit.stdout };

  const sha = await sh(ctx.cwd, "git rev-parse --short HEAD");
  return { skipped: false, sha: sha.stdout.trim(), subject, output: commit.stdout.trim(), reason };
}

export default function checkpointExtension(pi: ExtensionAPI) {
  pi.on("agent_end", async (event, ctx) => {
    const result = await autoCommit(ctx, "agent_end", { messages: event.messages as unknown[] });
    const config = readConfig();
    if (!config.notify || !ctx.hasUI || result.skipped) return;
    if ("error" in result && result.error) {
      ctx.ui.notify(`Auto-commit failed:\n${result.error.slice(-2000)}`, "warning");
      return;
    }
    ctx.ui.notify(`Auto-commit created: ${result.subject} (${result.sha})`, "info");
  });

  pi.registerCommand("checkpoint-mode", {
    description: "Configure checkpoint mode: /checkpoint-mode smart|continuous|explicit|off|status",
    handler: async (args, ctx) => {
      const config = readConfig();
      const mode = args.trim() as CheckpointMode | "status" | "";
      if (!mode || mode === "status") {
        ctx.ui.notify(`Checkpoint mode: ${config.mode}\nincludePiArtifacts: ${config.includePiArtifacts}\nnotify: ${config.notify}\nconfig: ${CONFIG_PATH}`, "info");
        return;
      }
      if (!["smart", "continuous", "explicit", "off"].includes(mode)) {
        ctx.ui.notify("Usage: /checkpoint-mode smart|continuous|explicit|off|status", "warning");
        return;
      }
      config.mode = mode as CheckpointMode;
      writeConfig(config);
      ctx.ui.notify(`Checkpoint mode set to ${config.mode}`, "info");
    },
  });

  pi.registerCommand("checkpoint-notify", {
    description: "Toggle auto-commit notifications: /checkpoint-notify on|off|status",
    handler: async (args, ctx) => {
      const config = readConfig();
      const value = args.trim().toLowerCase();
      if (!value || value === "status") {
        ctx.ui.notify(`checkpoint notify: ${config.notify ? "on" : "off"}`, "info");
        return;
      }
      if (!["on", "off"].includes(value)) {
        ctx.ui.notify("Usage: /checkpoint-notify on|off|status", "warning");
        return;
      }
      config.notify = value === "on";
      writeConfig(config);
      ctx.ui.notify(`checkpoint notify: ${config.notify ? "on" : "off"}`, "info");
    },
  });

  pi.registerCommand("checkpoint", {
    description: "Save patch checkpoint and optionally commit: /checkpoint [label]",
    handler: async (args, ctx) => {
      try {
        const cp = await saveCheckpoint(ctx.cwd, args.trim() || "manual");
        ctx.ui.notify(`Checkpoint patch saved: ${cp.id}\n${cp.patchPath}\n\n${cp.status || "No working-tree changes."}`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("checkpoint-commit", {
    description: "Immediately commit current changes: /checkpoint-commit [commit title]",
    handler: async (args, ctx) => {
      const old = readConfig();
      const temp = { ...old, mode: "continuous" as const };
      writeConfig(temp);
      const result = await autoCommit(ctx, "manual", { manualSubject: args.trim() || undefined });
      writeConfig(old);
      if (result.skipped) {
        ctx.ui.notify(`No auto-commit created: ${result.reason}`, "info");
      } else if ("error" in result && result.error) {
        ctx.ui.notify(`Auto-commit failed:\n${result.error}`, "error");
      } else {
        ctx.ui.notify(`Auto-commit created: ${result.subject} (${result.sha})`, "info");
      }
    },
  });

  pi.registerCommand("diff", {
    description: "Show current git diff summary",
    handler: async (_args, ctx) => {
      const status = await sh(ctx.cwd, "git status --short && git diff --stat && git diff --cached --stat");
      ctx.ui.notify(status.stdout || status.stderr || "No diff.", status.ok ? "info" : "error");
    },
  });

  pi.registerCommand("checkpoints", {
    description: "List saved Pi patch checkpoints",
    handler: async (_args, ctx) => {
      const items = await listCheckpoints(ctx.cwd);
      if (!items.length) {
        ctx.ui.notify("No patch checkpoints saved.", "info");
        return;
      }
      ctx.ui.notify(items.slice(-20).join("\n"), "info");
    },
  });

  pi.registerCommand("revert-last", {
    description: "Revert working tree to HEAD after saving a safety patch checkpoint",
    handler: async (_args, ctx) => {
      try {
        const cp = await saveCheckpoint(ctx.cwd, "before-revert-last");
        const result = await sh(ctx.cwd, "git reset --hard HEAD && git clean -fd");
        ctx.ui.notify(`Saved safety checkpoint first: ${cp.patchPath}\n\n${result.stdout}\n${result.stderr}`, result.ok ? "info" : "error");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("checkpoint-show", {
    description: "Show latest patch checkpoint path/content head",
    handler: async (_args, ctx) => {
      const path = await latestCheckpoint(ctx.cwd);
      if (!path || !existsSync(path)) {
        ctx.ui.notify("No checkpoint patch found.", "info");
        return;
      }
      const content = await readFile(path, "utf8");
      ctx.ui.notify(`${path}\n\n${content.slice(0, 12000)}`, "info");
    },
  });
}
