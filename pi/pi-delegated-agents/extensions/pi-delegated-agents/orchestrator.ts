import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getAgentDefinition } from "./agents.ts";
import { renderDelegatedAgentWidget } from "./overlay.ts";
import type {
  ChildStatus,
  DelegatedAgentResult,
  DelegatedAgentTask,
  DelegatedControlCommand,
  DelegatedMode,
  DelegatedRunResult,
  RunStatus,
  RunnerConfig,
} from "./schema.ts";
import {
  aggregateRunStatus,
  ensureBaseDirs,
  getChildDir,
  getOrchestratorPath,
  getRunDir,
  listRunStatuses,
  readRunStatus,
  writeRunStatus,
} from "./status.ts";
import { getJitiCliPath, safeReadJson, sleep, truncate, writeJsonAtomic } from "./utils.ts";

const POLL_INTERVAL_MS = 900;

function makeRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeChildId(shortLabel: string, index: number): string {
  return `${shortLabel}-${index + 1}`;
}

function synthesizeResults(results: DelegatedAgentResult[]): string {
  return results
    .map((result) => `${result.displayName}: ${result.summary}`)
    .join("\n");
}

function formatFinalText(result: DelegatedRunResult): string {
  const parts: string[] = [];
  if (result.synthesizedSummary) {
    parts.push("Overview");
    parts.push("");
    parts.push(result.synthesizedSummary.trim());
    parts.push("");
  }

  for (const item of result.results) {
    parts.push(`${item.displayName}`);
    parts.push("");
    parts.push(item.summary || "(no summary)");
    if (item.keyFindings.length) {
      parts.push("");
      parts.push("Key findings");
      for (const finding of item.keyFindings) parts.push(`- ${finding}`);
    }
    if (item.risks.length) {
      parts.push("");
      parts.push("Risks");
      for (const risk of item.risks) parts.push(`- ${risk}`);
    }
    if (item.recommendedNextSteps.length) {
      parts.push("");
      parts.push("Recommended next steps");
      for (const step of item.recommendedNextSteps) parts.push(`- ${step}`);
    }
    if (item.keyFiles.length) {
      parts.push("");
      parts.push("Key files");
      for (const file of item.keyFiles) parts.push(`- ${file}`);
    }
    parts.push("");
  }

  return parts.join("\n").trim();
}

function childStatusTemplate(params: {
  runId: string;
  index: number;
  cwd: string;
  task: string;
  agentName: string;
  displayName: string;
  shortLabel: string;
  outputLogPath: string;
  resultPath: string;
  controlPath: string;
}): ChildStatus {
  const now = Date.now();
  return {
    id: makeChildId(params.shortLabel, params.index),
    runId: params.runId,
    index: params.index,
    agent: params.agentName,
    displayName: params.displayName,
    shortLabel: params.shortLabel,
    task: params.task,
    cwd: params.cwd,
    state: "queued",
    phase: "Queued",
    startedAt: now,
    updatedAt: now,
    outputLogPath: params.outputLogPath,
    resultPath: params.resultPath,
    controlPath: params.controlPath,
  };
}

function writeInitialRunArtifacts(params: {
  cwd: string;
  runId: string;
  sessionId?: string;
  tasks: DelegatedAgentTask[];
  mode: DelegatedMode;
  blocking: boolean;
  synthesize: boolean;
}): { childStatusPaths: string[]; configPaths: string[] } {
  const runDir = getRunDir(params.cwd, params.runId);
  fs.mkdirSync(runDir, { recursive: true });

  const childStatusPaths: string[] = [];
  const configPaths: string[] = [];

  params.tasks.forEach((task, index) => {
    const definition = getAgentDefinition(task.agent, { cwd: params.cwd, task: task.task });
    const childDir = getChildDir(params.cwd, params.runId, index);
    fs.mkdirSync(childDir, { recursive: true });
    const statusPath = path.join(childDir, "status.json");
    const resultPath = path.join(childDir, "result.json");
    const outputLogPath = path.join(childDir, "output.log");
    const controlPath = path.join(childDir, "control.ndjson");
    fs.writeFileSync(controlPath, "", "utf8");
    childStatusPaths.push(statusPath);

    writeJsonAtomic(statusPath, childStatusTemplate({
      runId: params.runId,
      index,
      cwd: params.cwd,
      task: task.task,
      agentName: definition.name,
      displayName: definition.displayName,
      shortLabel: definition.shortLabel,
      outputLogPath,
      resultPath,
      controlPath,
    }));

    const configPath = path.join(os.tmpdir(), `pi-delegated-agent-${params.runId}-${index}.json`);
    const config: RunnerConfig = {
      runId: params.runId,
      cwd: params.cwd,
      sessionId: params.sessionId,
      child: {
        id: makeChildId(definition.shortLabel, index),
        index,
        task: task.task,
        model: task.model ?? definition.model,
        definition,
        statusPath,
        resultPath,
        outputLogPath,
        controlPath,
      },
    };
    writeJsonAtomic(configPath, config);
    configPaths.push(configPath);
  });

  const status = aggregateRunStatus({
    cwd: params.cwd,
    runId: params.runId,
    sessionId: params.sessionId,
    mode: params.mode,
    blocking: params.blocking,
    synthesize: params.synthesize,
    childStatusPaths,
    startedAt: Date.now(),
  });
  writeRunStatus(params.cwd, params.runId, status);
  writeJsonAtomic(getOrchestratorPath(params.cwd, params.runId), {
    runId: params.runId,
    cwd: params.cwd,
    sessionId: params.sessionId,
    mode: params.mode,
    blocking: params.blocking,
    synthesize: params.synthesize,
    tasks: params.tasks,
    childStatusPaths,
    createdAt: Date.now(),
  });

  return { childStatusPaths, configPaths };
}

function spawnRunner(cwd: string, configPath: string): void {
  const jitiCliPath = getJitiCliPath();
  if (!jitiCliPath) throw new Error("Could not locate jiti CLI required to launch the delegated agent runner.");
  const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "runner.ts");
  const child = spawn(process.execPath, [jitiCliPath, runnerPath, configPath], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function areAllChildrenDone(run: RunStatus): boolean {
  return run.children.length > 0 && run.children.every((child) => child.state === "complete" || child.state === "failed");
}

function refreshRunStatus(params: {
  ctx: ExtensionContext;
  cwd: string;
  runId: string;
  sessionId?: string;
  mode: DelegatedMode;
  blocking: boolean;
  synthesize: boolean;
  childStatusPaths: string[];
}): RunStatus {
  const runStatus = aggregateRunStatus({
    cwd: params.cwd,
    runId: params.runId,
    sessionId: params.sessionId,
    mode: params.mode,
    blocking: params.blocking,
    synthesize: params.synthesize,
    childStatusPaths: params.childStatusPaths,
    startedAt: readRunStatus(params.cwd, params.runId)?.startedAt,
  });
  writeRunStatus(params.cwd, params.runId, runStatus);
  renderDelegatedAgentWidget(params.ctx, listRunStatuses(params.cwd, params.sessionId));
  return runStatus;
}

async function waitForPredicate(params: {
  ctx: ExtensionContext;
  cwd: string;
  runId: string;
  sessionId?: string;
  mode: DelegatedMode;
  blocking: boolean;
  synthesize: boolean;
  childStatusPaths: string[];
  predicate: (run: RunStatus) => boolean;
}): Promise<RunStatus> {
  for (;;) {
    const runStatus = refreshRunStatus(params);
    if (params.predicate(runStatus)) return runStatus;
    await sleep(POLL_INTERVAL_MS);
  }
}

function collectResults(run: RunStatus): DelegatedAgentResult[] {
  return run.children.map((child) => {
    const raw = safeReadJson<DelegatedAgentResult>(child.resultPath);
    if (raw) return raw;
    return {
      agent: child.agent,
      displayName: child.displayName,
      success: false,
      summary: child.summary || child.error || "Delegated agent did not produce a result.",
      keyFindings: [],
      risks: child.error ? [child.error] : [],
      recommendedNextSteps: [],
      keyFiles: [],
      error: child.error,
    };
  });
}

function normalizeSelector(selector: string): string {
  return selector.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchesChildSelector(child: ChildStatus, selector: string): boolean {
  const normalized = normalizeSelector(selector);
  if (!normalized) return false;
  if (normalized === "all" || normalized === "*") return true;

  const numeric = Number(selector);
  if (Number.isInteger(numeric) && numeric > 0 && child.index === numeric - 1) return true;

  return [child.id, child.agent, child.shortLabel, child.displayName]
    .map(normalizeSelector)
    .some((value) => value === normalized);
}

export function queueDelegatedAgentSteer(params: {
  cwd: string;
  runId: string;
  selector: string;
  instruction: string;
}): { runId: string; matched: number; queued: number; targets: string[] } {
  const run = readRunStatus(params.cwd, params.runId);
  if (!run) throw new Error(`Delegated run not found: ${params.runId}`);

  const instruction = params.instruction.trim();
  if (!instruction) throw new Error("Steering instruction cannot be empty.");

  const matchedChildren = run.children.filter((child) => matchesChildSelector(child, params.selector));
  if (matchedChildren.length === 0) {
    throw new Error(`No delegated agents matched selector \"${params.selector}\" in run ${params.runId}.`);
  }

  let queued = 0;
  const targets: string[] = [];

  for (const child of matchedChildren) {
    if (child.state !== "queued" && child.state !== "running") continue;
    const controlPath = child.controlPath ?? path.join(getChildDir(params.cwd, params.runId, child.index), "control.ndjson");
    const command: DelegatedControlCommand = {
      type: "steer",
      message: instruction,
      requestedAt: Date.now(),
      source: "parent",
    };
    fs.mkdirSync(path.dirname(controlPath), { recursive: true });
    fs.appendFileSync(controlPath, `${JSON.stringify(command)}\n`, "utf8");
    queued += 1;
    targets.push(child.id);
  }

  return {
    runId: params.runId,
    matched: matchedChildren.length,
    queued,
    targets,
  };
}

async function executeRunAndWait(params: {
  ctx: ExtensionContext;
  cwd: string;
  runId: string;
  sessionId?: string;
  mode: DelegatedMode;
  blocking: boolean;
  synthesize: boolean;
  childStatusPaths: string[];
  configPaths: string[];
}): Promise<DelegatedRunResult> {
  try {
    if (params.mode === "sequential") {
      for (let i = 0; i < params.configPaths.length; i++) {
        spawnRunner(params.cwd, params.configPaths[i]!);
        await waitForPredicate({
          ...params,
          predicate: (run) => {
            const child = run.children[i];
            return Boolean(child && (child.state === "complete" || child.state === "failed"));
          },
        });
      }
    } else {
      for (const configPath of params.configPaths) spawnRunner(params.cwd, configPath);
    }

    const finalRun = await waitForPredicate({
      ...params,
      predicate: areAllChildrenDone,
    });

    const results = collectResults(finalRun);
    const success = results.every((result) => result.success);
    const finalResult: DelegatedRunResult = {
      runId: params.runId,
      success,
      mode: params.mode,
      results,
      synthesizedSummary: params.synthesize ? synthesizeResults(results) : undefined,
    };
    writeJsonAtomic(path.join(getRunDir(params.cwd, params.runId), "result.json"), finalResult);
    writeRunStatus(params.cwd, params.runId, {
      ...finalRun,
      state: success ? "complete" : "failed",
      updatedAt: Date.now(),
    });
    return finalResult;
  } finally {
    renderDelegatedAgentWidget(params.ctx, listRunStatuses(params.cwd, params.sessionId));
  }
}

export async function runDelegatedAgents(params: {
  ctx: ExtensionContext;
  agents: DelegatedAgentTask[];
  mode?: DelegatedMode;
  blocking?: boolean;
  synthesize?: boolean;
  sessionId?: string;
}): Promise<DelegatedRunResult> {
  if (params.agents.length === 0) throw new Error("Please provide at least one delegated agent task.");

  const normalizedAgents = params.agents.map((item) => {
    const task = item.task.trim();
    if (!task) throw new Error("Delegated agent task cannot be empty.");
    const agent = item.agent.trim() || "auto";
    return {
      agent,
      task,
      model: item.model,
    } satisfies DelegatedAgentTask;
  });

  ensureBaseDirs(params.ctx.cwd);
  const runId = makeRunId();
  const mode = params.mode ?? (normalizedAgents.length > 1 ? "parallel" : "sequential");
  const blocking = params.blocking ?? true;
  const synthesize = params.synthesize ?? normalizedAgents.length > 1;
  const { childStatusPaths, configPaths } = writeInitialRunArtifacts({
    cwd: params.ctx.cwd,
    runId,
    sessionId: params.sessionId,
    tasks: normalizedAgents,
    mode,
    blocking,
    synthesize,
  });

  const result = await executeRunAndWait({
    ctx: params.ctx,
    cwd: params.ctx.cwd,
    runId,
    sessionId: params.sessionId,
    mode,
    blocking,
    synthesize,
    childStatusPaths,
    configPaths,
  });
  return result;
}

export function formatDelegatedRunResult(result: DelegatedRunResult): string {
  return formatFinalText(result);
}

export function summarizeRunForJobs(run: RunStatus): string {
  const running = run.children.filter((child) => child.state === "queued" || child.state === "running").length;
  const lead = running > 0 ? `${running} running` : run.state;
  return `${truncate(run.children.map((child) => child.displayName).join(", "), 36)} | ${lead} | ${run.mode}`;
}

export function cancelDelegatedRuns(cwd: string, sessionId?: string): { runs: number; agents: number } {
  const runs = listRunStatuses(cwd, sessionId).filter((run) => run.state === "queued" || run.state === "running");
  const pids = new Set<number>();

  for (const run of runs) {
    for (const child of run.children) {
      if ((child.state === "queued" || child.state === "running") && child.pid) {
        pids.add(child.pid);
      }
    }
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  return { runs: runs.length, agents: pids.size };
}
