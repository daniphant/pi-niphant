import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";

interface ModelResult {
  model: string;
  ok: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

const DEFAULT_MODELS = ["openai-codex/gpt-5.5", "zai/glm-5.1"];

function splitCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultModels(): string[] {
  return splitCsv(process.env.PI_CONSENSUS_MODELS).length ? splitCsv(process.env.PI_CONSENSUS_MODELS) : DEFAULT_MODELS;
}

function parseCommandArgs(args: string): { models?: string[]; prompt: string } {
  const tokens = args.match(/(?:[^\s"]+|"[^"]*"|'[^']*')+/g) ?? [];
  const rest: string[] = [];
  let models: string[] | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].replace(/^['"]|['"]$/g, "");
    if (token === "--models" && tokens[i + 1]) {
      models = splitCsv(tokens[++i].replace(/^['"]|['"]$/g, ""));
    } else if (token.startsWith("--models=")) {
      models = splitCsv(token.slice("--models=".length));
    } else {
      rest.push(tokens[i].replace(/^['"]|['"]$/g, ""));
    }
  }
  return { models, prompt: rest.join(" ").trim() };
}

function buildReviewerPrompt(prompt: string, mode: string): string {
  return `You are one participant in a multi-model consensus review.\n\nMode: ${mode}\n\nReview the frozen prompt/context below. Do not browse the repository or assume missing facts. If the prompt lacks information, say so.\n\nReturn concise Markdown with exactly these headings:\n## Verdict\n## Key Agreement Points\n## Disagreements or Uncertainties\n## Risks / Blocking Concerns\n## Recommended Changes\n\nFrozen prompt/context:\n${prompt}`;
}

function runPiModel(model: string, prompt: string, cwd: string, timeoutMs: number): Promise<ModelResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(
      "pi",
      ["--model", model, "--no-tools", "--no-skills", "--no-extensions", "--no-context-files", "--no-session", "--print", prompt],
      { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4, env: process.env },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - started;
        if (error) {
          resolve({ model, ok: false, output: stdout.trim(), error: `${error.message}${stderr ? `\n${stderr.trim()}` : ""}`, durationMs });
          return;
        }
        resolve({ model, ok: true, output: stdout.trim(), durationMs });
      },
    );
    child.stdin?.end();
  });
}

function synthesize(results: ModelResult[], prompt: string): string {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const verdict = failed.length === results.length ? "No successful model responses" : "Consensus responses collected";
  const sections = [
    `# Consensus Result`,
    ``,
    `Verdict: ${verdict}`,
    `Models: ${results.map((r) => `${r.model}${r.ok ? "" : " (failed)"}`).join(", ")}`,
    ``,
    `## Original Prompt`,
    prompt.length > 2000 ? `${prompt.slice(0, 2000)}\n\n…truncated…` : prompt,
    ``,
    `## Model Responses`,
    ...results.map((r) => `### ${r.model} (${r.ok ? "ok" : "failed"}, ${Math.round(r.durationMs / 1000)}s)\n\n${r.ok ? r.output || "(empty)" : `Error: ${r.error ?? "unknown"}\n\n${r.output}`}`),
  ];
  if (ok.length > 1) {
    sections.splice(6, 0, ``, `## How to use this`, `Compare the sections below for repeated risks and recommendations. Treat repeated blockers as high-confidence; treat single-model concerns as hypotheses to verify.`);
  }
  if (failed.length) {
    sections.push(``, `## Failed Models`, ...failed.map((r) => `- ${r.model}: ${r.error ?? "unknown error"}`));
  }
  return sections.join("\n");
}

async function runConsensus(opts: { prompt: string; models?: string[]; mode?: string; cwd: string; timeoutMs?: number }) {
  const models = opts.models?.length ? opts.models : defaultModels();
  const reviewerPrompt = buildReviewerPrompt(opts.prompt, opts.mode ?? "review");
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const results = await Promise.all(models.map((model) => runPiModel(model, reviewerPrompt, opts.cwd, timeoutMs)));
  return { models, results, summary: synthesize(results, opts.prompt) };
}

export default function consensusExtension(pi: ExtensionAPI) {
  pi.registerCommand("consensus", {
    description: "Ask multiple models for consensus: /consensus [--models a,b] <prompt>",
    handler: async (args, ctx) => {
      const parsed = parseCommandArgs(args);
      if (!parsed.prompt) {
        ctx.ui.notify("Usage: /consensus [--models modelA,modelB] <prompt>", "warning");
        return;
      }
      ctx.ui.notify("Running consensus models…", "info");
      const result = await runConsensus({ prompt: parsed.prompt, models: parsed.models, cwd: ctx.cwd });
      ctx.ui.notify(result.summary, result.results.some((r) => r.ok) ? "info" : "error");
    },
  });

  pi.registerTool({
    name: "run_consensus",
    label: "Run Consensus",
    description: "Ask multiple configured models to independently review the same frozen prompt/context and return their responses plus a consensus packet.",
    promptSnippet: "Use for explicit consensus requests over plans, designs, risky decisions, or independent review. Do not use for repository exploration.",
    promptGuidelines: [
      "Pass a frozen prompt/context; do not ask consensus models to explore the repo.",
      "Use for plans, architecture choices, security-sensitive changes, migrations, and post-implementation review.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "Frozen plan, design, question, or context to review" }),
      models: Type.Optional(Type.Array(Type.String(), { description: "Optional model IDs such as openai-codex/gpt-5.5" })),
      mode: Type.Optional(Type.Union([Type.Literal("review"), Type.Literal("plan"), Type.Literal("design"), Type.Literal("risk"), Type.Literal("implementation")], { description: "Consensus mode" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Per-model timeout in milliseconds" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runConsensus({ prompt: params.prompt, models: params.models, mode: params.mode, timeoutMs: params.timeoutMs, cwd: ctx.cwd });
      return { content: [{ type: "text", text: result.summary }], details: result };
    },
  });
}
