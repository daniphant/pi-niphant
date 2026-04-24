import type { SETUP_STATUSES, WORKSPACE_STATUSES } from "./constants.js";

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];
export type SetupStatus = (typeof SETUP_STATUSES)[number];

export interface ProjectIdentity {
  slug: string;
  sourceRoot: string;
  gitRoot: string;
  origin?: string;
}

export interface SetupResult {
  status: SetupStatus;
  script?: string;
  logPath?: string;
  message: string;
  exitCode?: number | null;
}

export interface WorkspaceRecord {
  schemaVersion: number;
  id: string;
  projectSlug: string;
  projectSourceRoot: string;
  projectGitRoot: string;
  projectOrigin?: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  startPoint: string;
  parentWorkspaceId?: string;
  parentWorkspacePath?: string;
  parentBranch?: string;
  taskTitle: string;
  taskSlug: string;
  workflowFilePath?: string;
  createdAt: string;
  updatedAt: string;
  setupScript?: string;
  setupStatus: SetupStatus;
  setupLogPath?: string;
  ownership: "niphant" | "external-superset";
  status: WorkspaceStatus;
}

export interface PreflightResult {
  mode: "pass-through" | "created" | "continued" | "blocked";
  workspace?: WorkspaceRecord;
  handoffText?: string;
  message: string;
}
