import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { getAgentDefinition, inferDelegatedAgentsFromText } from "./agents.ts";
import { renderDelegatedAgentWidget, showDelegatedAgentsOverlay } from "./overlay.ts";
import { cancelDelegatedRuns, formatDelegatedRunResult, queueDelegatedAgentSteer, runDelegatedAgents, summarizeRunForJobs } from "./orchestrator.ts";
import type { DelegatedAgentTask } from "./schema.ts";
import { listRunStatuses, readRunStatus } from "./status.ts";

const POLL_INTERVAL_MS = 1000;

function shouldRouteToSpawnSkill(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.startsWith("/") || normalized.startsWith("!")) return false;

  // Keep delegated-agent routing strictly opt-in. In particular, do not
  // auto-route consensus/review/browser requests to the spawn-agent skill;
  // those have direct tools/workflows and should not be hijacked here.
  return /\bspawn\b.*\bagents?\b/.test(normalized);
}

function buildDelegationAck(tasks: DelegatedAgentTask[], cwd?: string): string {
  const labels = tasks
    .map((task) => getAgentDefinition(task.agent, { cwd, task: task.task }).displayName)
    .join(", ");
  return `Delegating to ${tasks.length} agent${tasks.length === 1 ? "" : "s"}: ${labels}. Waiting for results now.`;
}

export default function delegatedAgentsExtension(pi: ExtensionAPI) {
  let latestCtx: ExtensionContext | null = null;
  let sessionId = `session-${Date.now().toString(36)}`;
  let poller: ReturnType<typeof setInterval> | null = null;
  let latestRunId: string | null = null;
  let overlayController:
    | ReturnType<typeof showDelegatedAgentsOverlay>
    | null = null;

  const getCurrentRun = (ctx: ExtensionContext) => {
    const runs = listRunStatuses(ctx.cwd, sessionId);
    const active = runs.find((run) => run.state === "queued" || run.state === "running");
    if (active) return active;
    if (latestRunId) return readRunStatus(ctx.cwd, latestRunId);
    return runs[0] ?? null;
  };

  const ensureOverlayController = (ctx: ExtensionContext, focusOnShow = true) => {
    if (overlayController?.isAlive()) return overlayController;
    overlayController = showDelegatedAgentsOverlay(
      ctx,
      () => getCurrentRun(ctx),
      {
        focusOnShow,
        onClose: () => {
          overlayController = null;
        },
      },
    );
    return overlayController;
  };

  const refreshUi = () => {
    const ctx = latestCtx;
    if (!ctx) return;
    renderDelegatedAgentWidget(ctx, listRunStatuses(ctx.cwd, sessionId));
  };

  const startPolling = () => {
    if (poller) return;
    poller = setInterval(refreshUi, POLL_INTERVAL_MS);
    poller.unref?.();
    refreshUi();
  };

  const stopPolling = () => {
    if (!poller) return;
    clearInterval(poller);
    poller = null;
  };

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    sessionId = ctx.sessionManager.getSessionFile() ?? `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    startPolling();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    latestCtx = ctx;
    stopPolling();
    overlayController?.hide();
    overlayController = null;
    if (ctx.hasUI) {
      ctx.ui.setWidget("delegated-agents", undefined);
      ctx.ui.setStatus("delegated-agents", undefined);
    }
  });

  pi.on("input", async (event) => {
    if (event.source === "extension") return { action: "continue" as const };
    if (!shouldRouteToSpawnSkill(event.text)) return { action: "continue" as const };
    return {
      action: "transform" as const,
      text: `/skill:spawn-agent ${event.text}`,
      images: event.images,
    };
  });

  pi.registerCommand("delegated-agents-jobs", {
    description: "Show delegated agent runs for this session",
    handler: async (_args, ctx) => {
      const runs = listRunStatuses(ctx.cwd, sessionId);
      if (runs.length === 0) {
        ctx.ui.notify("No delegated agent runs for this session.", "info");
        return;
      }
      ctx.ui.notify(runs.slice(0, 8).map((run) => `${run.runId} | ${summarizeRunForJobs(run)}`).join("\n"), "info");
    },
  });

  pi.registerCommand("delegated-agents-overlay", {
    description: "Show or focus the delegated agents overlay",
    handler: async (_args, ctx) => {
      const controller = ensureOverlayController(ctx, true);
      controller.show();
      controller.focus();
    },
  });

  pi.registerCommand("delegated-agents-steer", {
    description: "Steer running delegated agents: /delegated-agents-steer <run-id|latest> <agent-id|all> <instruction>",
    handler: async (args, ctx) => {
      const tokens = args.split(/\s+/).filter(Boolean);
      if (tokens.length < 3) {
        ctx.ui.notify("Usage: /delegated-agents-steer <run-id|latest> <agent-id|all> <instruction>", "error");
        return;
      }

      const [runRef, selector, ...instructionParts] = tokens;
      const instruction = instructionParts.join(" ").trim().replace(/^['\"]|['\"]$/g, "");
      if (!instruction) {
        ctx.ui.notify("Steering instruction cannot be empty.", "error");
        return;
      }

      const runId = runRef === "latest"
        ? listRunStatuses(ctx.cwd, sessionId).find((run) => run.state === "queued" || run.state === "running")?.runId
        : runRef;

      if (!runId) {
        ctx.ui.notify("No running delegated agent run found.", "error");
        return;
      }

      try {
        const queued = queueDelegatedAgentSteer({ cwd: ctx.cwd, runId, selector, instruction });
        if (queued.queued === 0) {
          ctx.ui.notify(`Matched ${queued.matched} delegated agent${queued.matched === 1 ? "" : "s"}, but none are currently running.`, "warning");
          return;
        }
        ctx.ui.notify(`Queued steer for ${queued.queued} delegated agent${queued.queued === 1 ? "" : "s"}: ${queued.targets.join(", ")}`, "info");
        refreshUi();
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("run-agent", {
    description: "Run a delegated agent manually: /run-agent <agent> <task>",
    handler: async (args, ctx) => {
      const [agent, ...rest] = args.split(/\s+/).filter(Boolean);
      const task = rest.join(" ").trim();
      if (!agent || !task) {
        ctx.ui.notify("Usage: /run-agent <agent> <task>", "error");
        return;
      }
      ctx.ui.notify(buildDelegationAck([{ agent, task }], ctx.cwd), "info");
      const result = await runDelegatedAgents({ ctx, agents: [{ agent, task }], sessionId });
      latestRunId = result.runId;
      ctx.ui.notify(formatDelegatedRunResult(result), result.success ? "info" : "error");
    },
  });

  pi.registerShortcut("ctrl+shift+b", {
    description: "Toggle delegated agents overlay",
    handler: async (ctx) => {
      const controller = ensureOverlayController(ctx, true);
      if (controller.isVisible()) {
        controller.hide();
        return;
      }
      controller.show();
      controller.focus();
    },
  });

  pi.registerShortcut("ctrl+shift+x", {
    description: "Cancel all running delegated agents for this session",
    handler: async (ctx) => {
      const cancelled = cancelDelegatedRuns(ctx.cwd, sessionId);
      if (cancelled.agents > 0) {
        ctx.ui.notify(`Cancelling ${cancelled.agents} delegated agent${cancelled.agents === 1 ? "" : "s"} across ${cancelled.runs} run${cancelled.runs === 1 ? "" : "s"}.`, "info");
      } else {
        ctx.ui.notify("No delegated agents are currently running.", "info");
      }
    },
  });

  pi.registerTool({
    name: "run_delegated_agents",
    label: "Run Delegated Agents",
    description: "Run one or more delegated Pi agents, wait for them to finish, and return their structured results.",
    promptSnippet: "Delegate read-only exploratory or review work to one or more specialist agents and wait for the results.",
    promptGuidelines: [
      "Use this tool when the user wants one or more specialist agents to inspect a repo, plan, or subsystem.",
      "Prefer blocking delegated execution so the parent waits for the results in the same turn.",
      "Use parallel mode when multiple independent agents can work at the same time.",
    ],
    parameters: Type.Object({
      agents: Type.Array(Type.Object({
        agent: Type.String({ description: "Agent profile name or role label. Unknown names are resolved to dynamic delegated profiles." }),
        task: Type.String({ description: "Clear delegated task for that agent" }),
        model: Type.Optional(Type.String({ description: "Optional Pi model override for the child agent" })),
      }), { minItems: 1 }),
      mode: Type.Optional(Type.Union([Type.Literal("parallel"), Type.Literal("sequential")], { description: "Execution mode" })),
      blocking: Type.Optional(Type.Boolean({ description: "Whether the parent should wait for all delegated agents. Defaults to true." })),
      synthesize: Type.Optional(Type.Boolean({ description: "Whether to include a merged high-level summary." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      latestCtx = ctx;
      const agents = params.agents.map((item) => ({ agent: item.agent, task: item.task, model: item.model }));
      const result = await runDelegatedAgents({
        ctx,
        agents,
        mode: params.mode,
        blocking: params.blocking,
        synthesize: params.synthesize,
        sessionId,
      });
      latestRunId = result.runId;
      refreshUi();
      return {
        content: [{ type: "text", text: formatDelegatedRunResult(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "infer_and_run_delegated_agents",
    label: "Infer And Run Delegated Agents",
    description: "Infer appropriate delegated agents from a natural-language request and run them.",
    promptSnippet: "Infer specialist agents from a natural-language request, then delegate and wait.",
    promptGuidelines: [
      "Useful when the user asks for delegated work but does not specify the exact agent names.",
    ],
    parameters: Type.Object({
      request: Type.String({ description: "Natural-language request to map to delegated agents" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      latestCtx = ctx;
      const agents = inferDelegatedAgentsFromText(params.request, { cwd: ctx.cwd });
      const result = await runDelegatedAgents({ ctx, agents, sessionId });
      latestRunId = result.runId;
      refreshUi();
      return {
        content: [{ type: "text", text: `${buildDelegationAck(agents, ctx.cwd)}\n\n${formatDelegatedRunResult(result)}` }],
        details: { inferredAgents: agents, ...result },
      };
    },
  });
}
