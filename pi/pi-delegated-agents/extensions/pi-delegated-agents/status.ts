import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ChildStatus, DelegatedState, RunStatus } from "./schema.ts";
import { safeReadJson, writeJsonAtomic } from "./utils.ts";

function normalizeProjectPath(cwd: string): string {
  try {
    return fs.realpathSync.native(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

function getProjectStorageKey(cwd: string): string {
  const normalized = normalizeProjectPath(cwd);
  const name = path.basename(normalized).replace(/[^a-zA-Z0-9._-]+/g, "-") || "project";
  const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 12);
  return `${name}-${hash}`;
}

export function getBaseDir(cwd: string): string {
  return path.join(os.homedir(), ".pi", "delegated-agents", "projects", getProjectStorageKey(cwd));
}

export function getRunsDir(cwd: string): string {
  return path.join(getBaseDir(cwd), "runs");
}

export function getRunDir(cwd: string, runId: string): string {
  return path.join(getRunsDir(cwd), runId);
}

export function getRunStatusPath(cwd: string, runId: string): string {
  return path.join(getRunDir(cwd, runId), "status.json");
}

export function getOrchestratorPath(cwd: string, runId: string): string {
  return path.join(getRunDir(cwd, runId), "orchestrator.json");
}

export function getChildDir(cwd: string, runId: string, index: number): string {
  return path.join(getRunDir(cwd, runId), `child-${index}`);
}

export function ensureBaseDirs(cwd: string): void {
  fs.mkdirSync(getRunsDir(cwd), { recursive: true });
}

export function writeRunStatus(cwd: string, runId: string, payload: RunStatus): void {
  writeJsonAtomic(getRunStatusPath(cwd, runId), payload);
}

export function readRunStatus(cwd: string, runId: string): RunStatus | null {
  return safeReadJson<RunStatus>(getRunStatusPath(cwd, runId));
}

export function readChildStatus(statusPath: string): ChildStatus | null {
  return safeReadJson<ChildStatus>(statusPath);
}

export function listRunStatuses(cwd: string, sessionId?: string): RunStatus[] {
  try {
    return fs.readdirSync(getRunsDir(cwd))
      .map((entry) => readRunStatus(cwd, entry))
      .filter((item): item is RunStatus => Boolean(item))
      .filter((item) => !sessionId || !item.sessionId || item.sessionId === sessionId)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch {
    return [];
  }
}

export function aggregateRunStatus(params: {
  cwd: string;
  runId: string;
  sessionId?: string;
  mode: RunStatus["mode"];
  blocking: boolean;
  synthesize: boolean;
  childStatusPaths: string[];
  startedAt?: number;
}): RunStatus {
  const children = params.childStatusPaths
    .map((statusPath) => readChildStatus(statusPath))
    .filter((item): item is ChildStatus => Boolean(item));

  const now = Date.now();
  let state: DelegatedState = "queued";
  if (children.some((child) => child.state === "failed")) {
    state = "failed";
  } else if (children.length > 0 && children.every((child) => child.state === "complete")) {
    state = "complete";
  } else if (children.some((child) => child.state === "running" || child.state === "complete")) {
    state = "running";
  }

  const startedAt = params.startedAt ?? children.reduce<number | undefined>((acc, child) => {
    if (!child.startedAt) return acc;
    return acc === undefined ? child.startedAt : Math.min(acc, child.startedAt);
  }, undefined);

  return {
    runId: params.runId,
    cwd: params.cwd,
    sessionId: params.sessionId,
    mode: params.mode,
    state,
    startedAt,
    updatedAt: now,
    blocking: params.blocking,
    synthesize: params.synthesize,
    children,
  };
}
