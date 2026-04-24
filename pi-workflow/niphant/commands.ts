import { existsSync } from "node:fs";
import { currentBranch } from "./git.js";
import { clearLocks } from "./locks.js";
import { currentWorkspace, listWorkspaces, writeWorkspace } from "./metadata.js";
import { niphantHome, shellQuote } from "./paths.js";

export function listCommand(cwd: string, env = process.env) {
  const home = niphantHome(env);
  const rows = listWorkspaces(home).slice(0, 30);
  if (!rows.length) return "No niphant workspaces found.";
  return rows.map((w) => `${w.status.padEnd(12)} ${w.taskSlug.padEnd(28)} ${w.branch} → ${w.worktreePath}${existsSync(w.worktreePath) ? "" : " (missing)"}`).join("\n");
}

export function statusCommand(cwd: string, env = process.env) {
  const home = niphantHome(env);
  if (cwd.trim() === "locks") {
    const count = clearLocks(home);
    return `Cleared ${count} niphant lock(s) under ${home}.`;
  }
  const w = currentWorkspace(home, cwd);
  if (!w) return `No active niphant workspace metadata for ${cwd}.`;
  return [
    `workspace: ${w.taskTitle}`,
    `id: ${w.id}`,
    `status: ${w.status}; setup: ${w.setupStatus}`,
    `branch: ${w.branch} (git says ${safeBranch(cwd)})`,
    `path: ${w.worktreePath}`,
    w.parentWorkspaceId ? `parent: ${w.parentWorkspaceId} ${w.parentBranch ?? ""}` : undefined,
    w.setupLogPath ? `setup log: ${w.setupLogPath}` : undefined,
  ].filter(Boolean).join("\n");
}

export function doneCommand(cwd: string, env = process.env) {
  const home = niphantHome(env);
  const w = currentWorkspace(home, cwd);
  if (!w) return `No active niphant workspace metadata for ${cwd}.`;
  const next = writeWorkspace(home, { ...w, status: "archived" });
  return `Archived niphant workspace ${next.taskSlug}. Branch/worktree were not removed.`;
}

export function terminalCommand(cwd: string, env = process.env) {
  const home = niphantHome(env);
  const w = currentWorkspace(home, cwd);
  const target = w?.worktreePath ?? cwd;
  return `Open another terminal in this workspace:\n  cd ${shellQuote(target)}\n\nOr launch Pi:\n  cd ${shellQuote(target)} && ni`;
}

function safeBranch(cwd: string) {
  try { return currentBranch(cwd); } catch { return "unknown"; }
}
