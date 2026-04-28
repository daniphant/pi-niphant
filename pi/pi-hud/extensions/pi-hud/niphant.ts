import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
interface NiphantWorkspace {
  schemaVersion: number;
  taskSlug: string;
  branch: string;
  worktreePath: string;
  setupStatus: string;
  status: string;
  parentWorkspaceId?: string;
}

export function getNiphantWorkspace(cwd: string | undefined, env: NodeJS.ProcessEnv = process.env): NiphantWorkspace | null {
  if (!cwd) return null;
  const home = resolve((env.NIPHANT_HOME || join(homedir(), ".niphant")).replace(/^~(?=$|\/)/, homedir()));
  const dir = join(home, "state", "workspaces");
  if (!existsSync(dir)) return null;
  const normalized = cwd.replace(/\/$/, "");
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, entry), "utf8")) as NiphantWorkspace;
      const wt = parsed.worktreePath?.replace(/\/$/, "");
      if (parsed.schemaVersion === 1 && parsed.status !== "archived" && wt && (normalized === wt || normalized.startsWith(`${wt}/`))) return parsed;
    } catch { /* tolerate corrupt metadata */ }
  }
  return null;
}


