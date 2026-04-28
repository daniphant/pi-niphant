import { existsSync } from "node:fs";
import { findByProjectTask, listWorkspaces } from "./metadata.js";
import { slugify } from "./slug.js";
import type { WorkspaceRecord } from "./types.js";

export function exactMatch(home: string, projectSlug: string, task: string): WorkspaceRecord | null {
  return findByProjectTask(home, projectSlug, slugify(task));
}

export function fuzzyCandidates(home: string, projectSlug: string, task: string): WorkspaceRecord[] {
  const tokens = new Set(slugify(task).split("-").filter((t) => t.length > 2));
  return listWorkspaces(home)
    .filter((w) => w.projectSlug === projectSlug && w.status !== "archived" && existsSync(w.worktreePath))
    .map((w) => ({ w, score: w.taskSlug.split("-").filter((t) => tokens.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.w.updatedAt.localeCompare(a.w.updatedAt))
    .slice(0, 5)
    .map((x) => x.w);
}
