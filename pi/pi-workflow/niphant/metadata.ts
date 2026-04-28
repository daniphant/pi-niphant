import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NIPHANT_SCHEMA_VERSION } from "./constants.js";
import { ensureNiphantDirs, projectsDir, workspacesDir } from "./paths.js";
import type { WorkspaceRecord } from "./types.js";

export function workspaceId() { return randomUUID(); }

export function workspacePath(home: string, id: string) { return join(workspacesDir(home), `${id}.json`); }

export function readWorkspace(home: string, id: string): WorkspaceRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(workspacePath(home, id), "utf8"));
    return parsed?.schemaVersion === NIPHANT_SCHEMA_VERSION ? parsed as WorkspaceRecord : null;
  } catch { return null; }
}

export function listWorkspaces(home: string): WorkspaceRecord[] {
  ensureNiphantDirs(home);
  const out: WorkspaceRecord[] = [];
  for (const entry of readdirSync(workspacesDir(home))) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(workspacesDir(home), entry), "utf8"));
      if (parsed?.schemaVersion === NIPHANT_SCHEMA_VERSION) out.push(parsed);
    } catch { /* corrupt metadata is ignored */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function writeWorkspace(home: string, record: WorkspaceRecord) {
  ensureNiphantDirs(home);
  const next = { ...record, updatedAt: new Date().toISOString() };
  const file = workspacePath(home, record.id);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
  writeProjectIndex(home, next.projectSlug);
  return next;
}

export function writeProjectIndex(home: string, projectSlug: string) {
  mkdirSync(projectsDir(home), { recursive: true });
  const records = listWorkspaces(home).filter((w) => w.projectSlug === projectSlug);
  const file = join(projectsDir(home), `${projectSlug}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ schemaVersion: NIPHANT_SCHEMA_VERSION, projectSlug, workspaces: records.map((w) => w.id), updatedAt: new Date().toISOString() }, null, 2)}\n`);
  renameSync(tmp, file);
}

export function currentWorkspace(home: string, cwd: string): WorkspaceRecord | null {
  const resolved = cwd.replace(/\/$/, "");
  return listWorkspaces(home).find((w) => w.status !== "archived" && (resolved === w.worktreePath || resolved.startsWith(`${w.worktreePath.replace(/\/$/, "")}/`))) ?? null;
}

export function findByProjectTask(home: string, projectSlug: string, taskSlug: string): WorkspaceRecord | null {
  return listWorkspaces(home).find((w) => w.projectSlug === projectSlug && w.taskSlug === taskSlug && w.status !== "archived" && existsSync(w.worktreePath)) ?? null;
}
