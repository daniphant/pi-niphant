export const NIPHANT_SCHEMA_VERSION = 1;

export const ENV = {
  enabled: "NIPHANT",
  home: "NIPHANT_HOME",
  projectRoot: "NIPHANT_PROJECT_ROOT",
  launcherRoot: "NIPHANT_LAUNCHER_ROOT",
  setupMode: "NIPHANT_SETUP_MODE",
} as const;

export const DEFAULT_HOME = "~/.niphant";
export const WORKTREE_ROOT = "worktrees";
export const STATE_ROOT = "state";
export const WORKSPACE_ROOT = "workspaces";
export const PROJECT_ROOT = "projects";
export const LOCK_ROOT = "locks";
export const LOG_ROOT = "logs";

export const WORKSPACE_STATUSES = ["active", "setup-failed", "archived", "external-detected"] as const;
export const SETUP_STATUSES = ["not-run", "running", "succeeded", "failed", "skipped"] as const;

export const COMMANDS = {
  list: "niphant-list",
  status: "niphant-status",
  done: "niphant-done",
  terminal: "niphant-terminal",
} as const;

export const MAX_TASK_SLUG = 56;
export const MAX_PROJECT_SLUG = 80;
export const BRANCH_PREFIX = "niphant";
export const LOCK_STALE_MS = 15 * 60 * 1000;
