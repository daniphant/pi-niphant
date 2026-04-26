import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { BRANCH_PREFIX } from "./constants.js";
import { assertInside, worktreesDir } from "./paths.js";
import { projectSlugFromPath, slugify, uniqueName } from "./slug.js";
import type { ProjectIdentity } from "./types.js";

function git(cwd: string, args: string[], opts: { allowFail?: boolean } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (opts.allowFail) return "";
    throw error;
  }
}

export function isGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }) === "true";
}

export function gitRoot(cwd: string): string {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error("Not inside a git worktree.");
  return root;
}

export function currentBranch(cwd: string): string {
  return git(cwd, ["branch", "--show-current"], { allowFail: true }) || git(cwd, ["rev-parse", "--short", "HEAD"]);
}

export function hasCommit(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--verify", "HEAD"], { allowFail: true }).length > 0;
}

export function originUrl(cwd: string): string | undefined {
  return git(cwd, ["config", "--get", "remote.origin.url"], { allowFail: true }) || undefined;
}

export function projectIdentity(cwd: string): ProjectIdentity {
  const root = gitRoot(cwd);
  const origin = originUrl(root);
  return { slug: projectSlugFromPath(root, origin), sourceRoot: root, gitRoot: root, origin };
}

export function worktreeList(cwd: string): string[] {
  return git(cwd, ["worktree", "list", "--porcelain"], { allowFail: true })
    .split(/\n+/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

export function localBranchExists(cwd: string, branch: string): boolean {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd, stdio: "ignore" });
    return true;
  } catch { return false; }
}

export function resolveStartPoint(cwd: string): string {
  const branch = currentBranch(cwd);
  if (branch) return branch;
  return git(cwd, ["rev-parse", "HEAD"]);
}

export function createWorktree(cwd: string, projectSlug: string, task: string, home: string) {
  const root = gitRoot(cwd);
  const taskSlugBase = slugify(task);
  const projectRoot = join(worktreesDir(home), projectSlug);
  const branchBase = `${BRANCH_PREFIX}-${taskSlugBase}`;
  const branch = uniqueName(branchBase, (candidate) => localBranchExists(root, candidate), 80);
  const pathSlug = uniqueName(taskSlugBase, (candidate) => existsSync(join(projectRoot, candidate)), 64);
  const path = assertInside(projectRoot, join(projectRoot, pathSlug));
  const startPoint = resolveStartPoint(root);
  execFileSync("git", ["worktree", "add", "--no-track", "-b", branch, path, startPoint], { cwd: root, stdio: "pipe" });
  return { path, branch, startPoint, taskSlug: pathSlug, baseBranch: currentBranch(cwd) || startPoint };
}

export function removeWorktreeIfSafe(repo: string, path: string) {
  const listed = worktreeList(repo).includes(path);
  if (listed) execFileSync("git", ["worktree", "remove", "--force", path], { cwd: repo, stdio: "ignore" });
  else if (existsSync(path) && basename(path) !== "." && path.includes(".niphant")) rmSync(path, { recursive: true, force: true });
}
