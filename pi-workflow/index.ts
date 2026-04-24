import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { workflowPreflight } from "./niphant/preflight.js";
import { doneCommand, listCommand, statusCommand, terminalCommand } from "./niphant/commands.js";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "workflow";
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}

function projectSlug(cwd: string) {
  return cwd.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown-project";
}

function workflowsDir(cwd: string) {
  return join(homedir(), ".pi", "agent", "workflows", projectSlug(cwd));
}

function latestWorkflow(cwd: string): string | null {
  const root = workflowsDir(cwd);
  if (!existsSync(root)) return null;
  const candidates: string[] = [];
  for (const entry of readdirSync(root)) {
    const file = join(root, entry, "workflow.md");
    if (existsSync(file)) candidates.push(file);
  }
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function createWorkflow(cwd: string, request: string) {
  const id = `${timestampId()}-${slugify(request)}`;
  const dir = join(workflowsDir(cwd), id);
  mkdirSync(dir, { recursive: true });
  const template = readFileSync(join(__dirname, "templates", "workflow.md"), "utf8");
  const title = request.trim().split(/\s+/).slice(0, 10).join(" ") || id;
  const content = template
    .replaceAll("{{id}}", id)
    .replaceAll("{{title}}", title)
    .replaceAll("{{createdAt}}", new Date().toISOString())
    .replaceAll("{{request}}", request.trim() || "(no request supplied)");
  const file = join(dir, "workflow.md");
  writeFileSync(file, content, "utf8");
  return { id, dir, file };
}

function runReviewServer(planFile: string): Promise<{ output: string; annotationsPath?: string; url?: string; code: number | null }> {
  return new Promise((resolvePromise) => {
    const server = join(__dirname, "server", "server.mjs");
    const child = spawn("node", [server, planFile], { cwd: process.cwd(), env: process.env });
    let output = "";
    let annotationsPath: string | undefined;
    let url: string | undefined;

    const onData = (data: Buffer) => {
      const text = data.toString();
      output += text;
      const urlMatch = text.match(/PLAN_REVIEW_URL:(\S+)/);
      if (urlMatch) url = urlMatch[1];
      const completeMatch = text.match(/PLAN_REVIEW_COMPLETE:(\S+)/);
      if (completeMatch) annotationsPath = completeMatch[1];
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => resolvePromise({ output, annotationsPath, url, code }));
  });
}

function resolveWorkflowArg(cwd: string, arg: string) {
  const trimmed = arg.trim();
  if (trimmed) return resolve(cwd, trimmed);
  const latest = latestWorkflow(cwd);
  return latest ? resolve(latest) : null;
}

export default function workflowExtension(pi: ExtensionAPI) {
  pi.registerCommand("workflow", {
    description: "Create a durable research/spec/implementation workflow and start planning",
    handler: async (args, ctx) => {
      const request = args.trim();
      if (!request) {
        ctx.ui.notify("Usage: /workflow <description>", "warning");
        return;
      }
      const preflight = workflowPreflight(ctx.cwd, request);
      if (preflight.mode === "blocked") {
        ctx.ui.notify(preflight.message, "warning");
        return;
      }
      if (preflight.mode === "created" || preflight.mode === "continued") {
        ctx.ui.notify(preflight.handoffText ?? preflight.message, preflight.workspace?.setupStatus === "failed" ? "warning" : "info");
        return;
      }

      const workflow = createWorkflow(ctx.cwd, request);
      ctx.ui.notify(`Created user-local workflow: ${workflow.file}`, "info");
      pi.sendUserMessage(`/skill:workflow-brainstorm\n\nStart Stage 1 Research for this request. Use and continuously update this canonical workflow file:\n${workflow.file}\n\nRequest:\n${request}\n\nInterview me aggressively when needed, but first inspect code directly for anything you can answer yourself. Do not implement code yet.`);
    },
  });

  pi.registerCommand("workflow-latest", {
    description: "Show latest .pi workflow file",
    handler: async (_args, ctx) => {
      const latest = latestWorkflow(ctx.cwd);
      ctx.ui.notify(latest ?? "No workflow found under ~/.pi/agent/workflows for this project", latest ? "info" : "warning");
    },
  });

  pi.registerCommand("workflow-spec", {
    description: "Run Stage 2 spec workflow with automatic browser review and consensus",
    handler: async (args, ctx) => {
      const file = resolveWorkflowArg(ctx.cwd, args);
      if (!file || !existsSync(file)) {
        ctx.ui.notify("No workflow file found. Usage: /workflow-spec [path/to/workflow.md]", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:workflow-spec\n\nRun Stage 2 Spec for this workflow file:\n${file}\n\nDraft/finalize the spec, then automatically run browser annotation review and multi-model consensus. Apply all feedback and update stage gates. Do not implement code.`);
    },
  });

  pi.registerCommand("workflow-plan", {
    description: "Run Stage 3 implementation planning with automatic browser review and consensus",
    handler: async (args, ctx) => {
      const file = resolveWorkflowArg(ctx.cwd, args);
      if (!file || !existsSync(file)) {
        ctx.ui.notify("No workflow file found. Usage: /workflow-plan [path/to/workflow.md]", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:workflow-plan\n\nRun Stage 3 Implementation Planning for this workflow file:\n${file}\n\nCreate/finalize the task graph with dependencies, blockers, parallel groups, validation, and rollback. Then automatically run browser annotation review and multi-model consensus. Apply all feedback and update stage gates. Do not implement code.`);
    },
  });

  pi.registerCommand("workflow-review", {
    description: "Open browser annotation UI for a workflow markdown file",
    handler: async (args, ctx) => {
      const file = resolveWorkflowArg(ctx.cwd, args);
      if (!file || !existsSync(file)) {
        ctx.ui.notify("No workflow file found. Usage: /workflow-review [path/to/workflow.md]", "warning");
        return;
      }
      ctx.ui.notify(`Opening browser review for ${file}. Submit annotations in the browser when done.`, "info");
      const result = await runReviewServer(file);
      if (result.annotationsPath && existsSync(result.annotationsPath)) {
        const annotations = readFileSync(result.annotationsPath, "utf8");
        ctx.ui.notify(`Review submitted: ${result.annotationsPath}`, "info");
        pi.sendUserMessage(`/skill:research-plan-implement\n\nApply these browser review annotations to the workflow file. Apply every deletion, edit, annotation, and general comment concretely. Then ask whether another browser review round is needed.\n\nWorkflow file:\n${file}\n\nAnnotations file:\n${result.annotationsPath}\n\nAnnotations:\n${annotations}`);
      } else {
        ctx.ui.notify(`Plan review server exited without annotations.\n${result.output}`, result.code === 0 ? "info" : "error");
      }
    },
  });

  pi.registerCommand("workflow-implement", {
    description: "Begin implementation from finalized workflow file",
    handler: async (args, ctx) => {
      const file = resolveWorkflowArg(ctx.cwd, args);
      if (!file || !existsSync(file)) {
        ctx.ui.notify("No workflow file found. Usage: /workflow-implement [path/to/workflow.md]", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:workflow-implement\n\nBegin Stage 4 Implementation from this finalized workflow file:\n${file}\n\nRead the workflow file first. Verify the spec and implementation plan are finalized or explicitly approved. Then implement task-by-task, update the execution log, run diagnostics/tests, use browser/E2E validation when relevant, and summarize final results.`);
    },
  });

  pi.registerCommand("niphant-list", {
    description: "List niphant workspaces",
    handler: async (_args, ctx) => ctx.ui.notify(listCommand(ctx.cwd), "info"),
  });

  pi.registerCommand("niphant-status", {
    description: "Show current niphant workspace status; use /niphant-status locks to clear stale locks",
    handler: async (args, ctx) => ctx.ui.notify(statusCommand(args.trim() || ctx.cwd), "info"),
  });

  pi.registerCommand("niphant-done", {
    description: "Archive current niphant workspace metadata without deleting git branches/worktrees",
    handler: async (_args, ctx) => ctx.ui.notify(doneCommand(ctx.cwd), "info"),
  });

  pi.registerCommand("niphant-terminal", {
    description: "Print commands for opening another terminal in the current workspace",
    handler: async (_args, ctx) => ctx.ui.notify(terminalCommand(ctx.cwd), "info"),
  });
}
