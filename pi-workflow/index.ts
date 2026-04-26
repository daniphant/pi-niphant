import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describeCwd, workflowPreflight } from "./niphant/preflight.js";
import { doneCommand, listCommand, statusCommand, terminalCommand } from "./niphant/commands.js";
import { handoffText } from "./niphant/handoff.js";
import type { WorkspaceRecord } from "./niphant/types.js";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const slugStopWords = new Set([
  "about", "after", "again", "also", "and", "are", "auto", "bad", "because", "been", "being", "but", "can", "could", "does", "doing", "easier", "for", "from", "generated", "get", "got", "had", "has", "have", "how", "into", "just", "let", "like", "look", "looks", "make", "making", "now", "please", "propose", "really", "should", "something", "that", "the", "then", "there", "this", "through", "try", "understand", "using", "was", "way", "we", "what", "when", "where", "why", "with", "work", "workflow", "workflows", "would", "you",
]);

const slugActionWords = [
  "fix", "debug", "repair", "rename", "shorten", "simplify", "improve", "add", "remove", "update", "refactor", "implement", "support", "prevent", "handle", "create", "resume", "validate",
];

const slugPreferredNouns = new Set([
  "auth", "browser", "bundle", "checkpoint", "commit", "commands", "command", "consensus", "diagnostics", "errors", "handoff", "names", "name", "plan", "review", "slug", "slugs", "spec", "worktree", "worktrees",
]);

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

function inferWorkflowSlug(request: string) {
  const normalized = request
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const rawTokens = normalized.match(/[a-z0-9]+/g) ?? [];
  const tokens = rawTokens
    .map((token) => token === "pi" ? "" : token.replace(/^pi(?=[a-z0-9]{3,})/, ""))
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !/^[a-f0-9]{7,}$/.test(token));
  const scored = new Map<string, { token: string; score: number; first: number }>();
  tokens.forEach((token, index) => {
    if (slugStopWords.has(token)) return;
    const existing = scored.get(token);
    const next = existing ?? { token, score: 0, first: index };
    next.score += 1;
    if (slugPreferredNouns.has(token)) next.score += 3;
    if (slugActionWords.includes(token)) next.score += 4;
    if (token.length > 14) next.score -= 2;
    scored.set(token, next);
  });

  const firstAction = [...scored.values()]
    .filter((item) => slugActionWords.includes(item.token))
    .sort((a, b) => a.first - b.first)[0]?.token;
  const selected: string[] = [];
  if (firstAction) selected.push(firstAction);
  const ranked = [...scored.values()]
    .filter((item) => item.token !== firstAction && !slugActionWords.includes(item.token))
    .sort((a, b) => b.score - a.score || a.first - b.first);
  for (const item of ranked) {
    if (selected.length >= 4) break;
    selected.push(item.token);
  }
  if (selected.length < 2) {
    for (const token of tokens) {
      if (selected.includes(token) || slugStopWords.has(token)) continue;
      selected.push(token);
      if (selected.length >= 2) break;
    }
  }
  return slugify(selected.join("-"), 32);
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

function stageContextGuard(stage: string, allowed: string[], strictStage4 = false) {
  const allowedText = allowed.join(", ");
  const strictText = strictStage4
    ? " For planned Stage 4 execution, bootstrap by reading workflow.toml first, then workflow.plan.md. Do not read workflow.spec.md, workflow.research.md, or other workflow-stage skill docs for context unless refusing or debugging a missing prerequisite requires it."
    : "";
  return `Context hygiene (${stage}): Do not read unrelated SKILL.md files or enumerate installed skills. Use only the invoked workflow skill plus these workflow artifacts: ${allowedText}. Only load another skill when the user explicitly requests it or when that skill is directly required for validation/tooling.${strictText}`;
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
  return { id, ...workflowPaths(join(dir, workflowFileNames.state)) };
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

function sendStageOnePrompt(pi: ExtensionAPI, workflow: WorkflowPaths, planName: string, request: string) {
  pi.sendUserMessage(`/skill:workflow-brainstorm\n\n${stageContextGuard("Stage 1 research", ["workflow.research.md", "workflow.md", "workflow.toml for file references only"])}\n\nStart Stage 1 Research for this request. Use and continuously update this workflow bundle:\n${workflowSummary(workflow)}\n\nThe concise workflow slug is: ${planName}.\n\nRequest:\n${request}\n\nInterview me relentlessly when user-preference decisions remain, but first inspect code directly for anything you can answer yourself. Ask exactly one question at a time, include your recommended answer, and stop the turn after the question. Do not dump multiple questions. Do not finalize Stage 1 with a spec/plan handoff while blocking product, UX, scope, risk, security/privacy, or API-compatibility decisions remain. For non-trivial product/API/architecture/UX work, usually ask at least one question before the final handoff unless the request already resolves every important preference. Do not implement code yet. When the interview has converged, record the complete Complexity / Route Recommendation and stop with a confirmation-oriented handoff.`);
}

function specPrompt(workflow: WorkflowPaths) {
  return `/skill:workflow-spec\n\n${stageContextGuard("Stage 2 spec", ["workflow.research.md", "workflow.spec.md"])}\n\nRun Stage 2 Spec for this workflow bundle:\n${workflowSummary(workflow)}\n\nValidate the route decision in workflow.research.md first. Refuse if Spec is skipped unless the user explicitly overrides. Draft/finalize only workflow.spec.md. Consensus is optional/prompted, never automatic; when appropriate ask whether to run PAL consensus before browser review. Browser annotation/user review of the produced spec is mandatory after consensus is completed, declined, bypassed after failure, or skipped by route. Apply all feedback to the spec markdown. Do not implement code and do not use workflow.toml for spec state.`;
}

function planPrompt(workflow: WorkflowPaths) {
  return `/skill:workflow-plan\n\n${stageContextGuard("Stage 3 planning", ["workflow.research.md", "workflow.spec.md when required", "workflow.plan.md", "workflow.toml for task-state output only"])}\n\nRun Stage 3 Implementation Planning for this workflow bundle:\n${workflowSummary(workflow)}\n\nValidate the route decision first. Plan from workflow.spec.md when spec is required/finalized, or from workflow.research.md when the route intentionally skipped spec and research is sufficient. Refuse with targeted questions if prerequisites are missing. Consensus is optional/prompted, never automatic; ask when recommended by route, then always run mandatory browser annotation/user review on the produced plan after consensus is completed, declined, bypassed after failure, or skipped. Apply all feedback to the plan markdown, then populate workflow.toml with execution task state only. Do not implement code.`;
}

function executionPrompt(commandName: "workflow-execute" | "workflow-implement", workflow: WorkflowPaths) {
  const aliasNote = commandName === "workflow-implement"
    ? "This legacy command is a thin alias for /workflow-execute; use the same execution semantics."
    : "Use the preferred /workflow-execute semantics.";
  return `/skill:workflow-implement\n\n${aliasNote}\n\n${stageContextGuard("Stage 4 execution", ["workflow.toml", "workflow.plan.md", "workflow.research.md only for explicitly trivial marker verification"], true)}\n\nBegin Stage 4 Execution from this workflow reference:\n${workflowSummary(workflow)}\n\nFor planned workflows, read workflow.toml first for execution/task state and use workflow.plan.md as the authoritative implementation instructions. Do not depend on workflow.spec.md. Verify the plan records required browser review before executing.\n\nFor explicitly trivial research-only workflows, execute from workflow.research.md only if every required marker is present: Complexity: trivial; Spec: skipped; Plan: skipped; Consensus: none; Browser review: skipped_for_trivial; Execution source: research; Trivial execution approved: true; Workflow task tracking: skipped_for_trivial. If any marker is missing or incompatible, refuse with a missing-marker list and suggest /workflow-plan <workflow>.\n\nImplement task-by-task when task tracking is enabled, update workflow.toml statuses/timestamps/results, run diagnostics/tests, use browser/E2E validation when relevant, and summarize final results.`;
}

function readWorkflowFile(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function getRouteLine(research: string, label: string) {
  return research.match(new RegExp(`^- ${label}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
}

function sectionHasContent(markdown: string, heading: string) {
  const start = markdown.indexOf(heading);
  if (start < 0) return false;
  const afterHeading = markdown.slice(start + heading.length);
  const nextHeading = afterHeading.search(/\n##\s+/);
  const section = nextHeading >= 0 ? afterHeading.slice(0, nextHeading) : afterHeading;
  return section.trim().length > 0;
}

function workflowContinuationPrompt(workflow: WorkflowPaths): { label: string; prompt: string } | null {
  const research = readWorkflowFile(workflow.research);
  const spec = readWorkflowFile(workflow.spec);
  const plan = readWorkflowFile(workflow.plan);
  const state = readWorkflowFile(workflow.state);
  if (!research.includes("## Complexity / Route Recommendation")) return null;

  const specRoute = getRouteLine(research, "Spec");
  const planRoute = getRouteLine(research, "Plan");
  const browserRoute = getRouteLine(research, "Browser review");
  const executionSource = getRouteLine(research, "Execution source");
  const trivialApproved = getRouteLine(research, "Trivial execution approved");
  const workflowTracking = getRouteLine(research, "Workflow task tracking");

  const planFinalized = sectionHasContent(plan, "## Browser Review Feedback") && /\[\[tasks\]\]/.test(state);
  if (planFinalized) return { label: "execution", prompt: executionPrompt("workflow-execute", workflow) };

  const specFinalized = sectionHasContent(spec, "## Browser Review Feedback");
  if (/^required\b/.test(specRoute)) {
    if (!specFinalized) return { label: "spec", prompt: specPrompt(workflow) };
    return { label: "plan", prompt: planPrompt(workflow) };
  }

  const explicitlyTrivial = /^skipped\b/.test(specRoute)
    && /^skipped\b/.test(planRoute)
    && browserRoute === "skipped_for_trivial"
    && executionSource === "research"
    && trivialApproved === "true"
    && workflowTracking === "skipped_for_trivial";
  if (explicitlyTrivial) return { label: "execution", prompt: executionPrompt("workflow-execute", workflow) };

  if (/^skipped\b/.test(specRoute) || /^required\b/.test(planRoute)) {
    return { label: "plan", prompt: planPrompt(workflow) };
  }

  return null;
}

function continueWorkflow(pi: ExtensionAPI, workflow: WorkflowPaths) {
  const continuation = workflowContinuationPrompt(workflow);
  if (!continuation) return false;
  pi.sendUserMessage(continuation.prompt);
  return true;
}

async function switchToNiphantWorkspace(ctx: ExtensionCommandContext, workspace: WorkspaceRecord) {
  await ctx.waitForIdle();
  const sourceSession = ctx.sessionManager.getSessionFile();
  if (!sourceSession) {
    ctx.ui.notify(`Created niphant workspace but this Pi session is not persisted, so it cannot be moved without losing context.\n${handoffText(workspace)}`, "warning");
    return;
  }

  const sessionManager = SessionManager.forkFrom(sourceSession, workspace.worktreePath);
  sessionManager.appendSessionInfo(`ni: ${workspace.taskSlug}`);
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    ctx.ui.notify(`Created niphant workspace but could not fork the current Pi session.\n${handoffText(workspace)}`, "warning");
    return;
  }

  await ctx.switchSession(sessionFile, {
    withSession: async (nextCtx) => {
      nextCtx.ui.notify(`Moved Pi to niphant workspace '${workspace.taskSlug}' with current conversation preserved:\n${workspace.worktreePath}`, workspace.setupStatus === "failed" ? "warning" : "info");
    },
  });
}

async function niphantCheckoutHandler(args: string, ctx: ExtensionCommandContext) {
  const task = args.trim();
  if (!task) {
    ctx.ui.notify("Usage: /ni <task> or /niphant-checkout <task>", "warning");
    return;
  }

  const preflight = workflowPreflight(ctx.cwd, task, process.env);
  if (preflight.mode === "blocked") {
    ctx.ui.notify(preflight.message, "warning");
    return;
  }
  if (preflight.mode === "created" || preflight.mode === "continued") {
    await switchToNiphantWorkspace(ctx, preflight.workspace);
    return;
  }

  const current = describeCwd(ctx.cwd, process.env);
  if (current) {
    ctx.ui.notify(`Already inside niphant workspace '${current.taskSlug}':\n${current.worktreePath}`, "info");
    return;
  }
  ctx.ui.notify(`${preflight.message} Start Pi through the ni launcher to create niphant worktrees.`, "warning");
}

export default function workflowExtension(pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" as const };
    if (event.text.trim().toLowerCase() !== "continue") return { action: "continue" as const };

    const workflow = resolveWorkflowArg(ctx.cwd, "");
    if (!workflow) return { action: "continue" as const };
    if (!continueWorkflow(pi, workflow)) return { action: "continue" as const };
    ctx.ui.notify(`Continuing workflow: ${workflow.dir}`, "info");
    return { action: "handled" as const };
  });

  pi.registerCommand("workflow", {
    description: "Start a durable workflow; unnamed requests auto-infer a concise slug",
    handler: async (args, ctx) => {
      const parsed = parseWorkflowArgs(args);
      const request = parsed.request;
      const planName = parsed.explicitName ? parsed.planName : inferWorkflowSlug(request);
      if (!request) {
        ctx.ui.notify("Usage: /workflow <description> or /workflow --name concise-slug -- <description>", "warning");
        return;
      }

      const { explicitName, slugWasValid, rawName } = parsed;
      if (!explicitName) {
        ctx.ui.notify(`Inferred workflow slug '${planName}' from request. Use /workflow --name <slug> -- <description> to override.`, "info");
      }
      if (explicitName && !slugWasValid) {
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
      sendStageOnePrompt(pi, workflow, planName, request);
    },
  });

  pi.registerCommand("workflow-latest", {
    description: "Show latest .pi workflow bundle",
    handler: async (_args, ctx) => {
      const latest = latestWorkflow(ctx.cwd);
      ctx.ui.notify(latest ? workflowSummary(workflowPaths(latest)) : "No workflow found under ~/.pi/agent/workflows for this project", latest ? "info" : "warning");
    },
  });

  pi.registerCommand("workflow-continue", {
    description: "Continue the latest workflow to its next stage",
    handler: async (args, ctx) => {
      const workflow = resolveWorkflowArg(ctx.cwd, args);
      if (!workflow) {
        ctx.ui.notify("No workflow found. Usage: /workflow-continue [workflow-dir|workflow.toml]", "warning");
        return;
      }
      if (!continueWorkflow(pi, workflow)) {
        ctx.ui.notify("Could not infer the next workflow stage. Use /workflow-spec, /workflow-plan, or /workflow-execute explicitly.", "warning");
        return;
      }
      ctx.ui.notify(`Continuing workflow: ${workflow.dir}`, "info");
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
      pi.sendUserMessage(specPrompt(workflow));
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
      pi.sendUserMessage(planPrompt(workflow));
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
        pi.sendUserMessage(`/skill:research-plan-implement\n\n${stageContextGuard("browser review annotation application", ["reviewed workflow artifact", "annotations file", "workflow bundle paths listed below"])}\n\nApply these browser review annotations to the reviewed workflow artifact. Apply every deletion, edit, annotation, and general comment concretely. Then ask whether another browser review round is needed.\n\n${workflowSummary(workflow)}\n\nReviewed file:\n${reviewFile}\n\nAnnotations file:\n${result.annotationsPath}\n\nAnnotations:\n${annotations}`);
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

  pi.registerCommand("ni", {
    description: "Create or resume a niphant worktree without starting a workflow",
    handler: async (args, ctx) => niphantCheckoutHandler(args, ctx),
  });

  pi.registerCommand("niphant-checkout", {
    description: "Create or resume a niphant worktree without starting a workflow",
    handler: async (args, ctx) => niphantCheckoutHandler(args, ctx),
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
