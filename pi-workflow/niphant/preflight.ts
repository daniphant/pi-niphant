import { existsSync } from "node:fs";
import { NIPHANT_SCHEMA_VERSION, ENV } from "./constants.js";
import { createWorktree, gitRoot, isGitRepo, projectIdentity } from "./git.js";
import { handoffText } from "./handoff.js";
import { acquireLock } from "./locks.js";
import { currentWorkspace, workspaceId, writeWorkspace } from "./metadata.js";
import { exactMatch } from "./matching.js";
import { ensureNiphantDirs, niphantHome } from "./paths.js";
import { runSetup } from "./setup.js";
import { slugify } from "./slug.js";
import type { PreflightResult, WorkspaceRecord } from "./types.js";

export function isNiphantMode(env: NodeJS.ProcessEnv = process.env) {
  return env[ENV.enabled] === "1" || env[ENV.enabled]?.toLowerCase() === "true";
}

export function workflowPreflight(cwd: string, request: string, env: NodeJS.ProcessEnv = process.env): PreflightResult {
  if (!isNiphantMode(env)) return { mode: "pass-through", message: "Niphant mode disabled." };
  if (!isGitRepo(cwd)) return { mode: "blocked", message: "Niphant workflow requires a git repository." };
  const home = niphantHome(env);
  ensureNiphantDirs(home);
  const configuredRoot = env[ENV.projectRoot];
  const identity = projectIdentity(configuredRoot && existsSync(configuredRoot) ? configuredRoot : cwd);
  const taskSlug = slugify(request);
  const lock = acquireLock(home, `${identity.slug}-${taskSlug}`);
  try {
    const match = exactMatch(home, identity.slug, request);
    if (match) return { mode: "continued", workspace: match, handoffText: handoffText(match), message: "Existing matching niphant workspace found." };

    const parent = currentWorkspace(home, cwd);
    const created = createWorktree(cwd, identity.slug, request, home);
    const now = new Date().toISOString();
    let record: WorkspaceRecord = {
      schemaVersion: NIPHANT_SCHEMA_VERSION,
      id: workspaceId(),
      projectSlug: identity.slug,
      projectSourceRoot: identity.sourceRoot,
      projectGitRoot: identity.gitRoot,
      projectOrigin: identity.origin,
      worktreePath: created.path,
      branch: created.branch,
      baseBranch: created.baseBranch,
      startPoint: created.startPoint,
      parentWorkspaceId: parent?.id,
      parentWorkspacePath: parent?.worktreePath,
      parentBranch: parent?.branch,
      taskTitle: request.trim().split(/\s+/).slice(0, 10).join(" ") || taskSlug,
      taskSlug: created.taskSlug,
      createdAt: now,
      updatedAt: now,
      setupStatus: "not-run",
      ownership: "niphant",
      status: "active",
    };
    record = writeWorkspace(home, record);
    const setup = runSetup(identity.sourceRoot, created.path, home, env[ENV.setupMode]);
    record.setupStatus = setup.status;
    record.setupScript = setup.script;
    record.setupLogPath = setup.logPath;
    if (setup.status === "failed") record.status = "setup-failed";
    record = writeWorkspace(home, record);
    return { mode: "created", workspace: record, handoffText: handoffText(record), message: setup.message };
  } finally {
    lock.release();
  }
}

export function describeCwd(cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const home = niphantHome(env);
  const current = currentWorkspace(home, cwd);
  if (current) return current;
  if (!isGitRepo(cwd)) return null;
  const root = gitRoot(cwd);
  return currentWorkspace(home, root);
}
