import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
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
  minSuccessfulReviewers: number;
}

interface SidecarConfig {
  reviewers: ReviewerConfig[];
  minSuccessfulReviewers: number;
}

interface RunEvent {
  id: number;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

interface ReviewerArtifact {
  reviewer: ReviewerConfig;
  status: "success" | "error";
  markdown: string;
  jsonPath: string;
  mdPath: string;
  error?: string;
}

interface CompactFinding {
  severity: "critical" | "major" | "minor" | "nit" | "unknown";
  reviewer: string;
  reviewer_label: string;
  model: string;
  location?: string;
  issue: string;
  recommendation?: string;
  confidence: "high" | "medium" | "low" | "unknown";
  artifact: string;
}

interface RunState {
  id: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
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
  activePalClients: Set<Client>;
  runClosers: Map<string, () => Promise<void>>;
  cancelledRuns: Set<string>;
  csrfToken: string;
}

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_KEY = Symbol.for("pi-pal-consensus-sidecar.state");
const globalWithState = globalThis as typeof globalThis & { [STATE_KEY]?: SidecarState };
const state: SidecarState = globalWithState[STATE_KEY] ?? { cwd: process.cwd(), runs: new Map(), clients: new Map(), activePalClients: new Set(), runClosers: new Map(), cancelledRuns: new Set(), csrfToken: randomUUID() };
globalWithState[STATE_KEY] = state;

function splitShellish(input: string): string[] {
  return (input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((part) => part.replace(/^['"]|['"]$/g, ""));
}

function defaultPalCommand(): { command: string; args: string[] } {
  const command = process.env.PAL_MCP_COMMAND?.trim() || "uvx";
  const args = process.env.PAL_MCP_ARGS ? splitShellish(process.env.PAL_MCP_ARGS) : ["--from", "git+https://github.com/BeehiveInnovations/pal-mcp-server.git", "pal-mcp-server"];
  return { command, args };
}

function palCwd(): string | undefined {
  return process.env.PAL_MCP_CWD ? resolve(process.env.PAL_MCP_CWD) : undefined;
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
  const configuredPalCwd = palCwd();
  const dotenvPaths = [
    process.env.PAL_ENV_FILE ? resolve(process.env.PAL_ENV_FILE) : undefined,
    resolve(EXTENSION_DIR, ".env"),
    resolve(EXTENSION_DIR, ".pal.env"),
    resolve(cwd, ".env"),
    resolve(cwd, ".pal.env"),
    configuredPalCwd ? resolve(configuredPalCwd, ".env") : undefined,
    configuredPalCwd ? resolve(configuredPalCwd, ".pal.env") : undefined,
    join(homedir(), ".pal", ".env"),
    join(homedir(), ".claude", ".env"),
  ].filter((path): path is string => Boolean(path));
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

async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function loadSidecarConfig(cwd: string): Promise<SidecarConfig> {
  const configPaths = [
    resolve(EXTENSION_DIR, "pal-sidecar.config.json"),
    resolve(cwd, ".pal-sidecar.json"),
    resolve(cwd, ".pi", "pal-sidecar.json"),
    process.env.PAL_SIDECAR_CONFIG ? resolve(process.env.PAL_SIDECAR_CONFIG) : undefined,
  ].filter((path): path is string => Boolean(path));

  let merged: Record<string, unknown> = {};
  for (const path of configPaths) {
    const config = await readJsonFile(path);
    if (config) merged = { ...merged, ...config };
  }

  const reviewers = Array.isArray(merged.reviewers)
    ? merged.reviewers.map((reviewer, index) => normalizeReviewer(reviewer as Partial<ReviewerConfig>, index))
    : [];
  const minSuccessfulReviewers = Number(merged.minSuccessfulReviewers ?? Math.min(2, reviewers.length));
  return {
    reviewers,
    minSuccessfulReviewers: Number.isFinite(minSuccessfulReviewers) && minSuccessfulReviewers > 0 ? Math.min(Math.floor(minSuccessfulReviewers), Math.max(reviewers.length, 1)) : Math.min(2, reviewers.length),
  };
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

function isAllowedHost(value: string | undefined): boolean {
  if (!value) return true;
  const host = value.split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

function isAllowedOrigin(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return isAllowedHost(url.host);
  } catch {
    return false;
  }
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const cookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function requestToken(req: IncomingMessage, url: URL): string | undefined {
  const header = req.headers["x-pal-sidecar-token"];
  return (Array.isArray(header) ? header[0] : header) || url.searchParams.get("token") || cookieValue(req, "pal_sidecar_token") || undefined;
}

function sidecarOrigins(): Set<string> {
  const port = state.port ?? Number(process.env.PAL_SIDECAR_PORT || 8787);
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

function requestOrigin(req: IncomingMessage): string | undefined {
  return Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
}

function requestRefererOrigin(req: IncomingMessage): string | undefined {
  const referer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
  if (!referer) return undefined;
  try {
    const url = new URL(referer);
    return url.origin;
  } catch {
    return undefined;
  }
}

function isSameSidecarRequest(req: IncomingMessage): boolean {
  const allowed = sidecarOrigins();
  const origin = requestOrigin(req);
  const refererOrigin = requestRefererOrigin(req);
  if (origin && allowed.has(origin)) return true;
  if (refererOrigin && allowed.has(refererOrigin)) return true;
  // Some local clients omit Origin/Referer. Host validation already restricts these to loopback.
  if (!origin && !refererOrigin) return true;
  return false;
}

function requireCsrf(req: IncomingMessage, url: URL) {
  if (process.env.PAL_SIDECAR_STRICT_CSRF === "0") return;
  if (requestToken(req, url) === state.csrfToken) return;
  // The sidecar is loopback-only. Treat exact same-origin dashboard requests as acceptable
  // even if a stale tab missed the current token; cross-origin localhost pages still fail.
  if (isSameSidecarRequest(req)) return;
  throw new Error("Invalid or missing sidecar CSRF token. Hard-refresh the dashboard so it receives the current token.");
}

function assertLocalRequest(req: IncomingMessage) {
  if (!isAllowedHost(req.headers.host)) throw new Error("Rejected non-local Host header.");
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (!isAllowedOrigin(origin)) throw new Error("Rejected non-local Origin header.");
}

function sanitizeId(value: string, fallback: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return cleaned || fallback;
}

function normalizeReviewer(input: Partial<ReviewerConfig>, index: number): ReviewerConfig {
  const id = sanitizeId(String(input.id || input.label || `reviewer-${index + 1}`), `reviewer-${index + 1}`);
  return {
    id,
    label: String(input.label || input.id || `Reviewer ${index + 1}`).slice(0, 96),
    model: String(input.model || "flash").slice(0, 128),
    stance: input.stance || "neutral",
    prompt: String(input.prompt || "Review the plan for correctness, risks, and actionable improvements.").slice(0, 4000),
  };
}

function splitCsv(value?: string): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function allowedPlanRoots(cwd: string): Promise<string[]> {
  const candidates = [cwd, join(homedir(), ".pi"), ...splitCsv(process.env.PAL_SIDECAR_ALLOWED_ROOTS)].map((item) => resolve(item));
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    roots.push(await realpath(candidate));
  }
  return Array.from(new Set(roots));
}

function isPathInside(file: string, root: string): boolean {
  return file === root || file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

async function validatePlanFile(path: string, cwd: string): Promise<string> {
  const resolved = resolve(cwd, path);
  if (!existsSync(resolved)) throw new Error(`Plan file not found: ${path || "(empty)"}`);
  const realFile = await realpath(resolved);
  const roots = await allowedPlanRoots(cwd);
  if (!roots.some((root) => isPathInside(realFile, root))) {
    throw new Error(`Plan file must be inside a trusted root (${roots.join(", ")}). Add roots with PAL_SIDECAR_ALLOWED_ROOTS.`);
  }
  return realFile;
}

async function validateRunRequest(raw: unknown, cwd: string): Promise<RunRequest> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (!obj.planFile) throw new Error("Plan file is required.");
  const planFile = await validatePlanFile(String(obj.planFile), cwd);
  const reviewers = Array.isArray(obj.reviewers) ? obj.reviewers.map((r, i) => normalizeReviewer(r as Partial<ReviewerConfig>, i)) : [];
  if (reviewers.length < 2) throw new Error("PAL consensus requires at least two reviewers/models.");
  const seenModelStances = new Set<string>();
  for (const reviewer of reviewers) {
    const key = `${reviewer.model}:${reviewer.stance ?? "neutral"}`;
    if (seenModelStances.has(key)) throw new Error(`Duplicate PAL model+stance pair '${key}'. PAL consensus requires each reviewer to use a unique model+stance combination.`);
    seenModelStances.add(key);
  }
  const requestedMin = Number(obj.minSuccessfulReviewers ?? Math.min(2, reviewers.length));
  return {
    planFile,
    reviewers,
    artifactRoot: obj.artifactRoot ? String(obj.artifactRoot) : undefined,
    palCommand: obj.palCommand ? String(obj.palCommand) : undefined,
    palArgs: Array.isArray(obj.palArgs) ? obj.palArgs.map(String) : undefined,
    minSuccessfulReviewers: Number.isFinite(requestedMin) && requestedMin > 0 ? Math.min(Math.floor(requestedMin), reviewers.length) : Math.min(2, reviewers.length),
  };
}

function assertNotCancelled(run: RunState) {
  if (state.cancelledRuns.has(run.id)) throw new Error("Run cancelled.");
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

function palToolFailure(text: string): string | undefined {
  if (/validation error for ConsensusRequest/i.test(text)) return text;
  if (/\b(error|exception|traceback)\b/i.test(text) && !text.trim().startsWith("{")) return text;
  return undefined;
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

function section(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "im"));
  return (match?.[1] ?? "").trim();
}

function normalizeSeverity(text: string): CompactFinding["severity"] {
  const lower = text.toLowerCase();
  if (/\b(critical|blocker|severe)\b/.test(lower)) return "critical";
  if (/\b(major|high)\b/.test(lower)) return "major";
  if (/\b(moderate|medium|minor)\b/.test(lower)) return "minor";
  if (/\b(low|nit|info|informational)\b/.test(lower)) return lower.includes("nit") ? "nit" : "minor";
  return "unknown";
}

function confidenceFromSeverity(severity: CompactFinding["severity"]): CompactFinding["confidence"] {
  if (severity === "critical" || severity === "major") return "high";
  if (severity === "minor") return "medium";
  if (severity === "nit") return "low";
  return "unknown";
}

function cleanupText(text: string): string {
  return text.replace(/^\s*[•*-]\s*/gm, "").replace(/\s+/g, " ").trim();
}

function extractField(block: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const match = block.match(new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[*-]?\\s*)?(?:Severity|Location|Issue|Recommendation|Confidence)\\s*[:：]|$)`, "i"));
    if (match?.[1]) return cleanupText(match[1]);
  }
  return undefined;
}

function splitFindingBlocks(findingsText: string): string[] {
  const lines = findingsText.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];
  const startsBlock = (line: string) => /^\s*\d+[.)]\s+/.test(line) || (/^\s*[-*]\s+/.test(line) && /\b(severity|critical|major|high|moderate|medium|minor|low|nit)\b/i.test(line));
  for (const line of lines) {
    if (startsBlock(line) && current.length) {
      blocks.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.join("\n").trim()) blocks.push(current.join("\n").trim());
  return blocks.length ? blocks : findingsText.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

function parseFindings(artifact: ReviewerArtifact): CompactFinding[] {
  if (artifact.status !== "success") return [];
  const findingsText = section(artifact.markdown, "Findings") || artifact.markdown;
  const blocks = splitFindingBlocks(findingsText);
  const parsed: CompactFinding[] = [];
  for (const block of blocks) {
    if (!/\b(issue|recommendation|risk|missing|should|must|severity|major|high|medium|low|critical)\b/i.test(block)) continue;
    const severity = normalizeSeverity(extractField(block, ["Severity"]) || block);
    const location = extractField(block, ["Location"]) || block.match(/\bLines?\s+\d+(?:\s*-\s*\d+)?\b/i)?.[0];
    const issue = extractField(block, ["Issue"]) || cleanupText(block.split(/Recommendation\s*[:：]/i)[0] || block).slice(0, 600);
    const recommendation = extractField(block, ["Recommendation"]);
    parsed.push({
      severity,
      reviewer: artifact.reviewer.id,
      reviewer_label: artifact.reviewer.label,
      model: artifact.reviewer.model,
      location,
      issue,
      recommendation,
      confidence: confidenceFromSeverity(severity),
      artifact: artifact.mdPath,
    });
  }
  return parsed;
}

function deterministicNormalize(run: RunState, req: RunRequest, artifacts: ReviewerArtifact[], rawResponses: any[]) {
  const findings = artifacts.flatMap(parseFindings);
  const failed = artifacts.filter((artifact) => artifact.status === "error");
  const hasCritical = findings.some((finding) => finding.severity === "critical");
  const hasMajor = findings.some((finding) => finding.severity === "major");
  const hasMinor = findings.some((finding) => finding.severity === "minor");
  const recommendation = failed.length === artifacts.length ? "reject" : hasCritical || failed.length ? "revise" : hasMajor || hasMinor ? "revise" : "approve";
  const rawConcernSections = artifacts.map((artifact) => section(artifact.markdown, "Raw Concerns")).filter(Boolean);
  const approvalSections = artifacts.map((artifact) => section(artifact.markdown, "Approval Recommendation")).filter(Boolean);
  const agreements = Array.from(new Set(findings.map((finding) => finding.issue.toLowerCase()).filter((issue) => issue.includes("cost") || issue.includes("timeout") || issue.includes("local") || issue.includes("path") || issue.includes("secret")).map((issue) => {
    if (issue.includes("cost")) return "Cost controls and budget visibility need explicit product support.";
    if (issue.includes("timeout")) return "Runs need timeout/cancellation safeguards.";
    if (issue.includes("local")) return "The dashboard must remain explicitly local-only.";
    if (issue.includes("path")) return "Plan-file path handling needs validation and root restrictions.";
    return "Secrets and raw logs must be scrubbed before display or persistence.";
  })));
  return {
    run_id: run.id,
    status: failed.length ? "partial" : "complete",
    plan_file: req.planFile,
    generated_at: new Date().toISOString(),
    recommendation,
    summary: `${artifacts.length - failed.length}/${artifacts.length} reviewers succeeded; ${findings.length} deterministic findings extracted.`,
    successful_reviewers: artifacts.length - failed.length,
    failed_reviewers: failed.map((artifact) => ({ reviewer: artifact.reviewer.id, model: artifact.reviewer.model, error: artifact.error })),
    min_successful_reviewers: req.minSuccessfulReviewers,
    findings,
    agreements,
    disagreements: failed.length ? ["One or more configured reviewer models failed, so consensus is incomplete."] : [],
    raw_concerns: rawConcernSections,
    approval_recommendations: approvalSections,
    raw_artifacts: run.rawArtifacts,
    pal_responses: rawResponses,
  };
}

async function callPalConsensus(run: RunState, req: RunRequest) {
  const pal = req.palCommand && req.palArgs ? { command: req.palCommand, args: req.palArgs } : defaultPalCommand();
  addEvent(run, "pal_starting", { command: pal.command, args: pal.args });

  const env = await palEnv(state.cwd);
  if (!hasProviderKey(env)) {
    throw new Error("PAL needs at least one provider key. Set OPENROUTER_API_KEY in your Pi shell environment, project .env, project .pal.env, ~/.pal/.env, or ~/.claude/.env.");
  }

  const stderrPath = join(run.artifactDir, "pal-stderr.log");
  const client = new Client({ name: "pi-pal-consensus-sidecar", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: pal.command, args: pal.args, env, cwd: palCwd(), stderr: "pipe" });
  transport.stderr?.on("data", (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    void writeFile(stderrPath, text, { flag: "a" }).catch(() => undefined);
  });
  state.activePalClients.add(client);
  state.runClosers.set(run.id, async () => {
    state.cancelledRuns.add(run.id);
    await client.close();
  });
  await client.connect(transport);

  try {
    assertNotCancelled(run);
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
    const reviewerArtifacts: ReviewerArtifact[] = [];
    let successfulReviewers = 0;

    for (let i = 0; i < req.reviewers.length; i++) {
      assertNotCancelled(run);
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
      assertNotCancelled(run);
      const text = textFromToolResult(result);
      const parsed = safeJson(text);
      const toolFailure = palToolFailure(text);
      rawResponses.push(parsed ?? { text });

      const jsonPath = join(run.artifactDir, `${reviewer.id}.json`);
      const mdPath = join(run.artifactDir, `${reviewer.id}.md`);
      const modelResponse = parsed?.model_response ?? (parsed?.model_consulted ? parsed : undefined);
      const missingExpectedModelResponse = !modelResponse;
      const responseStatus = toolFailure || missingExpectedModelResponse ? "error" : (modelResponse?.status || parsed?.status);
      const responseError = toolFailure || modelResponse?.error || parsed?.error || (missingExpectedModelResponse ? "PAL did not return a model_response for this reviewer." : undefined);
      const markdown = responseStatus === "error"
        ? `# ${reviewer.label} failed\n\nModel: ${reviewer.model}\n\n${responseError || "Unknown PAL/model error"}\n`
        : modelResponse?.verdict || modelResponse?.content || modelResponse?.text || text;
      await writeFile(jsonPath, JSON.stringify(parsed ?? { text }, null, 2));
      await writeFile(mdPath, String(markdown));
      run.rawArtifacts.push(jsonPath, mdPath);
      reviewerArtifacts.push({ reviewer, status: responseStatus === "error" ? "error" : "success", markdown: String(markdown), jsonPath, mdPath, error: responseError });
      if (responseStatus === "error") {
        addEvent(run, "reviewer_failed", { reviewer: reviewer.id, label: reviewer.label, model: reviewer.model, error: responseError || "Unknown PAL/model error", jsonPath, mdPath });
      } else {
        successfulReviewers += 1;
        addEvent(run, "reviewer_completed", { reviewer: reviewer.id, label: reviewer.label, model: reviewer.model, jsonPath, mdPath });
      }
    }

    const enoughSuccessfulReviewers = successfulReviewers >= req.minSuccessfulReviewers;
    const findings = deterministicNormalize(run, req, reviewerArtifacts, rawResponses);
    findings.status = enoughSuccessfulReviewers ? findings.status : "failed";
    const findingsPath = join(run.artifactDir, "findings.json");
    await writeFile(findingsPath, JSON.stringify(findings, null, 2));
    run.findingsPath = findingsPath;
    addEvent(run, enoughSuccessfulReviewers ? "synthesis_completed" : "synthesis_skipped", { findingsPath, successfulReviewers, minSuccessfulReviewers: req.minSuccessfulReviewers });
    if (!enoughSuccessfulReviewers) {
      throw new Error(`Only ${successfulReviewers}/${req.reviewers.length} reviewers succeeded; required ${req.minSuccessfulReviewers}. Check reviewer artifacts and pal-stderr.log.`);
    }
  } finally {
    state.runClosers.delete(run.id);
    state.activePalClients.delete(client);
    await client.close();
  }
}

async function startRun(req: RunRequest, cwd: string): Promise<RunState> {
  const runId = `pal-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const artifactRoot = resolve(cwd, req.artifactRoot ?? join(".pi", "pal-consensus-runs"));
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const artifactDir = await mkdtemp(join(artifactRoot, `${runId}-`));
  await chmod(artifactDir, 0o700);
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
  state.cancelledRuns.delete(runId);
  addEvent(run, "run_queued", { runId, artifactDir, planFile: req.planFile });
  void (async () => {
    const timeoutMs = Number(process.env.PAL_SIDECAR_RUN_TIMEOUT_MS || 10 * 60_000);
    const timeout = setTimeout(() => {
      state.cancelledRuns.add(runId);
      addEvent(run, "run_timeout", { runId, timeoutMs });
      void state.runClosers.get(runId)?.();
    }, timeoutMs);
    try {
      run.status = "running";
      addEvent(run, "run_started", { runId, timeoutMs });
      await callPalConsensus(run, req);
      run.status = "complete";
      run.completedAt = new Date().toISOString();
      addEvent(run, "run_completed", { runId, findingsPath: run.findingsPath });
    } catch (error) {
      run.status = state.cancelledRuns.has(runId) ? "cancelled" : "failed";
      run.completedAt = new Date().toISOString();
      run.error = error instanceof Error ? error.message : String(error);
      addEvent(run, run.status === "cancelled" ? "run_cancelled" : "run_failed", { runId, error: run.error });
    } finally {
      clearTimeout(timeout);
      state.cancelledRuns.delete(runId);
      state.runClosers.delete(runId);
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
const CSRF='__CSRF_TOKEN__';
const CONFIG=__SIDECAR_CONFIG__;
const defaults=(CONFIG.reviewers||[]).map(r=>[r.id,r.label,r.model,r.prompt,r.stance||'neutral']);
let reviewerCount=0, selectedRun=null, sources={};
function addReviewer(d){const i=reviewerCount++; const v=d||['reviewer-'+i,'Reviewer '+(i+1),'flash','Review for correctness and risks.','neutral']; const div=document.createElement('div'); div.className='reviewer'; div.innerHTML='<div class="grid"><div><label>ID</label><input name="id" value="'+v[0]+'"></div><div><label>Label</label><input name="label" value="'+v[1]+'"></div><div><label>PAL model</label><input name="model" value="'+v[2]+'"></div></div><label>Stance</label><select name="stance"><option value="neutral">neutral</option><option value="for">for</option><option value="against">against</option></select><label>Role prompt</label><textarea name="prompt">'+v[3]+'</textarea>'; reviewersEl.appendChild(div); div.querySelector('[name=stance]').value=v[4]||'neutral'}
defaults.forEach(addReviewer); document.getElementById('addReviewer').onclick=()=>addReviewer();
function collectReviewers(){return [...document.querySelectorAll('.reviewer')].map(r=>({id:r.querySelector('[name=id]').value,label:r.querySelector('[name=label]').value,model:r.querySelector('[name=model]').value,stance:r.querySelector('[name=stance]').value,prompt:r.querySelector('[name=prompt]').value}))}
function duplicatePair(reviewers){const seen=new Set(); for(const r of reviewers){const key=r.model+':'+(r.stance||'neutral'); if(seen.has(key)) return key; seen.add(key)} return null}
document.getElementById('form').onsubmit=async e=>{e.preventDefault(); const reviewers=collectReviewers(); const dup=duplicatePair(reviewers); if(dup){alert('PAL requires unique model+stance pairs. Duplicate: '+dup+'\nChange one reviewer model or stance.');return} const body={planFile:document.getElementById('planFile').value,reviewers,minSuccessfulReviewers:CONFIG.minSuccessfulReviewers||Math.min(2,reviewers.length)}; const res=await fetch('/api/runs',{method:'POST',headers:{'content-type':'application/json','x-pal-sidecar-token':CSRF},body:JSON.stringify(body)}); const json=await res.json(); if(!res.ok){alert(json.error||'failed');return} await refreshRuns(); selectRun(json.run.id)};
async function refreshRuns(){const res=await fetch('/api/runs'); const data=await res.json(); runList.innerHTML=''; data.runs.forEach(run=>{const div=document.createElement('div'); div.className='run-card '+(run.id===selectedRun?'active':''); div.onclick=()=>selectRun(run.id); div.innerHTML='<span class="status '+run.status+'">'+run.status+'</span><h3>'+run.id+'</h3><div class="small path">'+run.artifactDir+'</div>'+(run.status==='running'?'<button onclick="event.stopPropagation();cancelRun(\''+run.id+'\')">Cancel</button>':''); runList.appendChild(div)})}
async function cancelRun(id){await fetch('/api/runs/'+id+'/cancel',{method:'POST',headers:{'x-pal-sidecar-token':CSRF}}); await refreshRuns()}
function selectRun(id){selectedRun=id; refreshRuns(); eventsEl.innerHTML=''; if(sources[id]) sources[id].close(); const es=new EventSource('/api/runs/'+id+'/events?token='+encodeURIComponent(CSRF)); sources[id]=es; ['run_queued','run_started','pal_starting','pal_connected','reviewer_started','reviewer_completed','reviewer_failed','synthesis_completed','synthesis_skipped','run_completed','run_failed','run_timeout','run_cancelled'].forEach(t=>es.addEventListener(t,e=>append(t,JSON.parse(e.data))));}
function append(type,data){const div=document.createElement('div'); div.className='event'; div.innerHTML='<b>'+type+'</b> <span class="small">'+(data.at||'')+'</span><br><span class="path">'+escapeHtml(JSON.stringify(data,null,2))+'</span>'; eventsEl.appendChild(div); eventsEl.scrollTop=eventsEl.scrollHeight; refreshRuns();}
function escapeHtml(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
refreshRuns(); setInterval(refreshRuns,5000);
</script></body></html>`;

async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    assertLocalRequest(req);
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/") {
      const config = await loadSidecarConfig(state.cwd);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `pal_sidecar_token=${encodeURIComponent(state.csrfToken)}; Path=/; SameSite=Strict`,
      });
      res.end(html.replace(/__CSRF_TOKEN__/g, state.csrfToken).replace("__SIDECAR_CONFIG__", JSON.stringify(config)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, port: state.port });
    if (req.method === "GET" && url.pathname === "/api/config") return json(res, 200, await loadSidecarConfig(state.cwd));
    if (req.method === "GET" && url.pathname === "/api/runs") {
      return json(res, 200, { runs: [...state.runs.values()].map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt, planFile: r.planFile, artifactDir: r.artifactDir, error: r.error, findingsPath: r.findingsPath })) });
    }
    if (req.method === "POST" && url.pathname === "/api/runs") {
      requireCsrf(req, url);
      const runReq = await validateRunRequest(await readBody(req), state.cwd);
      const run = await startRun(runReq, state.cwd);
      return json(res, 202, { run });
    }
    const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventsMatch) {
      requireCsrf(req, url);
      const run = state.runs.get(eventsMatch[1]);
      if (!run) return json(res, 404, { error: "run not found" });
      serveEvents(run, res);
      return;
    }
    const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancelMatch) {
      requireCsrf(req, url);
      const run = state.runs.get(cancelMatch[1]);
      if (!run) return json(res, 404, { error: "run not found" });
      state.cancelledRuns.add(run.id);
      await state.runClosers.get(run.id)?.();
      addEvent(run, "run_cancel_requested", { runId: run.id });
      return json(res, 202, { ok: true, runId: run.id });
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

async function stopServer(): Promise<void> {
  for (const clients of state.clients.values()) {
    for (const res of clients) res.end();
  }
  state.clients.clear();
  await Promise.allSettled([...state.runClosers.values()].map((close) => close()));
  state.runClosers.clear();
  await Promise.allSettled([...state.activePalClients].map((client) => client.close()));
  state.activePalClients.clear();
  if (state.server) {
    const server = state.server;
    state.server = undefined;
    state.port = undefined;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

async function startServer(opts: { cwd: string; port?: number }): Promise<{ url: string; port: number; reused?: boolean; warning?: string }> {
  state.cwd = opts.cwd;
  if (state.server && state.port) return { url: `http://127.0.0.1:${state.port}`, port: state.port, reused: true };
  const port = opts.port ?? Number(process.env.PAL_SIDECAR_PORT || 8787);
  const server = createServer((req, res) => void handle(req, res));
  try {
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolvePromise());
    });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EADDRINUSE") {
      return { url: `http://127.0.0.1:${port}`, port, reused: true, warning: `Port ${port} is already in use; leaving the existing dashboard server in place.` };
    }
    throw error;
  }
  state.server = server;
  state.port = port;
  return { url: `http://127.0.0.1:${port}`, port };
}

export default function palConsensusSidecarExtension(pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    await stopServer();
  });

  pi.registerCommand("pal-sidecar", {
    description: "Start the PAL consensus dashboard sidecar: /pal-sidecar [port]",
    handler: async (args, ctx) => {
      const port = args.trim() ? Number(args.trim()) : undefined;
      const result = await startServer({ cwd: ctx.cwd, port });
      ctx.ui.notify(`PAL consensus sidecar running: ${result.url}${result.warning ? `\n${result.warning}` : ""}`, result.warning ? "warning" : "info");
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
      return { content: [{ type: "text", text: `PAL consensus sidecar running: ${result.url}${result.warning ? `\n${result.warning}` : ""}` }], details: result };
    },
  });
}
