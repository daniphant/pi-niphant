import { shellQuote } from "./paths.js";
import type { WorkspaceRecord } from "./types.js";

export function handoffText(workspace: WorkspaceRecord) {
  return [
    `Niphant workspace ready: ${workspace.taskTitle}`,
    `  path: ${workspace.worktreePath}`,
    `  branch: ${workspace.branch}`,
    `  setup: ${workspace.setupStatus}${workspace.setupLogPath ? ` (${workspace.setupLogPath})` : ""}`,
    "",
    "Pi cwd switching is intentionally explicit in V1. Continue from the worktree with:",
    `  cd ${shellQuote(workspace.worktreePath)} && ni`,
    "",
    "Open another terminal here with:",
    `  cd ${shellQuote(workspace.worktreePath)}`,
  ].join("\n");
}
