import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { workflowPreflight } from "./niphant/preflight.js";
import { doneCommand, listCommand, statusCommand, terminalCommand } from "./niphant/commands.js";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

function slugify(input: string, max = 32) {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
  return slug || "workflow";
}

function fallbackPlanName(request: string) {
  const stop = new Set(["a", "an", "and", "are", "as", "be", "because", "for", "from", "have", "how", "i", "in", "into", "is", "it", "of", "on", "or", "our", "that", "the", "their", "this", "to", "we", "with", "would"]);
  const words = request
    .toLowerCase()
    .match(/[a-z0-9]+/g)?.filter((word) => word.length > 1 && !stop.has(word)) ?? [];
  return slugify(words.slice(0, 4).join("-") || request, 32);
}

function parseWorkflowArgs(args: string) {
  const trimmed = args.trim();
  const named = trimmed.match(/^--name(?:=|\s+)([^\s]+)\s+--\s+([\s\S]+)$/);
  if (named) return { request: named[2].trim(), planName: slugify(named[1], 32), explicitName: true };
  return { request: trimmed, planName: fallbackPlanName(trimmed), explicitName: false };
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}

function shortHash(input: string) {
  return createHash("sha1").update(input).digest("hex").slice(0, 7);
}

function projectSlug(cwd: string) {
  const base = slugify(basename(cwd.replace(/\/$/, "")) || "project", 40);
  return `${base}-${shortHash(cwd)}`;
}

function workflowsDir(cwd: string) {
  return join(homedir(), ".pi", "agent", "workflows", projectSlug(cwd));
}

type WorkflowPaths = {
  dir: string;
  index: string;
  state: string;
  research: string;
  spec: string;
  plan: string;
};

const workflowFileNames = {
  index: "workflow.md",
  state: "workflow.toml",
  research: "workflow.research.md",
  spec: "workflow.spec.md",
  plan: "workflow.plan.md",
};

function latestWorkflow(cwd: string): string | null {
  const candidates: string[] = [];
  const root = workflowsDir(cwd);
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const state = join(root, entry, workflowFileNames.state);
    if (existsSync(state)) candidates.push(state);
  }
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function renderTemplate(name: string, replacements: Record<string, string>) {
  let content = readFileSync(join(__dirname, "templates", name), "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}

function workflowPaths(ref: string): WorkflowPaths {
  const resolved = resolve(ref);
  const dir = existsSync(resolved) && statSync(resolved).isDirectory() ? resolved : dirname(resolved);
  const state = join(dir, workflowFileNames.state);
  const index = join(dir, workflowFileNames.index);
  return {
    dir,
    index,
    state,
    research: join(dir, workflowFileNames.research),
    spec: join(dir, workflowFileNames.spec),
    plan: join(dir, workflowFileNames.plan),
  };
}

function workflowSummary(paths: WorkflowPaths) {
  return [
    `Workflow directory: ${paths.dir}`,
    `State: ${paths.state}`,
    `Research: ${paths.research}`,
    `Spec: ${paths.spec}`,
    `Plan: ${paths.plan}`,
  ].join("\n");
}

function createWorkflow(cwd: string, request: string, planName: string) {
  const id = `${timestampId()}-${slugify(planName, 32)}`;
  const dir = join(workflowsDir(cwd), id);
  mkdirSync(dir, { recursive: true });
  const title = planName.split("-").join(" ") || id;
  const replacements = {
    id,
    title,
    createdAt: new Date().toISOString(),
    request: request.trim() || "(no request supplied)",
  };
  for (const name of Object.values(workflowFileNames)) {
    writeFileSync(join(dir, name), renderTemplate(name, replacements), "utf8");
  }
  return { id, dir, ...workflowPaths(join(dir, workflowFileNames.state)) };
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

function resolveWorkflowArg(cwd: string, arg: string): WorkflowPaths | null {
  const trimmed = arg.trim();
  const ref = trimmed ? resolve(cwd, trimmed) : latestWorkflow(cwd);
  if (!ref || !existsSync(ref)) return null;
  const paths = workflowPaths(ref);
  return existsSync(paths.state) ? paths : null;
}

export default function workflowExtension(pi: ExtensionAPI) {
  pi.registerCommand("workflow", {
    description: "Create a durable research/spec/implementation workflow and start planning",
    handler: async (args, ctx) => {
      const { request, planName, explicitName } = parseWorkflowArgs(args);
      if (!request) {
        ctx.ui.notify("Usage: /workflow [--name concise-slug --] <description>", "warning");
        return;
      }
      const preflight = workflowPreflight(ctx.cwd, request, process.env, planName);
      if (preflight.mode === "blocked") {
        ctx.ui.notify(preflight.message, "warning");
        return;
      }
      if (preflight.mode === "created" || preflight.mode === "continued") {
        ctx.ui.notify(preflight.handoffText ?? preflight.message, preflight.workspace?.setupStatus === "failed" ? "warning" : "info");
        return;
      }

      const workflow = createWorkflow(ctx.cwd, request, planName);
      ctx.ui.notify(`Created user-local workflow (${planName}): ${workflow.dir}`, "info");
      const namingNote = explicitName
        ? `The concise workflow slug was provided by the caller: ${planName}.`
        : `No AI-provided workflow slug was supplied, so the script used a deterministic fallback: ${planName}. If you need a better concise slug next time, start with /workflow --name <2-4-word-slug> -- <request>.`;
      pi.sendUserMessage(`/skill:workflow-brainstorm\n\nStart Stage 1 Research for this request. Use and continuously update this workflow bundle:\n${workflowSummary(workflow)}\n\n${namingNote}\n\nRequest:\n${request}\n\nInterview me aggressively when needed, but first inspect code directly for anything you can answer yourself. Do not implement code yet.`);
    },
  });

  pi.registerCommand("workflow-latest", {
    description: "Show latest .pi workflow bundle",
    handler: async (_args, ctx) => {
      const latest = latestWorkflow(ctx.cwd);
      ctx.ui.notify(latest ? workflowSummary(workflowPaths(latest)) : "No workflow found under ~/.pi/agent/workflows for this project", latest ? "info" : "warning");
    },
  });

  pi.registerCommand("workflow-spec", {
    description: "Run Stage 2 spec workflow with automatic consensus then browser review",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-spec [workflow-dir|workflow.toml]", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:workflow-spec\n\nRun Stage 2 Spec for this workflow bundle:\n${workflowSummary(workflow)}\n\nDraft/finalize only the spec file, then automatically run multi-model consensus first, apply required changes, and only then run browser annotation/user review on the spec file. Apply all feedback to the spec markdown. Do not implement code and do not use workflow.toml for spec state.`);
    },
  });

  pi.registerCommand("workflow-plan", {
    description: "Run Stage 3 implementation planning with automatic consensus then browser review",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-plan [workflow-dir|workflow.toml]", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:workflow-plan\n\nRun Stage 3 Implementation Planning for this workflow bundle:\n${workflowSummary(workflow)}\n\nCreate/finalize only the plan file with dependencies, blockers, parallel groups, validation, and rollback. Then automatically run multi-model consensus first, apply required changes, and only then run browser annotation/user review on the plan file. Apply all feedback to the plan markdown, then populate workflow.toml with execution task state only. Do not implement code.`);
    },
  });

  pi.registerCommand("workflow-review", {
    description: "Open browser annotation UI for a workflow markdown file",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-review [workflow-dir|workflow.toml|spec.md|plan.md]", "warning");
        return;
      }
      const trimmed = args.trim();
      const explicitFile = trimmed && existsSync(resolve(ctx.cwd, trimmed)) && statSync(resolve(ctx.cwd, trimmed)).isFile()
        ? resolve(ctx.cwd, trimmed)
        : null;
      const reviewFile = explicitFile && !explicitFile.endsWith(workflowFileNames.state) ? explicitFile : workflow.plan;
      ctx.ui.notify(`Opening browser review for ${reviewFile}. Submit annotations in the browser when done.`, "info");
      const result = await runReviewServer(reviewFile);
      if (result.annotationsPath && existsSync(result.annotationsPath)) {
        const annotations = readFileSync(result.annotationsPath, "utf8");
        ctx.ui.notify(`Review submitted: ${result.annotationsPath}`, "info");
        pi.sendUserMessage(`/skill:research-plan-implement\n\nApply these browser review annotations to the reviewed workflow artifact. Apply every deletion, edit, annotation, and general comment concretely. Then ask whether another browser review round is needed.\n\n${workflowSummary(workflow)}\n\nReviewed file:\n${reviewFile}\n\nAnnotations file:\n${result.annotationsPath}\n\nAnnotations:\n${annotations}`);
      } else {
        ctx.ui.notify(`Plan review server exited without annotations.\n${result.output}`, result.code === 0 ? "info" : "error");
      }
    },
  });

  pi.registerCommand("workflow-implement", {
    description: "Begin implementation from finalized workflow plan/state",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-implement [workflow-dir|workflow.toml]", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:workflow-implement\n\nBegin Stage 4 Implementation from this finalized workflow bundle:\n${workflowSummary(workflow)}\n\nRead workflow.toml first to assess execution/task state, then read the spec and plan files as needed. Implement task-by-task, update workflow.toml task statuses/timestamps/results, run diagnostics/tests, use browser/E2E validation when relevant, and summarize final results.`);
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
