import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, lstatSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logsDir } from "./paths.js";
import type { SetupResult } from "./types.js";

export function selectSetupScript(sourceRoot: string): string | undefined {
  const niphant = join(sourceRoot, ".niphant", "setup.sh");
  if (existsSync(niphant)) return niphant;
  const superset = join(sourceRoot, ".superset", "setup.sh");
  if (existsSync(superset)) return superset;
  return undefined;
}

export function runSetup(sourceRoot: string, worktreePath: string, home: string, mode = process.env.NIPHANT_SETUP_MODE): SetupResult {
  const script = selectSetupScript(sourceRoot);
  if (!script) return { status: "skipped", message: "No .niphant/setup.sh or .superset/setup.sh found; setup skipped by safe default." };
  if (mode === "skip") return { status: "skipped", script, message: "Setup skipped by NIPHANT_SETUP_MODE=skip." };
  mkdirSync(logsDir(home), { recursive: true });
  const logPath = join(logsDir(home), `setup-${Date.now()}.log`);
  const result = spawnSync("bash", [script, worktreePath, sourceRoot], { cwd: worktreePath, encoding: "utf8", timeout: 10 * 60_000 });
  const output = [`$ bash ${script} ${worktreePath} ${sourceRoot}`, result.stdout ?? "", result.stderr ?? ""].join("\n");
  writeFileSync(logPath, output, "utf8");
  if (result.status === 0) return { status: "succeeded", script, logPath, message: "Setup succeeded.", exitCode: result.status };
  return { status: "failed", script, logPath, message: `Setup failed; see ${logPath}`, exitCode: result.status };
}

export function copyEnvFilesSafe(sourceRoot: string, worktreePath: string): string[] {
  const copied: string[] = [];
  for (const entry of readdirSync(sourceRoot)) {
    if (!entry.startsWith(".env")) continue;
    const from = join(sourceRoot, entry);
    const to = join(worktreePath, entry);
    const st = lstatSync(from);
    if (!st.isFile() || st.isSymbolicLink() || existsSync(to)) continue;
    if (/PRIVATE_KEY|_SECRET|_TOKEN|_PASSWORD/i.test(entry)) continue;
    copyFileSync(from, to);
    copied.push(entry);
  }
  return copied;
}
