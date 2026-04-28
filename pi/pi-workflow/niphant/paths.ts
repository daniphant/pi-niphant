import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { mkdirSync } from "node:fs";
import { ENV, LOCK_ROOT, LOG_ROOT, PROJECT_ROOT, STATE_ROOT, WORKSPACE_ROOT, WORKTREE_ROOT } from "./constants.js";

export function niphantHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[ENV.home];
  if (configured?.trim()) return resolve(configured.replace(/^~(?=$|\/)/, homedir()));
  return join(homedir(), ".niphant");
}

export function stateDir(home = niphantHome()) { return join(home, STATE_ROOT); }
export function worktreesDir(home = niphantHome()) { return join(home, WORKTREE_ROOT); }
export function workspacesDir(home = niphantHome()) { return join(stateDir(home), WORKSPACE_ROOT); }
export function projectsDir(home = niphantHome()) { return join(stateDir(home), PROJECT_ROOT); }
export function locksDir(home = niphantHome()) { return join(stateDir(home), LOCK_ROOT); }
export function logsDir(home = niphantHome()) { return join(home, LOG_ROOT); }

export function ensureNiphantDirs(home = niphantHome()) {
  for (const dir of [stateDir(home), worktreesDir(home), workspacesDir(home), projectsDir(home), locksDir(home), logsDir(home)]) {
    mkdirSync(dir, { recursive: true });
  }
}

export function assertInside(parent: string, child: string) {
  const p = resolve(parent);
  const c = resolve(child);
  if (c !== p && !c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`)) throw new Error(`Refusing path outside ${p}: ${c}`);
  return c;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
