import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

interface ReviewerConfig {
  id: string;
  label: string;
  model: string;
  stance?: "for" | "against" | "neutral";
  prompt: string;
}

interface RunRequest {
  planFile: string;
  reviewers: ReviewerConfig[];
  artifactRoot?: string;
  palCommand?: string;
  palArgs?: string[];
}

interface RunEvent {
  id: number;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

interface RunState {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  startedAt: string;
  completedAt?: string;
  planFile: string;
  artifactDir: string;
  reviewers: ReviewerConfig[];
  events: RunEvent[];
  error?: string;
  findingsPath?: string;
  rawArtifacts: string[];
}

interface SidecarState {
  cwd: string;
  server?: ReturnType<typeof createServer>;
  port?: number;
  runs: Map<string, RunState>;
  clients: Map<string, Set<ServerResponse>>;
}

const state: SidecarState = { cwd: process.cwd(), runs: new Map(), clients: new Map() };

function splitShellish(input: string): string[] {
  return (input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((part) => part.replace(/^['"]|['"]$/g, ""));
}

function defaultPalCommand(): { command: string; args: string[] } {
  const command = process.env.PAL_MCP_COMMAND?.trim() || "uvx";
  const args = process.env.PAL_MCP_ARGS ? splitShellish(process.env.PAL_MCP_ARGS) : ["--from", "git+https://github.com/BeehiveInnovations/pal-mcp-server.git", "pal-mcp-server"];
  return { command, args };
}

async function parseDotenv(path: string): Promise<Record<string, string>> {
  if (!existsSync(path)) return {};
  const text = await readFile(path, "utf8");
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function palEnv(cwd: string): Promise<Record<string, string>> {
  const base = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const dotenvPaths = [resolve(cwd, ".env"), resolve(cwd, ".pal.env"), join(homedir(), ".pal", ".env"), join(homedir(), ".claude", ".env")];
  for (const path of dotenvPaths) {
    const values = await parseDotenv(path);
    for (const [key, value] of Object.entries(values)) {
      if (base[key] === undefined) base[key] = value;
    }
  }
  return base;
}

function hasProviderKey(env: Record<string, string>): boolean {
  return Boolean(env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.XAI_API_KEY || env.DIAL_API_KEY || env.CUSTOM_API_URL);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function normalizeReviewer(input: Partial<ReviewerConfig>, index: number): ReviewerConfig {
  const id = String(input.id || input.label || `reviewer-${index + 1}`).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return {
    id,
    label: String(input.label || input.id || `Reviewer ${index + 1}`),
    model: String(input.model || "pro"),
    stance: input.stance || "neutral",
    prompt: String(input.prompt || "Review the plan for correctness, risks, and actionable improvements."),
  };
}

function validateRunRequest(raw: unknown, cwd: string): RunRequest {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const planFile = resolve(cwd, String(obj.planFile || ""));
  if (!obj.planFile || !existsSync(planFile)) throw new Error(`Plan file not found: ${obj.planFile || "(empty)"}`);
  const reviewers = Array.isArray(obj.reviewers) ? obj.reviewers.map((r, i) => normalizeReviewer(r as Partial<ReviewerConfig>, i)) : [];
  if (reviewers.length < 2) throw new Error("PAL consensus requires at least two reviewers/models.");
  return {
    planFile,
    reviewers,
    artifactRoot: obj.artifactRoot ? String(obj.artifactRoot) : undefined,
    palCommand: obj.palCommand ? String(obj.palCommand) : undefined,
    palArgs: Array.isArray(obj.palArgs) ? obj.palArgs.map(String) : undefined,
  };
}

function addEvent(run: RunState, type: string, data: Record<string, unknown> = {}) {
  const event: RunEvent = { id: run.events.length + 1, type, at: new Date().toISOString(), data };
  run.events.push(event);
  const clients = state.clients.get(run.id);
  if (clients) {
    for (const res of clients) {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify({ at: event.at, ...event.data })}\n\n`);
    }
  }
}

function textFromToolResult(result: any): string {
  const content = result?.content;
  if (!Array.isArray(content)) return JSON.stringify(result, null, 2);
  return content.map((item) => (item?.type === "text" ? item.text : JSON.stringify(item))).join("\n");
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function reviewerPrompt(reviewer: ReviewerConfig): string {
  return [
    `Act as the ${reviewer.label}.`,
    reviewer.prompt,
    "",
    "Return compact, actionable feedback with these sections:",
    "## Verdict",
    "## Findings",
    "For each finding include severity, location if any, issue, and recommendation.",
    "## Raw Concerns",
    "## Approval Recommendation",
  ].join("\n");
}

async function callPalConsensus(run: RunState, req: RunRequest) {
  const pal = req.palCommand && req.palArgs ? { command: req.palCommand, args: req.palArgs } : defaultPalCommand();
  addEvent(run, "pal_starting", { command: pal.command, args: pal.args });

  const env = await palEnv(state.cwd);
  if (!hasProviderKey(env)) {
    throw new Error("PAL needs at least one provider key. Set OPENROUTER_API_KEY in your Pi shell environment, project .env, project .pal.env, ~/.pal/.env, or ~/.claude/.env.");
  }

  const client = new Client({ name: "pi-pal-consensus-sidecar", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: pal.command, args: pal.args, env });
  await client.connect(transport);

  try {
    const tools = await client.listTools();
    const toolNames = (tools.tools ?? []).map((tool: any) => tool.name);
    addEvent(run, "pal_connected", { tools: toolNames });
    if (!toolNames.includes("consensus")) throw new Error(`PAL MCP did not expose a consensus tool. Tools: ${toolNames.join(", ")}`);

    const planText = await readFile(req.planFile, "utf8");
    const sharedPrompt = [
      `Review this plan file: ${req.planFile}`,
      "",
      "The plan content is also embedded below so every reviewer receives identical context.",
      "",
      "--- PLAN START ---",
      planText,
      "--- PLAN END ---",
      "",
      "Goal: identify concrete risks, gaps, disagreements, and approval-blocking issues. Do not explore the repository unless the plan explicitly requires it; focus on the frozen plan.",
    ].join("\n");

    const models = req.reviewers.map((reviewer) => ({ model: reviewer.model, stance: reviewer.stance ?? "neutral", stance_prompt: reviewerPrompt(reviewer) }));
    const rawResponses: any[] = [];

    for (let i = 0; i < req.reviewers.length; i++) {
      const reviewer = req.reviewers[i];
      addEvent(run, "reviewer_started", { reviewer: reviewer.id, label: reviewer.label, model: reviewer.model });
      const args: Record<string, unknown> = {
        step: i === 0 ? sharedPrompt : `Continue PAL consensus run for ${basename(req.planFile)}. Previous reviewer output has been recorded by the sidecar. Consult the next configured reviewer only.`,
        step_number: i + 1,
        total_steps: req.reviewers.length,
        next_step_required: i + 1 < req.reviewers.length,
        findings: i === 0 ? "Starting plan-file consensus review from the frozen plan." : "Previous reviewer feedback stored by sidecar; continue to next reviewer.",
        relevant_files: [req.planFile],
        current_model_index: i,
      };
      if (i === 0) args.models = models;

      const result = await client.callTool({ name: "consensus", arguments: args });
      const text = textFromToolResult(result);
      const parsed = safeJson(text);
      rawResponses.push(parsed ?? { text });

      const jsonPath = join(run.artifactDir, `${reviewer.id}.json`);
      const mdPath = join(run.artifactDir, `${reviewer.id}.md`);
      const modelResponse = parsed?.model_response ?? parsed;
      const markdown = modelResponse?.verdict || modelResponse?.content || modelResponse?.text || text;
      await writeFile(jsonPath, JSON.stringify(parsed ?? { text }, null, 2));
      await writeFile(mdPath, String(markdown));
      run.rawArtifacts.push(jsonPath, mdPath);
      addEvent(run, "reviewer_completed", { reviewer: reviewer.id, label: reviewer.label, model: reviewer.model, jsonPath, mdPath });
    }

    const findings = {
      run_id: run.id,
      status: "complete",
      plan_file: req.planFile,
      generated_at: new Date().toISOString(),
      reviewers: req.reviewers,
      raw_artifacts: run.rawArtifacts,
      compact_findings_note: "This first sidecar version preserves PAL raw reviewer output. Use the raw artifacts for detailed findings; schema normalization can be layered on next.",
      pal_responses: rawResponses,
    };
    const findingsPath = join(run.artifactDir, "findings.json");
    await writeFile(findingsPath, JSON.stringify(findings, null, 2));
    run.findingsPath = findingsPath;
    addEvent(run, "synthesis_completed", { findingsPath });
  } finally {
    await client.close();
  }
}

async function startRun(req: RunRequest, cwd: string): Promise<RunState> {
  const runId = `pal-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const artifactRoot = resolve(cwd, req.artifactRoot ?? join(".pi", "pal-consensus-runs"));
  const artifactDir = join(artifactRoot, runId);
  await mkdir(artifactDir, { recursive: true });
  const run: RunState = {
    id: runId,
    status: "queued",
    startedAt: new Date().toISOString(),
    planFile: req.planFile,
    artifactDir,
    reviewers: req.reviewers,
    events: [],
    rawArtifacts: [],
  };
  state.runs.set(runId, run);
  addEvent(run, "run_queued", { runId, artifactDir, planFile: req.planFile });
  void (async () => {
    try {
      run.status = "running";
      addEvent(run, "run_started", { runId });
      await callPalConsensus(run, req);
      run.status = "complete";
      run.completedAt = new Date().toISOString();
      addEvent(run, "run_completed", { runId, findingsPath: run.findingsPath });
    } catch (error) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.error = error instanceof Error ? error.message : String(error);
      addEvent(run, "run_failed", { runId, error: run.error });
    }
  })();
  return run;
}

function serveEvents(run: RunState, res: ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  for (const event of run.events) {
    res.write(`id: ${event.id}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify({ at: event.at, ...event.data })}\n\n`);
  }
  let clients = state.clients.get(run.id);
  if (!clients) state.clients.set(run.id, (clients = new Set()));
  clients.add(res);
  const ping = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000);
  res.on("close", () => {
    clearInterval(ping);
    clients?.delete(res);
  });
}

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PAL Consensus Sidecar</title>
<style>
:root{--ink:#1c1712;--muted:#73695f;--paper:#f4eadc;--card:#fffaf1;--line:#30241b;--amber:#e9a93a;--teal:#1d8b84;--red:#c94b3d;--green:#477a38;--shadow:8px 8px 0 #1c1712}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0%,#ffe2a8 0 18rem,transparent 18rem),linear-gradient(135deg,#f7ecd8,#ead8bd);color:var(--ink);font-family:Georgia,'Times New Roman',serif}.wrap{max-width:1180px;margin:0 auto;padding:34px 22px 60px}.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:24px;align-items:stretch}.panel{background:var(--card);border:2px solid var(--line);box-shadow:var(--shadow);border-radius:22px;padding:24px}.kicker{font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--teal)}h1{font-size:clamp(42px,7vw,86px);line-height:.9;margin:12px 0 18px;letter-spacing:-.06em}.lede{font-size:20px;color:var(--muted);line-height:1.45}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:16px}label{display:block;font:700 12px/1.2 ui-monospace,monospace;text-transform:uppercase;margin:10px 0 6px;color:#4c4037}input,textarea,select{width:100%;border:2px solid var(--line);border-radius:14px;background:#fffdfa;padding:12px 13px;font:15px/1.35 ui-monospace,monospace;color:var(--ink)}textarea{min-height:88px;resize:vertical}.reviewer{border:2px dashed #8f7c68;border-radius:18px;padding:14px;background:#fff5e4;margin:12px 0}.btns{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}button{border:2px solid var(--line);background:var(--amber);border-radius:999px;padding:12px 18px;font:800 13px/1 ui-monospace,monospace;text-transform:uppercase;box-shadow:4px 4px 0 var(--line);cursor:pointer}button.secondary{background:#fffaf1}button:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--line)}.runs{margin-top:28px;display:grid;grid-template-columns:360px 1fr;gap:18px}.run-list{display:flex;flex-direction:column;gap:10px}.run-card{background:#fffaf1;border:2px solid var(--line);border-radius:18px;padding:14px;cursor:pointer}.run-card.active{background:#d9f0e8}.status{display:inline-block;padding:4px 8px;border:1px solid var(--line);border-radius:999px;font:700 11px ui-monospace,monospace;text-transform:uppercase}.status.complete{background:#dceccc}.status.failed{background:#ffd8d2}.status.running{background:#fff0bd}.events{background:#17120e;color:#f8ead6;border-radius:20px;border:2px solid var(--line);padding:18px;min-height:360px;box-shadow:var(--shadow);font:13px/1.45 ui-monospace,monospace;overflow:auto}.event{border-bottom:1px solid #4f4034;padding:10px 0}.event b{color:#ffd27d}.path{color:#90e0d6;word-break:break-all}.small{font:12px/1.4 ui-monospace,monospace;color:var(--muted)}@media(max-width:900px){.hero,.runs{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}</style>
</head>
<body><div class="wrap"><section class="hero"><div class="panel"><div class="kicker">PAL MCP × Local SSE</div><h1>Consensus run room</h1><p class="lede">Submit a markdown plan, assign reviewer roles, and watch PAL MCP consult each model while raw artifacts land on disk.</p><p class="small">Default PAL command comes from <code>PAL_MCP_COMMAND</code>/<code>PAL_MCP_ARGS</code> or uvx.</p></div><form id="form" class="panel"><label>Plan file path</label><input id="planFile" placeholder="/tmp/pal-test-plan.md" required /><div id="reviewers"></div><div class="btns"><button type="button" class="secondary" id="addReviewer">Add reviewer</button><button type="submit">Start PAL run</button></div></form></section><section class="runs"><div><h2>Runs</h2><div id="runList" class="run-list"></div></div><div><h2>Event stream</h2><div id="events" class="events">No run selected.</div></div></section></div><script>
const reviewersEl=document.getElementById('reviewers'), runList=document.getElementById('runList'), eventsEl=document.getElementById('events');
const defaults=[['security','Security Reviewer','o3','Focus on abuse cases, key handling, prompt injection, local server exposure.'],['architecture','Architecture Reviewer','pro','Focus on clean boundaries, implementation complexity, and OpenCode Zen/Go compatibility.'],['budget','Cost Reviewer','flash','Focus on model-call count, token budget, OpenRouter cost risk, and ways to cap spend.']];
let reviewerCount=0, selectedRun=null, sources={};
function addReviewer(d){const i=reviewerCount++; const v=d||['reviewer-'+i,'Reviewer '+(i+1),'pro','Review for correctness and risks.']; const div=document.createElement('div'); div.className='reviewer'; div.innerHTML='<div class="grid"><div><label>ID</label><input name="id" value="'+v[0]+'"></div><div><label>Label</label><input name="label" value="'+v[1]+'"></div><div><label>PAL model</label><input name="model" value="'+v[2]+'"></div></div><label>Role prompt</label><textarea name="prompt">'+v[3]+'</textarea>'; reviewersEl.appendChild(div)}
defaults.forEach(addReviewer); document.getElementById('addReviewer').onclick=()=>addReviewer();
function collectReviewers(){return [...document.querySelectorAll('.reviewer')].map(r=>({id:r.querySelector('[name=id]').value,label:r.querySelector('[name=label]').value,model:r.querySelector('[name=model]').value,stance:'neutral',prompt:r.querySelector('[name=prompt]').value}))}
document.getElementById('form').onsubmit=async e=>{e.preventDefault(); const body={planFile:document.getElementById('planFile').value,reviewers:collectReviewers()}; const res=await fetch('/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); const json=await res.json(); if(!res.ok){alert(json.error||'failed');return} await refreshRuns(); selectRun(json.run.id)};
async function refreshRuns(){const res=await fetch('/api/runs'); const data=await res.json(); runList.innerHTML=''; data.runs.forEach(run=>{const div=document.createElement('div'); div.className='run-card '+(run.id===selectedRun?'active':''); div.onclick=()=>selectRun(run.id); div.innerHTML='<span class="status '+run.status+'">'+run.status+'</span><h3>'+run.id+'</h3><div class="small path">'+run.artifactDir+'</div>'; runList.appendChild(div)})}
function selectRun(id){selectedRun=id; refreshRuns(); eventsEl.innerHTML=''; if(sources[id]) sources[id].close(); const es=new EventSource('/api/runs/'+id+'/events'); sources[id]=es; ['run_queued','run_started','pal_starting','pal_connected','reviewer_started','reviewer_completed','synthesis_completed','run_completed','run_failed'].forEach(t=>es.addEventListener(t,e=>append(t,JSON.parse(e.data))));}
function append(type,data){const div=document.createElement('div'); div.className='event'; div.innerHTML='<b>'+type+'</b> <span class="small">'+(data.at||'')+'</span><br><span class="path">'+escapeHtml(JSON.stringify(data,null,2))+'</span>'; eventsEl.appendChild(div); eventsEl.scrollTop=eventsEl.scrollHeight; refreshRuns();}
function escapeHtml(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
refreshRuns(); setInterval(refreshRuns,5000);
</script></body></html>`;

async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, port: state.port });
    if (req.method === "GET" && url.pathname === "/api/runs") {
      return json(res, 200, { runs: [...state.runs.values()].map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt, planFile: r.planFile, artifactDir: r.artifactDir, error: r.error, findingsPath: r.findingsPath })) });
    }
    if (req.method === "POST" && url.pathname === "/api/runs") {
      const runReq = validateRunRequest(await readBody(req), state.cwd);
      const run = await startRun(runReq, state.cwd);
      return json(res, 202, { run });
    }
    const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventsMatch) {
      const run = state.runs.get(eventsMatch[1]);
      if (!run) return json(res, 404, { error: "run not found" });
      serveEvents(run, res);
      return;
    }
    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (req.method === "GET" && runMatch) {
      const run = state.runs.get(runMatch[1]);
      if (!run) return json(res, 404, { error: "run not found" });
      return json(res, 200, { run });
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function startServer(opts: { cwd: string; port?: number }): Promise<{ url: string; port: number }> {
  state.cwd = opts.cwd;
  if (state.server && state.port) return { url: `http://127.0.0.1:${state.port}`, port: state.port };
  const port = opts.port ?? Number(process.env.PAL_SIDECAR_PORT || 8787);
  state.server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolvePromise, reject) => {
    state.server!.once("error", reject);
    state.server!.listen(port, "127.0.0.1", () => resolvePromise());
  });
  state.port = port;
  return { url: `http://127.0.0.1:${port}`, port };
}

export default function palConsensusSidecarExtension(pi: ExtensionAPI) {
  pi.registerCommand("pal-sidecar", {
    description: "Start the PAL consensus dashboard sidecar: /pal-sidecar [port]",
    handler: async (args, ctx) => {
      const port = args.trim() ? Number(args.trim()) : undefined;
      const result = await startServer({ cwd: ctx.cwd, port });
      ctx.ui.notify(`PAL consensus sidecar running: ${result.url}`, "info");
    },
  });

  pi.registerTool({
    name: "start_pal_consensus_sidecar",
    label: "Start PAL Consensus Sidecar",
    description: "Start a local HTTP/SSE dashboard that drives PAL MCP consensus plan reviews.",
    promptSnippet: "Use when the user wants the PAL consensus dashboard/sidecar started.",
    parameters: Type.Object({
      port: Type.Optional(Type.Number({ description: "Local port. Defaults to PAL_SIDECAR_PORT or 8787." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await startServer({ cwd: ctx.cwd, port: params.port });
      return { content: [{ type: "text", text: `PAL consensus sidecar running: ${result.url}` }], details: result };
    },
  });
}
