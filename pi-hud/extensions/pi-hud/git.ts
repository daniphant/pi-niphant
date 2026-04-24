import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GitFileStats, GitStatus } from "./types.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 1000;

// Parses `git status --porcelain` output into counts of modified/added/deleted/untracked files.
// Status codes follow Starship's conventions: M=modified, A=added, D=deleted, R=renamed,
// C=copied, ??=untracked. Renames and copies are counted as modified.
export const parseFileStats = (porcelainOutput: string): GitFileStats => {
  const stats: GitFileStats = { modified: 0, added: 0, deleted: 0, untracked: 0 };
  const lines = porcelainOutput.split("\n").filter(Boolean);

  for (const line of lines) {
    if (line.length < 2) continue;
    const index = line[0];
    const worktree = line[1];

    if (line.startsWith("??")) {
      stats.untracked += 1;
    } else if (index === "A") {
      stats.added += 1;
    } else if (index === "D" || worktree === "D") {
      stats.deleted += 1;
    } else if (index === "M" || worktree === "M" || index === "R" || index === "C") {
      stats.modified += 1;
    }
  }

  return stats;
};

// Probes git for branch, dirty state, ahead/behind, and file stats. Returns null when the
// cwd isn't a repo or the initial `rev-parse` fails. Every subprocess is time-bounded so
// a slow or hung repo can't stall the HUD render loop.
export const getGitStatus = async (cwd: string | undefined): Promise<GitStatus | null> => {
  if (!cwd) return null;

  let branch: string;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
    });
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    branch = trimmed;
  } catch {
    return null;
  }

  let isDirty = false;
  let fileStats: GitFileStats | null = null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["--no-optional-locks", "status", "--porcelain"],
      { cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8" },
    );
    const trimmed = stdout.trim();
    isDirty = trimmed.length > 0;
    if (isDirty) fileStats = parseFileStats(trimmed);
  } catch {
    // Treat as clean when status probing fails.
  }

  let ahead = 0;
  let behind = 0;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
      { cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8" },
    );
    const parts = stdout.trim().split(/\s+/);
    if (parts.length === 2) {
      behind = Number.parseInt(parts[0], 10) || 0;
      ahead = Number.parseInt(parts[1], 10) || 0;
    }
  } catch {
    // No upstream configured (or probe failed); leave both at zero.
  }

  return { branch, isDirty, ahead, behind, fileStats };
};
