import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";

interface BrowserCommandResult {
  command: string;
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface BrowserRunResult {
  status: "pass" | "fail" | "blocked";
  summary: string;
  artifactDir: string;
  results: BrowserCommandResult[];
  files: string[];
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function agentBrowserBin(cwd: string): Promise<{ command: string; prefixArgs: string[] }> {
  const local = join(cwd, "node_modules", ".bin", "agent-browser");
  if (await exists(local)) return { command: local, prefixArgs: [] };
  return { command: "npx", prefixArgs: ["--yes", "agent-browser"] };
}

function splitArgs(input: string): string[] {
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^['"]|['"]$/g, ""));
}

function exec(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8, env: process.env }, (error, stdout, stderr) => {
      const anyError = error as NodeJS.ErrnoException | null;
      resolve({
        code: typeof anyError?.code === "number" ? anyError.code : anyError ? 1 : 0,
        stdout,
        stderr,
        error: anyError?.message,
      });
    });
  });
}

async function runAgentBrowserCommand(opts: { cwd: string; commandLine: string; session?: string; timeoutMs?: number }): Promise<BrowserCommandResult> {
  const bin = await agentBrowserBin(opts.cwd);
  const started = Date.now();
  const args = [...bin.prefixArgs];
  if (opts.session) args.push("--session", opts.session);
  args.push(...splitArgs(opts.commandLine));
  const result = await exec(bin.command, args, opts.cwd, opts.timeoutMs ?? 60_000);
  return {
    command: `agent-browser ${opts.session ? `--session ${opts.session} ` : ""}${opts.commandLine}`,
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout.trim(),
    stderr: [result.stderr.trim(), result.error].filter(Boolean).join("\n"),
    durationMs: Date.now() - started,
  };
}

async function runAgentBrowserSequence(opts: { cwd: string; commands: string[]; session?: string; artifactDir?: string; timeoutMs?: number; stopOnError?: boolean }): Promise<BrowserRunResult> {
  const artifactDir = resolve(opts.cwd, opts.artifactDir ?? join(".pi", "web-e2e-runs", new Date().toISOString().replace(/[:.]/g, "-")));
  await mkdir(artifactDir, { recursive: true });
  const results: BrowserCommandResult[] = [];
  const files: string[] = [];

  for (const commandLine of opts.commands) {
    const result = await runAgentBrowserCommand({ cwd: opts.cwd, commandLine, session: opts.session, timeoutMs: opts.timeoutMs });
    results.push(result);
    if (!result.ok && opts.stopOnError !== false) break;
  }

  const reportPath = join(artifactDir, "agent-browser-report.json");
  await writeFile(reportPath, JSON.stringify({ session: opts.session, commands: opts.commands, results }, null, 2));
  files.push(reportPath);

  const failed = results.some((r) => !r.ok);
  return {
    status: failed ? "fail" : "pass",
    summary: failed ? "One or more agent-browser commands failed." : "agent-browser command sequence completed.",
    artifactDir,
    results,
    files,
  };
}

async function runCapture(opts: { cwd: string; url: string; task: string; session?: string; artifactDir?: string; fullPage?: boolean; timeoutMs?: number }): Promise<BrowserRunResult> {
  const artifactDir = resolve(opts.cwd, opts.artifactDir ?? join(".pi", "web-e2e-runs", new Date().toISOString().replace(/[:.]/g, "-")));
  await mkdir(artifactDir, { recursive: true });
  const screenshot = join(artifactDir, "page-full.png");
  const snapshot = join(artifactDir, "snapshot-interactive.txt");
  const text = join(artifactDir, "page-text.txt");
  const metadata = join(artifactDir, "metadata.txt");
  const commands = [
    `open ${quote(opts.url)}`,
    `wait --load networkidle`,
    `get title`,
    `get url`,
    `screenshot ${opts.fullPage === false ? "" : "--full "}${quote(screenshot)}`.trim(),
    `snapshot -i`,
    `get text body`,
  ];

  const results: BrowserCommandResult[] = [];
  for (const commandLine of commands) {
    const result = await runAgentBrowserCommand({ cwd: opts.cwd, commandLine, session: opts.session, timeoutMs: opts.timeoutMs });
    results.push(result);
    if (!result.ok) break;
    if (commandLine === "snapshot -i") await writeFile(snapshot, result.stdout + "\n");
    if (commandLine === "get text body") await writeFile(text, result.stdout + "\n");
  }
  await writeFile(metadata, [`Task: ${opts.task}`, `URL: ${opts.url}`, "", ...results.map((r) => `$ ${r.command}\n${r.stdout}\n${r.stderr ? `stderr:\n${r.stderr}\n` : ""}`)].join("\n"));
  const reportPath = join(artifactDir, "agent-browser-report.json");
  await writeFile(reportPath, JSON.stringify({ task: opts.task, url: opts.url, session: opts.session, results }, null, 2));

  const failed = results.some((r) => !r.ok);
  return {
    status: failed ? "fail" : "pass",
    summary: failed
      ? `Initial browser capture failed for ${opts.url}. Inspect ${reportPath}.`
      : `Captured ${opts.url}. Use snapshot refs in ${snapshot} for follow-up interactions.`,
    artifactDir,
    results,
    files: [screenshot, snapshot, text, metadata, reportPath],
  };
}

function format(result: BrowserRunResult): string {
  return [
    `# Web E2E / Browser Result`,
    ``,
    `Status: ${result.status}`,
    `Summary: ${result.summary}`,
    `Artifact dir: ${result.artifactDir}`,
    ``,
    `## Files`,
    ...(result.files.length ? result.files.map((f) => `- ${f}`) : ["- none"]),
    ``,
    `## Commands`,
    ...result.results.map((r) => [`### ${r.command} (${r.ok ? "ok" : "failed"}, ${Math.round(r.durationMs / 1000)}s)`, r.stdout ? `stdout:\n${r.stdout.slice(-4000)}` : "stdout: (empty)", r.stderr ? `stderr:\n${r.stderr.slice(-4000)}` : ""].filter(Boolean).join("\n\n")),
  ].join("\n");
}

export default function webE2EExtension(pi: ExtensionAPI) {
  pi.registerCommand("e2e", {
    description: "Capture a page with agent-browser: /e2e <url> [task]",
    handler: async (args, ctx) => {
      const [url, ...taskParts] = args.trim().split(/\s+/);
      if (!url) {
        ctx.ui.notify("Usage: /e2e <url> [task]", "warning");
        return;
      }
      const task = taskParts.join(" ").trim() || "Capture page, interactive snapshot, text, and screenshot.";
      ctx.ui.notify("Running agent-browser capture…", "info");
      const result = await runCapture({ cwd: ctx.cwd, url, task });
      ctx.ui.notify(format(result), result.status === "pass" ? "info" : "error");
    },
  });

  pi.registerTool({
    name: "run_agent_browser",
    label: "Run Agent Browser",
    description: "Run one or more agent-browser CLI commands in a persistent browser session. Use snapshots to get @refs, then interact with click/fill/select/etc.",
    promptSnippet: "Use for browser interaction. Workflow: open URL, wait, snapshot -i, interact with @refs, re-snapshot, capture screenshots/artifacts.",
    promptGuidelines: [
      "Prefer `snapshot -i` before interacting so you can use compact @e refs.",
      "Re-run `snapshot -i` after navigation or DOM changes because refs can change.",
      "Use named sessions for isolated/persistent browser state.",
      "Save screenshots/snapshots under .pi/web-e2e-runs or the provided artifactDir.",
    ],
    parameters: Type.Object({
      commands: Type.Array(Type.String({ description: "agent-browser command without the leading `agent-browser`, e.g. `open http://localhost:3000`, `snapshot -i`, `click @e1`" }), { minItems: 1 }),
      session: Type.Optional(Type.String({ description: "Optional named browser session" })),
      artifactDir: Type.Optional(Type.String({ description: "Directory for JSON report" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Per-command timeout" })),
      stopOnError: Type.Optional(Type.Boolean({ description: "Stop sequence after first failed command. Defaults true." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runAgentBrowserSequence({ cwd: ctx.cwd, ...params });
      return { content: [{ type: "text", text: format(result) }], details: result };
    },
  });

  pi.registerTool({
    name: "run_web_e2e",
    label: "Run Web E2E Capture",
    description: "Open a URL with agent-browser and capture a screenshot, interactive snapshot, page text, metadata, and report files.",
    promptSnippet: "Use for explicit browser/E2E capture requests. For multi-step flows, call run_agent_browser after inspecting the snapshot refs.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to open" }),
      task: Type.String({ description: "What to verify/capture" }),
      session: Type.Optional(Type.String({ description: "Optional named browser session" })),
      artifactDir: Type.Optional(Type.String({ description: "Artifact directory" })),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full-page screenshot. Defaults true." })),
      timeoutMs: Type.Optional(Type.Number({ description: "Per-command timeout" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runCapture({ cwd: ctx.cwd, ...params });
      return { content: [{ type: "text", text: format(result) }], details: result };
    },
  });
}
