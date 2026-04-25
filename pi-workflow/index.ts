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
const pendingSlugSelectionByCwd = new Map<string, string>();

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

function validateSlug(input: string) {
  const trimmed = input.trim();
  const sanitized = slugify(trimmed, 32);
  const valid = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(sanitized)
    && sanitized.length <= 32
    && !trimmed.includes("..")
    && !/[\\/\s;&|`$<>]/.test(trimmed);
  return { slug: sanitized, valid };
}

function parseWorkflowArgs(args: string) {
  const trimmed = args.trim();
  const named = trimmed.match(/^--name(?:=|\s+)([^\s]+)\s+--\s+([\s\S]+)$/);
  if (named) {
    const validated = validateSlug(named[1]);
    return { request: named[2].trim(), planName: validated.slug, explicitName: true, slugWasValid: validated.valid, rawName: named[1] };
  }
  return { request: trimmed, planName: "", explicitName: false, slugWasValid: false, rawName: "" };
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
  const root = workflowsDir(cwd);
  mkdirSync(root, { recursive: true });
  const base = `${timestampId()}-${slugify(planName, 32)}`;
  let id = base;
  for (let i = 2; existsSync(join(root, id)); i++) id = `${base}-${i}`;
  const dir = join(root, id);
  mkdirSync(dir, { recursive: false });
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

function sendSlugSelection(pi: ExtensionAPI, cwd: string, request: string) {
  pendingSlugSelectionByCwd.set(cwd, request);
  pi.sendUserMessage(`/skill:workflow-start\n\nStart a durable workflow for this request. Choose a concise lowercase kebab-case slug (2-4 words, max 32 chars) and invoke the explicit terminal command form only:\n\n/workflow --name <slug> -- ${request}\n\nDo not call unnamed /workflow again. If you cannot execute slash commands directly, reply with exactly the explicit /workflow --name command.\n\nRequest:\n${request}`);
}

function executionPrompt(commandName: "workflow-execute" | "workflow-implement", workflow: WorkflowPaths) {
  const aliasNote = commandName === "workflow-implement"
    ? "This legacy command is a thin alias for /workflow-execute; use the same execution semantics."
    : "Use the preferred /workflow-execute semantics.";
  return `/skill:workflow-implement\n\n${aliasNote}\n\nBegin Stage 4 Execution from this workflow reference:\n${workflowSummary(workflow)}\n\nFor planned workflows, read workflow.toml first for execution/task state and use workflow.plan.md as the authoritative implementation instructions. Do not depend on workflow.spec.md. Verify the plan records required browser review before executing.\n\nFor explicitly trivial research-only workflows, execute from workflow.research.md only if every required marker is present: Complexity: trivial; Spec: skipped; Plan: skipped; Consensus: none; Browser review: skipped_for_trivial; Execution source: research; Trivial execution approved: true; Workflow task tracking: skipped_for_trivial. If any marker is missing or incompatible, refuse with a missing-marker list and suggest /workflow-plan <workflow>.\n\nImplement task-by-task when task tracking is enabled, update workflow.toml statuses/timestamps/results, run diagnostics/tests, use browser/E2E validation when relevant, and summarize final results.`;
}

export default function workflowExtension(pi: ExtensionAPI) {
  pi.registerCommand("workflow", {
    description: "Start a durable agent-led workflow; unnamed requests route through agent slug selection",
    handler: async (args, ctx) => {
      const { request, planName, explicitName, slugWasValid, rawName } = parseWorkflowArgs(args);
      if (!request) {
        ctx.ui.notify("Usage: /workflow <description> or /workflow --name concise-slug -- <description>", "warning");
        return;
      }

      if (!explicitName) {
        if (pendingSlugSelectionByCwd.has(ctx.cwd)) {
          ctx.ui.notify("Refusing repeated unnamed /workflow while slug selection is pending. The generated follow-up must use: /workflow --name <slug> -- <description>", "warning");
          return;
        }
        sendSlugSelection(pi, ctx.cwd, request);
        return;
      }

      pendingSlugSelectionByCwd.delete(ctx.cwd);
      if (!slugWasValid) {
        ctx.ui.notify(`Slug '${rawName}' was sanitized to '${planName}'. Use lowercase letters, digits, and hyphens only; max 32 chars; no whitespace, path separators, shell metacharacters, or '..'.`, "warning");
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
      pi.sendUserMessage(`/skill:workflow-brainstorm\n\nStart Stage 1 Research for this request. Use and continuously update this workflow bundle:\n${workflowSummary(workflow)}\n\nThe concise workflow slug is: ${planName}.\n\nRequest:\n${request}\n\nInterview me aggressively when needed, but first inspect code directly for anything you can answer yourself. Do not implement code yet. Record the complete Complexity / Route Recommendation and stop with a confirmation-oriented handoff.`);
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
    description: "Run Stage 2 spec workflow when route requires or user overrides it",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-spec [workflow-dir|workflow.toml]", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:workflow-spec\n\nRun Stage 2 Spec for this workflow bundle:\n${workflowSummary(workflow)}\n\nValidate the route decision in workflow.research.md first. Refuse if Spec is skipped unless the user explicitly overrides. Draft/finalize only workflow.spec.md. Consensus is optional/prompted, never automatic; when appropriate ask whether to run PAL consensus before browser review. Browser annotation/user review of the produced spec is mandatory after consensus is completed, declined, bypassed after failure, or skipped by route. Apply all feedback to the spec markdown. Do not implement code and do not use workflow.toml for spec state.`);
    },
  });

  pi.registerCommand("workflow-plan", {
    description: "Run Stage 3 implementation planning from spec or sufficient research route",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-plan [workflow-dir|workflow.toml]", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:workflow-plan\n\nRun Stage 3 Implementation Planning for this workflow bundle:\n${workflowSummary(workflow)}\n\nValidate the route decision first. Plan from workflow.spec.md when spec is required/finalized, or from workflow.research.md when the route intentionally skipped spec and research is sufficient. Refuse with targeted questions if prerequisites are missing. Consensus is optional/prompted, never automatic; ask when recommended by route, then always run mandatory browser annotation/user review on the produced plan after consensus is completed, declined, bypassed after failure, or skipped. Apply all feedback to the plan markdown, then populate workflow.toml with execution task state only. Do not implement code.`);
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

  pi.registerCommand("workflow-execute", {
    description: "Execute a finalized workflow plan or explicitly trivial research-only workflow",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-execute [workflow-dir|workflow.toml|workflow.plan.md|workflow.research.md]", "warning");
        return;
      }
      pi.sendUserMessage(executionPrompt("workflow-execute", workflow));
    },
  });

  pi.registerCommand("workflow-implement", {
    description: "Deprecated alias for /workflow-execute",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-implement [workflow-dir|workflow.toml|workflow.plan.md|workflow.research.md]", "warning");
        return;
      }
      pi.sendUserMessage(executionPrompt("workflow-implement", workflow));
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
