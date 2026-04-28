import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface CheckResult {
  name: string;
  command: string;
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function runShell(command: string, cwd: string, timeoutMs: number): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile("bash", ["-lc", command], { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8, env: process.env }, (error, stdout, stderr) => {
      const anyError = error as NodeJS.ErrnoException | null;
      resolve({
        name: command,
        command,
        ok: !error,
        code: typeof anyError?.code === "number" ? anyError.code : anyError ? 1 : 0,
        stdout: stdout.trim(),
        stderr: [stderr.trim(), anyError?.message].filter(Boolean).join("\n"),
        durationMs: Date.now() - started,
      });
    });
  });
}

function detectChecks(cwd: string): string[] {
  const checks: string[] = [];
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.scripts?.typecheck) checks.push("npm run typecheck");
      if (pkg.scripts?.lint) checks.push("npm run lint");
    } catch {}
    if (existsSync(join(cwd, "tsconfig.json"))) checks.push("npx --yes tsc --noEmit");
  }
  if (existsSync(join(cwd, "Cargo.toml"))) checks.push("cargo check");
  if (existsSync(join(cwd, "go.mod"))) checks.push("go test ./...");
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) {
    checks.push("command -v ruff >/dev/null && ruff check . || true");
    checks.push("command -v pyright >/dev/null && pyright || true");
  }
  return checks.filter((cmd, idx, arr) => arr.indexOf(cmd) === idx);
}

function projectSlug(cwd: string) {
  return cwd.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown-project";
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function debugDir(cwd: string) {
  return join(homedir(), ".pi", "agent", "debugging", projectSlug(cwd));
}

async function createDebugLog(cwd: string, issue: string) {
  const dir = debugDir(cwd);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${stamp()}-debug.md`);
  const status = await runShell("git status --short 2>/dev/null || true", cwd, 30_000);
  const recent = await runShell("git log --oneline -8 2>/dev/null || true", cwd, 30_000);
  const content = `# Systematic Debugging Log\n\n- **Issue:** ${issue || "TBD"}\n- **Project:** ${cwd}\n- **Created:** ${new Date().toISOString()}\n- **Status:** investigating\n\n## Iron Law\n\nNo fixes until root cause investigation is complete. Evidence before claims.\n\n## Phase 1 — Root Cause Investigation\n\n### Error Messages / Symptoms\n\nTBD\n\n### Reproduction\n\n- Exact command / steps: TBD\n- Reproducible? TBD\n- Frequency: TBD\n\n### Recent Changes\n\n\`\`\`text\n${status.stdout || "No git status output."}\n\`\`\`\n\nRecent commits:\n\n\`\`\`text\n${recent.stdout || "No git history output."}\n\`\`\`\n\n### Evidence / Instrumentation\n\nTBD\n\n### Data Flow / Backward Trace\n\n1. Symptom occurs at: TBD\n2. Immediate cause: TBD\n3. Caller / upstream source: TBD\n4. Original trigger: TBD\n\n## Phase 2 — Pattern Analysis\n\n### Similar Working Examples\n\nTBD\n\n### Differences Between Working and Broken\n\nTBD\n\n### Dependencies / Environment Assumptions\n\nTBD\n\n## Phase 3 — Hypothesis and Test\n\n### Single Hypothesis\n\nI think TBD is the root cause because TBD.\n\n### Minimal Test\n\nTBD\n\n### Result\n\nTBD\n\n## Phase 4 — Implementation\n\n### Failing Regression Test / Reproduction\n\nTBD\n\n### Single Fix\n\nTBD\n\n### Verification Evidence\n\nTBD\n\n## Defense in Depth\n\n- Entry validation: TBD\n- Business/domain validation: TBD\n- Environment guard: TBD\n- Diagnostic logging: TBD\n\n## Completion Gate\n\n- [ ] Original symptom reproduced or evidence gathered\n- [ ] Root cause identified at source, not symptom\n- [ ] Single hypothesis tested\n- [ ] Regression test or minimal repro exists\n- [ ] Fix verified with fresh command output\n- [ ] No broad completion claim without evidence\n`;
  await writeFile(file, content, "utf8");
  return file;
}

async function latestDebugLog(cwd: string) {
  const dir = debugDir(cwd);
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
    if (!files.length) return null;
    return join(dir, files[files.length - 1]);
  } catch {
    return null;
  }
}

function format(results: CheckResult[]): string {
  const failed = results.filter((r) => !r.ok);
  return [
    `# Diagnostics`,
    ``,
    `Status: ${failed.length ? "fail" : "pass"}`,
    `Checks: ${results.length}`,
    `Failures: ${failed.length}`,
    ``,
    ...results.map((r) => [
      `## ${r.command}`,
      `Status: ${r.ok ? "ok" : "failed"} (${Math.round(r.durationMs / 1000)}s, code ${r.code})`,
      r.stdout ? `stdout:\n${r.stdout.slice(-6000)}` : "stdout: (empty)",
      r.stderr ? `stderr:\n${r.stderr.slice(-6000)}` : "",
    ].filter(Boolean).join("\n\n")),
  ].join("\n");
}

async function runDiagnostics(cwd: string, commands?: string[], timeoutMs = 120_000) {
  const checks = commands?.length ? commands : detectChecks(cwd);
  const results: CheckResult[] = [];
  for (const command of checks) results.push(await runShell(command, cwd, timeoutMs));
  return { checks, results, summary: checks.length ? format(results) : "# Diagnostics\n\nNo known diagnostics detected for this project." };
}

export default function diagnosticsExtension(pi: ExtensionAPI) {
  pi.registerCommand("debug-start", {
    description: "Create a user-local systematic debugging log: /debug-start <issue>",
    handler: async (args, ctx) => {
      const file = await createDebugLog(ctx.cwd, args.trim());
      ctx.ui.notify(`Created systematic debugging log:\n${file}\n\nUse the systematic-debugging skill. Do not fix before Phase 1 root-cause investigation is complete.`, "info");
    },
  });

  pi.registerCommand("debug-latest", {
    description: "Show the latest user-local systematic debugging log path",
    handler: async (_args, ctx) => {
      const file = await latestDebugLog(ctx.cwd);
      ctx.ui.notify(file ?? "No debugging log found for this project.", file ? "info" : "warning");
    },
  });

  pi.registerCommand("diagnostics", {
    description: "Run project diagnostics/checkers",
    handler: async (args, ctx) => {
      const commands = args.trim() ? [args.trim()] : undefined;
      ctx.ui.notify("Running diagnostics…", "info");
      const result = await runDiagnostics(ctx.cwd, commands);
      ctx.ui.notify(result.summary, result.results.every((r) => r.ok) ? "info" : "error");
    },
  });

  pi.registerTool({
    name: "get_project_diagnostics",
    label: "Get Project Diagnostics",
    description: "Run common local diagnostics such as tsc, lint, cargo check, go test, ruff, or explicit commands.",
    parameters: Type.Object({
      commands: Type.Optional(Type.Array(Type.String(), { description: "Explicit diagnostic commands. If omitted, commands are auto-detected." })),
      timeoutMs: Type.Optional(Type.Number({ description: "Per-command timeout in milliseconds" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runDiagnostics(ctx.cwd, params.commands, params.timeoutMs);
      return { content: [{ type: "text", text: result.summary }], details: result };
    },
  });
}
