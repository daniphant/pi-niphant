import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync as fsMkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "extensions", "pi-checkpoint.json");

type CheckpointMode = "continuous" | "explicit" | "off";

interface Config {
  mode: CheckpointMode;
  includePiArtifacts: boolean;
  notify: boolean;
}

const DEFAULT_CONFIG: Config = {
  mode: "continuous",
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

function summarizeStatus(status: string) {
  const lines = status.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const allFiles = lines.map((line) => line.replace(/^..\s+/, ""));
  const files = allFiles.slice(0, 12);
  return {
    count: lines.length,
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

function commitSubject(status: string) {
  const summary = summarizeStatus(status);
  if (summary.count === 0) return "Update working tree";
  if (summary.count === 1) return `Update ${summary.allFiles[0]}`;
  const topLevel = commonTopLevel(summary.allFiles);
  if (topLevel) return `Update ${topLevel} (${summary.count} files)`;
  return `Update ${summary.count} files`;
}

function commitMessage(ctx: ExtensionContext, status: string) {
  const summary = summarizeStatus(status);
  const session = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
  return `${commitSubject(status)}\n\n[gstack-context]\nSource: pi-checkpoint continuous auto-commit\nSession: ${session}\nModel: ${model}\nChanged files: ${summary.count}\n\nFiles:\n${summary.text}\n\nDecisions: see Pi session transcript and workflow files for reasoning.\nRemaining work: continue from latest Pi message / workflow stage.\n[/gstack-context]\n`;
}

async function autoCommit(ctx: ExtensionContext, reason: string) {
  const config = readConfig();
  if (config.mode !== "continuous") return { skipped: true, reason: `mode=${config.mode}` };

  const inside = await sh(ctx.cwd, "git rev-parse --is-inside-work-tree");
  if (!inside.ok || inside.stdout.trim() !== "true") return { skipped: true, reason: "not a git repository" };

  const statusBefore = await gitStatus(ctx.cwd);
  if (!statusBefore) return { skipped: true, reason: "no changes" };

  const addCommand = config.includePiArtifacts
    ? "git add -A && git reset -- .pi/checkpoints .pi/workflows .pi/plans 2>/dev/null || true"
    : "git add -A && git reset -- .pi 2>/dev/null || true";
  await sh(ctx.cwd, addCommand);

  const staged = await sh(ctx.cwd, "git diff --cached --name-only");
  if (!staged.ok || !staged.stdout.trim()) return { skipped: true, reason: "no staged changes after filters" };

  const message = commitMessage(ctx, statusBefore);
  const dir = await checkpointDir(ctx.cwd);
  const messagePath = join(dir, `${stamp()}-commit-message.txt`);
  await writeFile(messagePath, message, "utf8");
  const commit = await sh(ctx.cwd, `git commit -F ${JSON.stringify(messagePath)}`);
  await unlink(messagePath).catch(() => undefined);
  if (!commit.ok) return { skipped: false, error: commit.stderr || commit.stdout };

  const sha = await sh(ctx.cwd, "git rev-parse --short HEAD");
  return { skipped: false, sha: sha.stdout.trim(), output: commit.stdout.trim(), reason };
}

export default function checkpointExtension(pi: ExtensionAPI) {
  pi.on("agent_end", async (_event, ctx) => {
    const result = await autoCommit(ctx, "agent_end");
    const config = readConfig();
    if (!config.notify || !ctx.hasUI || result.skipped) return;
    if ("error" in result && result.error) {
      ctx.ui.notify(`Auto-commit failed:\n${result.error.slice(-2000)}`, "warning");
      return;
    }
    ctx.ui.notify(`Auto-commit created: ${result.sha}`, "info");
  });

  pi.registerCommand("checkpoint-mode", {
    description: "Configure checkpoint mode: /checkpoint-mode continuous|explicit|off|status",
    handler: async (args, ctx) => {
      const config = readConfig();
      const mode = args.trim() as CheckpointMode | "status" | "";
      if (!mode || mode === "status") {
        ctx.ui.notify(`Checkpoint mode: ${config.mode}\nincludePiArtifacts: ${config.includePiArtifacts}\nnotify: ${config.notify}\nconfig: ${CONFIG_PATH}`, "info");
        return;
      }
      if (!["continuous", "explicit", "off"].includes(mode)) {
        ctx.ui.notify("Usage: /checkpoint-mode continuous|explicit|off|status", "warning");
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
    description: "Immediately commit current changes",
    handler: async (_args, ctx) => {
      const old = readConfig();
      const temp = { ...old, mode: "continuous" as const };
      writeConfig(temp);
      const result = await autoCommit(ctx, "manual");
      writeConfig(old);
      if (result.skipped) {
        ctx.ui.notify(`No auto-commit created: ${result.reason}`, "info");
      } else if ("error" in result && result.error) {
        ctx.ui.notify(`Auto-commit failed:\n${result.error}`, "error");
      } else {
        ctx.ui.notify(`Auto-commit created: ${result.sha}`, "info");
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
