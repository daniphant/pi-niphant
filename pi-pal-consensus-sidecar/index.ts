import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, writeFile } from "node:fs/promises";
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
  stackId?: string;
  stackReason?: string;
  stackCostTier?: CostTier;
  configSources?: ConfigSource[];
}

type CostTier = "low" | "medium" | "high" | "frontier" | "unknown";

interface ReviewerStack {
  id: string;
  label: string;
  description: string;
  costTier: CostTier;
  reviewers: ReviewerConfig[];
  minSuccessfulReviewers: number;
}

interface ConfigSource {
  path: string;
  kind: "default" | "project" | "env";
  status: "loaded" | "missing" | "skipped";
  reason?: string;
}

interface SidecarConfig {
  reviewers: ReviewerConfig[];
  minSuccessfulReviewers: number;
  stacks: Record<string, ReviewerStack>;
  defaultStack: string;
  autoStack: boolean;
  maxReviewers: number;
  sources: ConfigSource[];
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

interface PalContract {
  ok: boolean;
  command: string;
  args: string[];
  tools: string[];
  required: {
    consensus: boolean;
    listmodels: boolean;
    version: boolean;
  };
  providerKeysPresent: boolean;
  checkedAt: string;
}

interface PalModelInfo {
  id: string;
  provider?: string;
  aliases?: string[];
  raw?: unknown;
}

interface PalModelsResponse {
  enabled: boolean;
  generated_at: string;
  stale_at: string;
  from_cache: boolean;
  ttl_ms: number;
  contract: PalContract;
  models: PalModelInfo[];
  stacks: Record<string, StackAvailability>;
  raw?: unknown;
}

interface StackAvailability {
  available: number;
  unknown: number;
  unavailable: number;
  reviewers: Array<{
    id: string;
    label: string;
    model: string;
    availability: "available" | "unavailable" | "unknown";
  }>;
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
  modelDiscoveryCache?: { expiresAt: number; response: PalModelsResponse };
}

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = resolve(EXTENSION_DIR, "dashboard-build");
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

function mcpRequestTimeoutMs(): number {
  const value = Number(process.env.PAL_SIDECAR_MCP_REQUEST_TIMEOUT_MS || 9 * 60_000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 9 * 60_000;
}

function modelDiscoveryEnabled(): boolean {
  return process.env.PAL_SIDECAR_MODEL_DISCOVERY !== "0" && process.env.PAL_SIDECAR_MODEL_DISCOVERY !== "false";
}

function modelDiscoveryTtlMs(): number {
  const value = Number(process.env.PAL_SIDECAR_MODEL_CACHE_TTL_MS || 5 * 60_000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5 * 60_000;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function stackLabel(id: string): string {
  return id.split(/[-_]/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

function maxReviewers(): number {
  const value = Number(process.env.PAL_SIDECAR_MAX_REVIEWERS || 16);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 16;
}

function requireNonEmpty(value: unknown, path: string, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Invalid sidecar config: ${path} must be a non-empty string.`);
  if (text.length > maxLength) throw new Error(`Invalid sidecar config: ${path} must be at most ${maxLength} characters.`);
  return text;
}

function normalizeStance(value: unknown, path: string): "for" | "against" | "neutral" {
  const stance = String(value ?? "neutral").trim();
  if (stance !== "for" && stance !== "against" && stance !== "neutral") throw new Error(`Invalid sidecar config: ${path} must be one of: for, against, neutral.`);
  return stance;
}

function normalizeCostTier(value: unknown): CostTier {
  const tier = String(value ?? "unknown").trim();
  return tier === "low" || tier === "medium" || tier === "high" || tier === "frontier" ? tier : "unknown";
}

function normalizeReviewer(input: Partial<ReviewerConfig>, index: number, path = `reviewers[${index}]`): ReviewerConfig {
  const rawId = requireNonEmpty(input.id || input.label || `reviewer-${index + 1}`, `${path}.id`, 96);
  const id = sanitizeId(rawId, `reviewer-${index + 1}`);
  if (id !== rawId && input.id) throw new Error(`Invalid sidecar config: ${path}.id may only contain letters, numbers, underscores, and dashes after normalization; received '${rawId}'.`);
  return {
    id,
    label: requireNonEmpty(input.label || input.id || `Reviewer ${index + 1}`, `${path}.label`, 96),
    model: requireNonEmpty(input.model, `${path}.model`, 128),
    stance: normalizeStance(input.stance, `${path}.stance`),
    prompt: requireNonEmpty(input.prompt || "Review the plan for correctness, risks, and actionable improvements.", `${path}.prompt`, 4000),
  };
}

function assertValidReviewerSet(reviewers: ReviewerConfig[], path: string, max = maxReviewers()) {
  if (reviewers.length < 2) throw new Error(`Invalid sidecar config: ${path} must include at least 2 reviewers.`);
  if (reviewers.length > max) throw new Error(`Invalid sidecar config: ${path} has ${reviewers.length} reviewers, above PAL_SIDECAR_MAX_REVIEWERS=${max}.`);
  const ids = new Set<string>();
  const modelStances = new Set<string>();
  for (const reviewer of reviewers) {
    if (ids.has(reviewer.id)) throw new Error(`Invalid sidecar config: duplicate reviewer id '${reviewer.id}' in ${path}.`);
    ids.add(reviewer.id);
    const key = `${reviewer.model}:${reviewer.stance ?? "neutral"}`;
    if (modelStances.has(key)) throw new Error(`Invalid sidecar config: duplicate PAL model+stance pair '${key}' in ${path}. PAL consensus requires unique model+stance combinations.`);
    modelStances.add(key);
  }
}

function normalizeMinSuccessful(value: unknown, reviewerCount: number, path: string): number {
  const min = Number(value ?? Math.min(2, reviewerCount));
  if (!Number.isInteger(min) || min < 1 || min > reviewerCount) throw new Error(`Invalid sidecar config: ${path} must be an integer from 1 to reviewer count (${reviewerCount}).`);
  return min;
}

function normalizeStack(id: string, raw: Record<string, unknown>): ReviewerStack {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid sidecar config: stack id '${id}' must contain only letters, numbers, underscores, and dashes.`);
  const reviewers = Array.isArray(raw.reviewers) ? raw.reviewers.map((reviewer, index) => normalizeReviewer(reviewer as Partial<ReviewerConfig>, index, `stacks.${id}.reviewers[${index}]`)) : [];
  assertValidReviewerSet(reviewers, `stacks.${id}.reviewers`);
  return {
    id,
    label: String(raw.label || stackLabel(id)).slice(0, 96),
    description: String(raw.description || "").slice(0, 500),
    costTier: normalizeCostTier(raw.costTier),
    reviewers,
    minSuccessfulReviewers: normalizeMinSuccessful(raw.minSuccessfulReviewers, reviewers.length, `stacks.${id}.minSuccessfulReviewers`),
  };
}

async function loadBuiltinStacks(): Promise<Record<string, ReviewerStack>> {
  const dir = resolve(EXTENSION_DIR, "stacks");
  if (!existsSync(dir)) return {};
  const entries = await readdir(dir);
  const stacks: Record<string, ReviewerStack> = {};
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.replace(/\.json$/, "");
    const raw = await readJsonFile(resolve(dir, entry));
    if (raw) stacks[id] = normalizeStack(id, raw);
  }
  return stacks;
}

function normalizeStacks(raw: unknown): Record<string, ReviewerStack> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const stacks: Record<string, ReviewerStack> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value)) stacks[id] = normalizeStack(id, value as Record<string, unknown>);
  }
  return stacks;
}

async function loadSidecarConfig(cwd: string): Promise<SidecarConfig> {
  const ignoreProjectConfig = process.env.PAL_SIDECAR_IGNORE_PROJECT_CONFIG === "1" || process.env.PAL_SIDECAR_IGNORE_PROJECT_CONFIG === "true";
  const configCandidates: ConfigSource[] = [
    { path: resolve(EXTENSION_DIR, "pal-sidecar.config.json"), kind: "default", status: "missing" },
    { path: resolve(cwd, ".pal-sidecar.json"), kind: "project", status: ignoreProjectConfig ? "skipped" : "missing", reason: ignoreProjectConfig ? "PAL_SIDECAR_IGNORE_PROJECT_CONFIG is enabled." : undefined },
    { path: resolve(cwd, ".pi", "pal-sidecar.json"), kind: "project", status: ignoreProjectConfig ? "skipped" : "missing", reason: ignoreProjectConfig ? "PAL_SIDECAR_IGNORE_PROJECT_CONFIG is enabled." : undefined },
    ...(process.env.PAL_SIDECAR_CONFIG ? [{ path: resolve(process.env.PAL_SIDECAR_CONFIG), kind: "env" as const, status: "missing" as const }] : []),
  ];

  let merged: Record<string, unknown> = {};
  let stacks = await loadBuiltinStacks();
  const sources: ConfigSource[] = [];
  for (const candidate of configCandidates) {
    const source = { ...candidate };
    if (source.status === "skipped") {
      sources.push(source);
      continue;
    }
    const config = await readJsonFile(source.path);
    if (config) {
      stacks = { ...stacks, ...normalizeStacks(config.stacks) };
      merged = { ...merged, ...config };
      source.status = "loaded";
    } else {
      source.status = "missing";
    }
    sources.push(source);
  }

  const defaultStack = String(merged.defaultStack || "standard-modern");
  const selectedStack = stacks[defaultStack];
  if (!selectedStack) throw new Error(`Invalid sidecar config: defaultStack '${defaultStack}' does not exist. Available stacks: ${Object.keys(stacks).join(", ")}`);
  const reviewers = Array.isArray(merged.reviewers)
    ? merged.reviewers.map((reviewer, index) => normalizeReviewer(reviewer as Partial<ReviewerConfig>, index, `reviewers[${index}]`))
    : selectedStack.reviewers;
  assertValidReviewerSet(reviewers, "reviewers");
  const minSuccessfulReviewers = normalizeMinSuccessful(merged.minSuccessfulReviewers ?? selectedStack.minSuccessfulReviewers, reviewers.length, "minSuccessfulReviewers");
  return {
    reviewers,
    minSuccessfulReviewers,
    stacks,
    defaultStack,
    autoStack: merged.autoStack !== false,
    maxReviewers: maxReviewers(),
    sources,
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}

const dashboardCsp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function serveDashboardAsset(urlPath: string, res: ServerResponse, csrfToken: string): Promise<boolean> {
  const relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.replace(/^\/+/, ""));
  const candidate = resolve(DASHBOARD_DIR, relative);
  if (!isPathInside(candidate, DASHBOARD_DIR) || !existsSync(candidate)) return false;
  const bytes = await readFile(candidate);
  res.writeHead(200, {
    "content-type": contentType(candidate),
    "cache-control": candidate.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    "content-security-policy": dashboardCsp,
    "x-content-type-options": "nosniff",
    "set-cookie": `pal_sidecar_token=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict`,
  });
  res.end(bytes);
  return true;
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

function chooseStack(planText: string, config: SidecarConfig): { stackId: string; reason: string } {
  const text = planText.toLowerCase();
  const available = config.stacks;
  const has = (id: string) => Boolean(available[id]);
  if (/\b(budget|cost|cheap|cheaper|spend|token|prototype|spike|demo|mvp|minimal|smallest)\b/.test(text) && has("budget")) {
    return { stackId: "budget", reason: "Plan emphasizes cost, budget, MVP, prototype, or smallest-useful-scope concerns." };
  }
  if (/\b(open[- ]source|oss|local model|china|qwen|deepseek|glm|kimi|open model|provider diversity)\b/.test(text) && has("china-open")) {
    return { stackId: "china-open", reason: "Plan references open/china model ecosystem or provider diversity." };
  }
  if (/\b(production|enterprise|security|privacy|auth|payment|migration|high[- ]stakes|compliance|data loss|secret|rollout)\b/.test(text) && has("frontier-modern")) {
    return { stackId: "frontier-modern", reason: "Plan appears high-stakes or production/security sensitive." };
  }
  if (has("standard-modern")) return { stackId: "standard-modern", reason: "Default balanced stack for general technical plans." };
  return { stackId: config.defaultStack, reason: "Fallback to configured default stack." };
}

function assertUniqueModelStances(reviewers: ReviewerConfig[]) {
  const seenModelStances = new Set<string>();
  for (const reviewer of reviewers) {
    const key = `${reviewer.model}:${reviewer.stance ?? "neutral"}`;
    if (seenModelStances.has(key)) throw new Error(`Duplicate PAL model+stance pair '${key}'. PAL consensus requires each reviewer to use a unique model+stance combination.`);
    seenModelStances.add(key);
  }
}

async function validateRunRequest(raw: unknown, cwd: string): Promise<RunRequest> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (!obj.planFile) throw new Error("Plan file is required.");
  const planFile = await validatePlanFile(String(obj.planFile), cwd);
  const config = await loadSidecarConfig(cwd);
  const planText = await readFile(planFile, "utf8");
  const requestedStack = obj.stackId ? String(obj.stackId) : undefined;
  let stackId = requestedStack;
  let stackReason = "Explicit reviewers supplied by request.";
  if (!Array.isArray(obj.reviewers) || obj.reviewers.length === 0 || requestedStack === "auto" || (requestedStack && requestedStack !== "custom")) {
    const selected = requestedStack === "auto" || !requestedStack ? chooseStack(planText, config) : { stackId: requestedStack, reason: "Explicit stack selected by user." };
    const stack = config.stacks[selected.stackId];
    if (!stack) throw new Error(`Unknown reviewer stack '${selected.stackId}'. Available stacks: ${Object.keys(config.stacks).join(", ")}`);
    const requestedMin = Number(obj.minSuccessfulReviewers ?? stack.minSuccessfulReviewers);
    assertUniqueModelStances(stack.reviewers);
    return {
      planFile,
      reviewers: stack.reviewers,
      artifactRoot: obj.artifactRoot ? String(obj.artifactRoot) : undefined,
      palCommand: obj.palCommand ? String(obj.palCommand) : undefined,
      palArgs: Array.isArray(obj.palArgs) ? obj.palArgs.map(String) : undefined,
      minSuccessfulReviewers: Number.isFinite(requestedMin) && requestedMin > 0 ? Math.min(Math.floor(requestedMin), stack.reviewers.length) : stack.minSuccessfulReviewers,
      stackId: selected.stackId,
      stackReason: selected.reason,
      stackCostTier: stack.costTier,
      configSources: config.sources,
    };
  }

  const reviewers = obj.reviewers.map((r, i) => normalizeReviewer(r as Partial<ReviewerConfig>, i));
  if (reviewers.length < 2) throw new Error("PAL consensus requires at least two reviewers/models.");
  assertUniqueModelStances(reviewers);
  const requestedMin = Number(obj.minSuccessfulReviewers ?? Math.min(2, reviewers.length));
  stackId = "custom";
  return {
    planFile,
    reviewers,
    artifactRoot: obj.artifactRoot ? String(obj.artifactRoot) : undefined,
    palCommand: obj.palCommand ? String(obj.palCommand) : undefined,
    palArgs: Array.isArray(obj.palArgs) ? obj.palArgs.map(String) : undefined,
    minSuccessfulReviewers: Number.isFinite(requestedMin) && requestedMin > 0 ? Math.min(Math.floor(requestedMin), reviewers.length) : Math.min(2, reviewers.length),
    stackId,
    stackReason,
    stackCostTier: "unknown",
    configSources: config.sources,
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

function toolNamesFromListTools(result: any): string[] {
  return (result?.tools ?? []).map((tool: any) => String(tool?.name ?? "")).filter(Boolean).sort();
}

function providerFromModelId(id: string): string | undefined {
  const provider = id.includes("/") ? id.split("/")[0] : undefined;
  return provider || undefined;
}

function normalizeModelInfo(value: unknown): PalModelInfo | undefined {
  if (typeof value === "string") return { id: value, provider: providerFromModelId(value) };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const idValue = record.id ?? record.model ?? record.name ?? record.slug;
  if (typeof idValue !== "string" || !idValue.trim()) return undefined;
  const aliases = Array.isArray(record.aliases) ? record.aliases.filter((alias): alias is string => typeof alias === "string" && Boolean(alias.trim())) : undefined;
  const provider = typeof record.provider === "string" ? record.provider : providerFromModelId(idValue);
  return { id: idValue.trim(), provider, aliases, raw: value };
}

function collectModelInfos(raw: unknown): PalModelInfo[] {
  const byId = new Map<string, PalModelInfo>();
  const add = (model: PalModelInfo | undefined) => {
    if (!model) return;
    const existing = byId.get(model.id);
    if (!existing) byId.set(model.id, model);
    else if (!existing.aliases && model.aliases) existing.aliases = model.aliases;
  };
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(trimmed)) add(normalizeModelInfo(trimmed));
      for (const match of trimmed.matchAll(/\b[a-z0-9_.-]+\/[a-z0-9_.:-]+\b/gi)) add(normalizeModelInfo(match[0]));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const normalized = normalizeModelInfo(item);
        if (normalized) add(normalized);
        else visit(item, depth + 1);
      }
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const normalized = normalizeModelInfo(record);
      if (normalized) add(normalized);
      for (const key of ["models", "available_models", "data", "items", "result", "providers", "text", "content"]) visit(record[key], depth + 1);
      if (record.providers && typeof record.providers === "object" && !Array.isArray(record.providers)) {
        for (const providerValue of Object.values(record.providers as Record<string, unknown>)) visit(providerValue, depth + 1);
      }
    }
  };
  visit(raw);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function stackAvailability(config: SidecarConfig, models: PalModelInfo[]): Record<string, StackAvailability> {
  const availableIds = new Set<string>();
  for (const model of models) {
    availableIds.add(model.id);
    for (const alias of model.aliases ?? []) availableIds.add(alias);
  }
  const known = models.length > 0;
  const stacks: Record<string, StackAvailability> = {};
  for (const [stackId, stack] of Object.entries(config.stacks)) {
    const reviewers = stack.reviewers.map((reviewer) => {
      const availability: "available" | "unavailable" | "unknown" = known ? (availableIds.has(reviewer.model) ? "available" : "unavailable") : "unknown";
      return { id: reviewer.id, label: reviewer.label, model: reviewer.model, availability };
    });
    stacks[stackId] = {
      available: reviewers.filter((reviewer) => reviewer.availability === "available").length,
      unavailable: reviewers.filter((reviewer) => reviewer.availability === "unavailable").length,
      unknown: reviewers.filter((reviewer) => reviewer.availability === "unknown").length,
      reviewers,
    };
  }
  return stacks;
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

async function withPalClient<T>(cwd: string, operation: (client: Client, pal: { command: string; args: string[] }, env: Record<string, string>) => Promise<T>): Promise<T> {
  const pal = defaultPalCommand();
  const env = await palEnv(cwd);
  const client = new Client({ name: "pi-pal-consensus-sidecar", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: pal.command, args: pal.args, env, cwd: palCwd(), stderr: "pipe" });
  state.activePalClients.add(client);
  await client.connect(transport);
  try {
    return await operation(client, pal, env);
  } finally {
    state.activePalClients.delete(client);
    await client.close();
  }
}

async function inspectPalContract(cwd: string): Promise<PalContract> {
  return withPalClient(cwd, async (client, pal, env) => {
    const tools = toolNamesFromListTools(await client.listTools(undefined, { timeout: mcpRequestTimeoutMs() }));
    return {
      ok: tools.includes("consensus") && tools.includes("listmodels"),
      command: pal.command,
      args: pal.args,
      tools,
      required: {
        consensus: tools.includes("consensus"),
        listmodels: tools.includes("listmodels"),
        version: tools.includes("version"),
      },
      providerKeysPresent: hasProviderKey(env),
      checkedAt: new Date().toISOString(),
    };
  });
}

async function discoverPalModels(cwd: string, refresh = false): Promise<PalModelsResponse> {
  if (!modelDiscoveryEnabled()) {
    const pal = defaultPalCommand();
    const now = new Date().toISOString();
    return {
      enabled: false,
      generated_at: now,
      stale_at: now,
      from_cache: false,
      ttl_ms: 0,
      contract: {
        ok: false,
        command: pal.command,
        args: pal.args,
        tools: [],
        required: { consensus: false, listmodels: false, version: false },
        providerKeysPresent: false,
        checkedAt: now,
      },
      models: [],
      stacks: {},
    };
  }
  const ttlMs = modelDiscoveryTtlMs();
  if (!refresh && state.modelDiscoveryCache && state.modelDiscoveryCache.expiresAt > Date.now()) {
    return { ...state.modelDiscoveryCache.response, from_cache: true };
  }
  const config = await loadSidecarConfig(cwd);
  const response = await withPalClient(cwd, async (client, pal, env) => {
    const tools = toolNamesFromListTools(await client.listTools(undefined, { timeout: mcpRequestTimeoutMs() }));
    const contract: PalContract = {
      ok: tools.includes("consensus") && tools.includes("listmodels"),
      command: pal.command,
      args: pal.args,
      tools,
      required: {
        consensus: tools.includes("consensus"),
        listmodels: tools.includes("listmodels"),
        version: tools.includes("version"),
      },
      providerKeysPresent: hasProviderKey(env),
      checkedAt: new Date().toISOString(),
    };
    if (!contract.required.listmodels) throw new Error(`PAL MCP did not expose a listmodels tool. Tools: ${tools.join(", ")}`);
    const rawResult = await client.callTool({ name: "listmodels", arguments: {} }, undefined, { timeout: mcpRequestTimeoutMs() });
    const text = textFromToolResult(rawResult);
    const parsed = safeJson(text) ?? { text };
    const models = collectModelInfos(parsed);
    const generated = new Date();
    return {
      enabled: true,
      generated_at: generated.toISOString(),
      stale_at: new Date(generated.getTime() + ttlMs).toISOString(),
      from_cache: false,
      ttl_ms: ttlMs,
      contract,
      models,
      stacks: stackAvailability(config, models),
      raw: parsed,
    } satisfies PalModelsResponse;
  });
  state.modelDiscoveryCache = { expiresAt: Date.now() + ttlMs, response };
  return response;
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
    stack_id: req.stackId,
    stack_reason: req.stackReason,
    stack_cost_tier: req.stackCostTier,
    config_sources: req.configSources,
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
    const requestTimeoutMs = mcpRequestTimeoutMs();
    const tools = await client.listTools(undefined, { timeout: requestTimeoutMs });
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

      const jsonPath = join(run.artifactDir, `${reviewer.id}.json`);
      const mdPath = join(run.artifactDir, `${reviewer.id}.md`);
      let parsed: any;
      let markdown = "";
      let responseStatus: unknown;
      let responseError: string | undefined;
      try {
        const result = await client.callTool({ name: "consensus", arguments: args }, undefined, { timeout: requestTimeoutMs });
        assertNotCancelled(run);
        const text = textFromToolResult(result);
        parsed = safeJson(text);
        const toolFailure = palToolFailure(text);
        rawResponses.push(parsed ?? { text });

        const modelResponse = parsed?.model_response ?? (parsed?.model_consulted ? parsed : undefined);
        const missingExpectedModelResponse = !modelResponse;
        responseStatus = toolFailure || missingExpectedModelResponse ? "error" : (modelResponse?.status || parsed?.status);
        responseError = toolFailure || modelResponse?.error || parsed?.error || (missingExpectedModelResponse ? "PAL did not return a model_response for this reviewer." : undefined);
        markdown = responseStatus === "error"
          ? `# ${reviewer.label} failed\n\nModel: ${reviewer.model}\n\n${responseError || "Unknown PAL/model error"}\n`
          : modelResponse?.verdict || modelResponse?.content || modelResponse?.text || text;
      } catch (error) {
        assertNotCancelled(run);
        responseStatus = "error";
        responseError = error instanceof Error ? error.message : String(error);
        parsed = { error: responseError, reviewer: reviewer.id, model: reviewer.model };
        rawResponses.push(parsed);
        markdown = `# ${reviewer.label} failed\n\nModel: ${reviewer.model}\n\n${responseError}\n`;
      }
      await writeFile(jsonPath, JSON.stringify(parsed, null, 2));
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

async function awaitRunCompletion(run: RunState, timeoutMs = Number(process.env.PAL_SIDECAR_TOOL_WAIT_TIMEOUT_MS || 20 * 60_000)): Promise<RunState> {
  const started = Date.now();
  while (run.status === "queued" || run.status === "running") {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for PAL consensus run ${run.id} after ${timeoutMs}ms. Run continues in the sidecar; artifact dir: ${run.artifactDir}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return run;
}

async function planFileFromToolInput(params: { planFile?: string; planText?: string; title?: string }, cwd: string): Promise<string> {
  if (params.planFile) return params.planFile;
  const planText = params.planText?.trim();
  if (!planText) throw new Error("Either planFile or planText is required.");
  const inputRoot = resolve(cwd, ".pi", "pal-consensus-inputs");
  await mkdir(inputRoot, { recursive: true, mode: 0o700 });
  const id = `plan-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.md`;
  const title = params.title?.trim() || "PAL Consensus Review";
  const path = join(inputRoot, id);
  await writeFile(path, `# ${title}\n\n${planText}\n`);
  await chmod(path, 0o600);
  return path;
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
  addEvent(run, "run_queued", { runId, artifactDir, planFile: req.planFile, stackId: req.stackId, stackReason: req.stackReason, stackCostTier: req.stackCostTier });
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
<body><div class="wrap"><section class="hero"><div class="panel"><div class="kicker">PAL MCP × Local SSE</div><h1>Consensus run room</h1><p class="lede">Submit a markdown plan, assign reviewer roles, and watch PAL MCP consult each model while raw artifacts land on disk.</p><p class="small">Default PAL command comes from <code>PAL_MCP_COMMAND</code>/<code>PAL_MCP_ARGS</code> or uvx.</p></div><form id="form" class="panel"><label>Plan file path</label><input id="planFile" placeholder="/tmp/pal-test-plan.md" required /><label>Reviewer stack</label><select id="stackSelect"></select><p class="small" id="stackDescription"></p><div id="reviewers"></div><div class="btns"><button type="button" class="secondary" id="addReviewer">Add reviewer</button><button type="submit">Start PAL run</button></div></form></section><section class="runs"><div><h2>Runs</h2><div id="runList" class="run-list"></div></div><div><h2>Event stream</h2><div id="events" class="events">No run selected.</div></div></section></div><script>
const reviewersEl=document.getElementById('reviewers'), runList=document.getElementById('runList'), eventsEl=document.getElementById('events'), stackSelect=document.getElementById('stackSelect'), stackDescription=document.getElementById('stackDescription');
const CSRF='__CSRF_TOKEN__';
const CONFIG=__SIDECAR_CONFIG__;
let reviewerCount=0, selectedRun=null, sources={};
function addReviewer(d){const i=reviewerCount++; const v=d||['reviewer-'+i,'Reviewer '+(i+1),'flash','Review for correctness and risks.','neutral']; const div=document.createElement('div'); div.className='reviewer'; div.innerHTML='<div class="grid"><div><label>ID</label><input name="id" value="'+v[0]+'"></div><div><label>Label</label><input name="label" value="'+v[1]+'"></div><div><label>PAL model</label><input name="model" value="'+v[2]+'"></div></div><label>Stance</label><select name="stance"><option value="neutral">neutral</option><option value="for">for</option><option value="against">against</option></select><label>Role prompt</label><textarea name="prompt">'+v[3]+'</textarea>'; reviewersEl.appendChild(div); div.querySelector('[name=stance]').value=v[4]||'neutral'}
function setReviewers(reviewers){reviewersEl.innerHTML=''; reviewerCount=0; (reviewers||[]).map(r=>[r.id,r.label,r.model,r.prompt,r.stance||'neutral']).forEach(addReviewer)}
function setupStacks(){stackSelect.innerHTML='<option value="custom">Custom form reviewers</option><option value="auto">Auto-select from plan</option>'; Object.values(CONFIG.stacks||{}).forEach(s=>{const o=document.createElement('option'); o.value=s.id; o.textContent=(s.label||s.id)+(s.costTier&&s.costTier!=='unknown'?' · '+s.costTier:''); stackSelect.appendChild(o)}); stackSelect.value=CONFIG.defaultStack||'standard-modern'; stackSelect.onchange=()=>{const s=(CONFIG.stacks||{})[stackSelect.value]; stackDescription.textContent=stackSelect.value==='auto'?'Sidecar chooses a stack from plan keywords.':(s?((s.description||s.id)+(s.costTier&&s.costTier!=='unknown'?' Cost tier: '+s.costTier+'.':'')):'Custom reviewer form'); if(s) setReviewers(s.reviewers)}; stackSelect.onchange()}
setupStacks(); document.getElementById('addReviewer').onclick=()=>{stackSelect.value='custom'; addReviewer()};
function collectReviewers(){return [...document.querySelectorAll('.reviewer')].map(r=>({id:r.querySelector('[name=id]').value,label:r.querySelector('[name=label]').value,model:r.querySelector('[name=model]').value,stance:r.querySelector('[name=stance]').value,prompt:r.querySelector('[name=prompt]').value}))}
function duplicatePair(reviewers){const seen=new Set(); for(const r of reviewers){const key=r.model+':'+(r.stance||'neutral'); if(seen.has(key)) return key; seen.add(key)} return null}
document.getElementById('form').onsubmit=async e=>{e.preventDefault(); const reviewers=collectReviewers(); const stackId=stackSelect.value; if(stackId==='custom'){const dup=duplicatePair(reviewers); if(dup){alert('PAL requires unique model+stance pairs. Duplicate: '+dup+'\nChange one reviewer model or stance.');return}} const body={planFile:document.getElementById('planFile').value,stackId,reviewers:stackId==='custom'?reviewers:[],minSuccessfulReviewers:stackId==='custom'?(CONFIG.minSuccessfulReviewers||Math.min(2,reviewers.length)):undefined}; const res=await fetch('/api/runs',{method:'POST',headers:{'content-type':'application/json','x-pal-sidecar-token':CSRF},body:JSON.stringify(body)}); const json=await res.json(); if(!res.ok){alert(json.error||'failed');return} await refreshRuns(); selectRun(json.run.id)};
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
    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
      if (process.env.PAL_SIDECAR_LEGACY_DASHBOARD === "1") {
        const config = await loadSidecarConfig(state.cwd);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "set-cookie": `pal_sidecar_token=${encodeURIComponent(state.csrfToken)}; Path=/; SameSite=Strict`,
        });
        res.end(html.replace(/__CSRF_TOKEN__/g, state.csrfToken).replace("__SIDECAR_CONFIG__", JSON.stringify(config)));
        return;
      }
      if (await serveDashboardAsset(url.pathname, res, state.csrfToken)) return;
      return json(res, 500, { error: `Dashboard assets are missing. Run 'npm run build --workspace pi-pal-consensus-sidecar' or set PAL_SIDECAR_LEGACY_DASHBOARD=1 temporarily.` });
    }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, port: state.port });
    if (req.method === "GET" && url.pathname === "/api/session") return json(res, 200, { csrfToken: state.csrfToken });
    if (req.method === "GET" && url.pathname === "/api/config") return json(res, 200, await loadSidecarConfig(state.cwd));
    if (req.method === "GET" && url.pathname === "/api/pal/contract") return json(res, 200, await inspectPalContract(state.cwd));
    if (req.method === "GET" && url.pathname === "/api/pal/models") return json(res, 200, await discoverPalModels(state.cwd, url.searchParams.get("refresh") === "1"));
    if (req.method === "POST" && url.pathname === "/api/recommend-stack") {
      requireCsrf(req, url);
      const body = (await readBody(req)) as Record<string, unknown>;
      const planFile = await validatePlanFile(String(body.planFile || ""), state.cwd);
      const config = await loadSidecarConfig(state.cwd);
      const choice = chooseStack(await readFile(planFile, "utf8"), config);
      return json(res, 200, { ...choice, stack: config.stacks[choice.stackId] });
    }
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
    name: "run_pal_consensus_review",
    label: "Run PAL Consensus Review",
    description: "Run a PAL MCP consensus review through the sidecar engine for a plan file or supplied plan text, write artifacts, and return findings metadata.",
    promptSnippet: "Use when the user asks to run PAL/sidecar consensus, review a plan with the configured reviewer stacks, or validate an architectural decision through PAL MCP.",
    parameters: Type.Object({
      planFile: Type.Optional(Type.String({ description: "Markdown plan file to review. Must be inside cwd, ~/.pi, or PAL_SIDECAR_ALLOWED_ROOTS." })),
      planText: Type.Optional(Type.String({ description: "Plan text to write to a temporary project-local .pi/pal-consensus-inputs/*.md file and review." })),
      title: Type.Optional(Type.String({ description: "Title used when planText is supplied." })),
      stackId: Type.Optional(Type.String({ description: "Reviewer stack id, e.g. auto, budget, standard-modern, frontier-modern, china-open. Defaults to auto selection." })),
      artifactRoot: Type.Optional(Type.String({ description: "Optional artifact root. Defaults to .pi/pal-consensus-runs." })),
      minSuccessfulReviewers: Type.Optional(Type.Number({ description: "Optional success threshold override." })),
      wait: Type.Optional(Type.Boolean({ description: "Wait for completion before returning. Defaults to true." })),
      waitTimeoutMs: Type.Optional(Type.Number({ description: "How long to wait for completion. Defaults to PAL_SIDECAR_TOOL_WAIT_TIMEOUT_MS or 20 minutes." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const planFile = await planFileFromToolInput({ planFile: params.planFile, planText: params.planText, title: params.title }, ctx.cwd);
      const runReq = await validateRunRequest({
        planFile,
        stackId: params.stackId || "auto",
        reviewers: [],
        artifactRoot: params.artifactRoot,
        minSuccessfulReviewers: params.minSuccessfulReviewers,
      }, ctx.cwd);
      const run = await startRun(runReq, ctx.cwd);
      const shouldWait = params.wait !== false;
      const finalRun = shouldWait ? await awaitRunCompletion(run, params.waitTimeoutMs) : run;
      let findings: unknown;
      if (finalRun.findingsPath && existsSync(finalRun.findingsPath)) {
        findings = JSON.parse(await readFile(finalRun.findingsPath, "utf8"));
      }
      const summary = [
        `PAL consensus run ${finalRun.status}: ${finalRun.id}`,
        `Plan: ${finalRun.planFile}`,
        `Stack: ${runReq.stackId ?? "custom"}${runReq.stackCostTier ? ` (${runReq.stackCostTier})` : ""}`,
        `Artifacts: ${finalRun.artifactDir}`,
        finalRun.findingsPath ? `Findings: ${finalRun.findingsPath}` : undefined,
        finalRun.error ? `Error: ${finalRun.error}` : undefined,
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text: summary }], details: { run: finalRun, findings } };
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
