import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, mkdtemp, open, readFile, realpath, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { artifactKind, artifactMediaType, buildFindingsHotspots, classifyError, classifyFindingBucket, collectModelInfos, extractCompactFindingsSummary, FINDINGS_PARSER_VERSION, FINDINGS_SCHEMA_VERSION, isSafeArtifactName, markdownSection, parseReviewerFindings, recommendStack, renderFindingsSummaryMarkdown, REVIEW_PROMPT_VERSION, SIDECAR_VERSION, stackAvailability, type FindingLike, type ModelRuntimeHealth, type PalModelInfo, type StackAvailability, type StructuredError } from "./src/core.js";

interface ReviewerConfig {
  id: string;
  label: string;
  model: string;
  stance?: "for" | "against" | "neutral";
  prompt: string;
}

interface RunWarning {
  code: string;
  message: string;
  details?: unknown;
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
  warnings?: RunWarning[];
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

interface RunState {
  id: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  planFile: string;
  artifactDir: string;
  reviewers: ReviewerConfig[];
  warnings: RunWarning[];
  events: RunEvent[];
  error?: string;
  structuredError?: StructuredError;
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
  modelRuntimeHealth: Map<string, ModelRuntimeHealth>;
}

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = resolve(EXTENSION_DIR, "dashboard-build");
const STATE_KEY = Symbol.for("pi-pal-consensus-sidecar.state");
const globalWithState = globalThis as typeof globalThis & { [STATE_KEY]?: SidecarState };
const state: SidecarState = globalWithState[STATE_KEY] ?? { cwd: process.cwd(), runs: new Map(), clients: new Map(), activePalClients: new Set(), runClosers: new Map(), cancelledRuns: new Set(), csrfToken: randomUUID(), modelRuntimeHealth: new Map() };
if (!state.modelRuntimeHealth) state.modelRuntimeHealth = new Map();
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

function modelAvailabilityPolicy(): "off" | "warn" | "block" {
  const value = String(process.env.PAL_SIDECAR_MODEL_AVAILABILITY_POLICY || "warn").trim().toLowerCase();
  return value === "off" || value === "block" ? value : "warn";
}

function modelRuntimeHealthTtlMs(): number {
  return positiveIntEnv("PAL_SIDECAR_MODEL_HEALTH_TTL_MS", 60 * 60_000);
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function maxPlanBytes(): number {
  return positiveIntEnv("PAL_SIDECAR_MAX_PLAN_BYTES", 256 * 1024);
}

function maxConcurrentRuns(): number {
  return positiveIntEnv("PAL_SIDECAR_MAX_CONCURRENT_RUNS", 1);
}

function maxRuns(): number {
  return positiveIntEnv("PAL_SIDECAR_MAX_RUNS", 50);
}

function retentionDays(): number {
  return positiveIntEnv("PAL_SIDECAR_RETENTION_DAYS", 14);
}

function shouldCleanArtifacts(): boolean {
  return process.env.PAL_SIDECAR_CLEAN_ARTIFACTS === "1" || process.env.PAL_SIDECAR_CLEAN_ARTIFACTS === "true";
}

function activeRunCount(): number {
  return [...state.runs.values()].filter((run) => run.status === "queued" || run.status === "running").length;
}

function assertConcurrentRunCapacity() {
  const active = activeRunCount();
  const max = maxConcurrentRuns();
  if (active >= max) throw new Error(`Concurrent run limit exceeded: ${active} active run(s), max ${max}. Set PAL_SIDECAR_MAX_CONCURRENT_RUNS to adjust.`);
}

function maxArtifactReadBytes(): number {
  return positiveIntEnv("PAL_SIDECAR_MAX_ARTIFACT_READ_BYTES", 1024 * 1024);
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
  const info = await stat(realFile);
  const maxBytes = maxPlanBytes();
  if (info.size > maxBytes) throw new Error(`Plan file is too large: ${info.size} bytes exceeds PAL_SIDECAR_MAX_PLAN_BYTES=${maxBytes}.`);
  return realFile;
}

function chooseStack(planText: string, config: SidecarConfig): { stackId: string; reason: string } {
  const recommendation = recommendStack(planText, config);
  return { stackId: recommendation.stackId, reason: recommendation.reason };
}

function assertUniqueModelStances(reviewers: ReviewerConfig[]) {
  const seenModelStances = new Set<string>();
  for (const reviewer of reviewers) {
    const key = `${reviewer.model}:${reviewer.stance ?? "neutral"}`;
    if (seenModelStances.has(key)) throw new Error(`Duplicate PAL model+stance pair '${key}'. PAL consensus requires each reviewer to use a unique model+stance combination.`);
    seenModelStances.add(key);
  }
}

function activeModelRuntimeHealth(): Record<string, ModelRuntimeHealth> {
  const now = Date.now();
  const active: Record<string, ModelRuntimeHealth> = {};
  for (const [model, health] of state.modelRuntimeHealth) {
    if (Date.parse(health.expiresAt) <= now) {
      state.modelRuntimeHealth.delete(model);
      continue;
    }
    active[model] = health;
  }
  return active;
}

function runtimeHealthStatus(error: StructuredError): ModelRuntimeHealth["status"] | undefined {
  if (["pal_model_no_endpoint", "pal_model_not_found", "model_unavailable"].includes(error.code)) return "unhealthy";
  if (["pal_rate_limited", "pal_quota_exceeded", "pal_provider_auth_failed", "pal_upstream_unavailable", "pal_network_error", "pal_timeout"].includes(error.code)) return "degraded";
  return undefined;
}

function recordModelRuntimeFailure(model: string, error: StructuredError, context: { runId?: string; reviewer?: string }) {
  const status = runtimeHealthStatus(error);
  if (!status) return;
  const failedAt = new Date();
  const expiresAt = new Date(failedAt.getTime() + modelRuntimeHealthTtlMs());
  state.modelRuntimeHealth.set(model, {
    model,
    status,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    guidance: error.guidance,
    failedAt: failedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    runId: context.runId,
    reviewer: context.reviewer,
  });
  state.modelDiscoveryCache = undefined;
}

function clearModelRuntimeHealth(model: string) {
  if (state.modelRuntimeHealth.delete(model)) state.modelDiscoveryCache = undefined;
}

async function modelAvailabilityWarnings(cwd: string, stackId: string): Promise<RunWarning[]> {
  const policy = modelAvailabilityPolicy();
  if (policy === "off" || stackId === "custom" || stackId === "auto") return [];
  try {
    const discovery = await discoverPalModels(cwd, false);
    if (!discovery.enabled) return [];
    const stack = discovery.stacks[stackId];
    if (!stack) return [];
    const unavailable = stack.reviewers.filter((reviewer) => reviewer.availability === "unavailable");
    const runtimeUnhealthy = stack.reviewers.filter((reviewer) => reviewer.runtimeHealth?.status === "unhealthy");
    const runtimeDegraded = stack.reviewers.filter((reviewer) => reviewer.runtimeHealth?.status === "degraded");
    const warnings: RunWarning[] = [];
    if (unavailable.length) warnings.push({
      code: "model_availability_warning",
      message: `Selected stack '${stackId}' has ${unavailable.length} reviewer model(s) not reported by PAL listmodels.`,
      details: { stackId, policy, unavailable },
    });
    if (runtimeUnhealthy.length || runtimeDegraded.length) warnings.push({
      code: "model_runtime_health_warning",
      message: `Selected stack '${stackId}' has ${runtimeUnhealthy.length} unhealthy and ${runtimeDegraded.length} degraded reviewer model(s) from recent runtime failures.`,
      details: { stackId, policy, unhealthy: runtimeUnhealthy, degraded: runtimeDegraded },
    });
    if (policy === "block" && warnings.length) throw new Error(`${warnings.map((warning) => warning.message).join(" ")} Set PAL_SIDECAR_MODEL_AVAILABILITY_POLICY=warn to allow the run.`);
    return warnings;
  } catch (error) {
    if (policy === "block" && error instanceof Error && error.message.includes("not reported by PAL listmodels")) throw error;
    return [{
      code: "model_discovery_warning",
      message: `Could not verify PAL model availability before starting the run: ${error instanceof Error ? error.message : String(error)}`,
      details: { stackId, policy },
    }];
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
    const warnings = await modelAvailabilityWarnings(cwd, selected.stackId);
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
      warnings,
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
    warnings: [],
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
    `Prompt version: ${REVIEW_PROMPT_VERSION}.`,
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

async function withPalClient<T>(cwd: string, operation: (client: Client, pal: { command: string; args: string[] }, env: Record<string, string>) => Promise<T>): Promise<T> {
  const pal = defaultPalCommand();
  const env = await palEnv(cwd);
  const client = new Client({ name: "pi-pal-consensus-sidecar", version: SIDECAR_VERSION }, { capabilities: {} });
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
      stacks: stackAvailability(config, models, activeModelRuntimeHealth()),
      raw: parsed,
    } satisfies PalModelsResponse;
  });
  state.modelDiscoveryCache = { expiresAt: Date.now() + ttlMs, response };
  return response;
}

function deterministicNormalize(run: RunState, req: RunRequest, artifacts: ReviewerArtifact[], rawResponses: any[]) {
  const findings = artifacts.flatMap(parseReviewerFindings);
  const failed = artifacts.filter((artifact) => artifact.status === "error");
  const blocking_findings = findings.filter((finding) => classifyFindingBucket(finding as FindingLike) === "blocking");
  const suggestion_findings = findings.filter((finding) => classifyFindingBucket(finding as FindingLike) === "suggestion");
  const question_findings = findings.filter((finding) => classifyFindingBucket(finding as FindingLike) === "question");
  const recommendation = failed.length === artifacts.length ? "reject" : blocking_findings.length || failed.length ? "revise" : "approve";
  const failed_reviewers = failed.map((artifact) => ({ reviewer: artifact.reviewer.id, model: artifact.reviewer.model, error: artifact.error, structured_error: artifact.error ? classifyError(artifact.error, { reviewer: artifact.reviewer.id, model: artifact.reviewer.model }) : undefined }));
  return {
    schema_version: FINDINGS_SCHEMA_VERSION,
    parser_version: FINDINGS_PARSER_VERSION,
    prompt_version: REVIEW_PROMPT_VERSION,
    sidecar_version: SIDECAR_VERSION,
    run_id: run.id,
    status: failed.length ? "partial" : "complete",
    generated_at: new Date().toISOString(),
    plan_file: req.planFile,
    stack: {
      id: req.stackId,
      reason: req.stackReason,
      cost_tier: req.stackCostTier,
    },
    config_sources: req.configSources,
    warnings: req.warnings ?? [],
    summary: {
      recommendation,
      blocking_count: blocking_findings.length,
      suggestion_count: suggestion_findings.length,
      question_count: question_findings.length,
      reviewer_success: `${artifacts.length - failed.length}/${artifacts.length}`,
      successful_reviewers: artifacts.length - failed.length,
      total_reviewers: artifacts.length,
      min_successful_reviewers: req.minSuccessfulReviewers,
      failed_reviewer_count: failed.length,
      warning_count: (req.warnings ?? []).length,
      total_findings: findings.length,
    },
    blocking_findings,
    suggestion_findings,
    question_findings,
    hotspots: buildFindingsHotspots(findings as FindingLike[]),
    failed_reviewers,
    raw: {
      artifacts: run.rawArtifacts,
      pal_responses: rawResponses,
      concerns: artifacts.map((artifact) => markdownSection(artifact.markdown, "Raw Concerns")).filter(Boolean),
      approval_recommendations: artifacts.map((artifact) => markdownSection(artifact.markdown, "Approval Recommendation")).filter(Boolean),
    },
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
  const client = new Client({ name: "pi-pal-consensus-sidecar", version: SIDECAR_VERSION }, { capabilities: {} });
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
        const structuredError = classifyError(responseError || "Unknown PAL/model error", { reviewer: reviewer.id, model: reviewer.model, runId: run.id });
        recordModelRuntimeFailure(reviewer.model, structuredError, { runId: run.id, reviewer: reviewer.id });
        addEvent(run, "reviewer_failed", { reviewer: reviewer.id, label: reviewer.label, model: reviewer.model, error: responseError || "Unknown PAL/model error", structuredError, jsonPath, mdPath });
      } else {
        successfulReviewers += 1;
        clearModelRuntimeHealth(reviewer.model);
        addEvent(run, "reviewer_completed", { reviewer: reviewer.id, label: reviewer.label, model: reviewer.model, jsonPath, mdPath });
      }
    }

    const enoughSuccessfulReviewers = successfulReviewers >= req.minSuccessfulReviewers;
    const findings = deterministicNormalize(run, req, reviewerArtifacts, rawResponses);
    findings.status = enoughSuccessfulReviewers ? findings.status : "failed";
    const findingsPath = join(run.artifactDir, "findings.json");
    const summaryPath = join(run.artifactDir, "findings-summary.md");
    await writeFile(findingsPath, JSON.stringify(findings, null, 2));
    await writeFile(summaryPath, renderFindingsSummaryMarkdown({
      run_id: findings.run_id,
      status: findings.status,
      recommendation: findings.summary.recommendation,
      reviewer_success: { successful: successfulReviewers, total: req.reviewers.length, minimum: req.minSuccessfulReviewers },
      warning_count: findings.summary.warning_count,
      failed_reviewers: findings.failed_reviewers,
      blocking_findings: findings.blocking_findings,
      suggestion_findings: findings.suggestion_findings,
      question_findings: findings.question_findings,
      hotspots: findings.hotspots,
      artifactDir: run.artifactDir,
    }));
    run.rawArtifacts.push(summaryPath);
    run.findingsPath = findingsPath;
    addEvent(run, enoughSuccessfulReviewers ? "synthesis_completed" : "synthesis_skipped", { findingsPath, summaryPath, successfulReviewers, minSuccessfulReviewers: req.minSuccessfulReviewers });
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
  const bytes = Buffer.byteLength(planText, "utf8");
  const maxBytes = maxPlanBytes();
  if (bytes > maxBytes) throw new Error(`Plan text is too large: ${bytes} bytes exceeds PAL_SIDECAR_MAX_PLAN_BYTES=${maxBytes}.`);
  const inputRoot = resolve(cwd, ".pi", "pal-consensus-inputs");
  await mkdir(inputRoot, { recursive: true, mode: 0o700 });
  const id = `plan-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.md`;
  const title = params.title?.trim() || "PAL Consensus Review";
  const path = join(inputRoot, id);
  await writeFile(path, `# ${title}\n\n${planText}\n`);
  await chmod(path, 0o600);
  return path;
}

async function cleanupRunState(cwd: string, artifactRoot: string) {
  const runs = [...state.runs.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const keep = new Set(runs.slice(0, maxRuns()).map((run) => run.id));
  const cutoff = Date.now() - retentionDays() * 24 * 60 * 60 * 1000;
  for (const run of runs) {
    const active = run.status === "queued" || run.status === "running";
    const expired = Date.parse(run.startedAt) < cutoff;
    if (!active && (!keep.has(run.id) || expired)) state.runs.delete(run.id);
  }
  if (!shouldCleanArtifacts()) return;
  const root = resolve(cwd, artifactRoot);
  if (!isPathInside(root, resolve(cwd))) return;
  if (!existsSync(root)) return;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("pal-")) continue;
    const dir = resolve(root, entry.name);
    if (!isPathInside(dir, root)) continue;
    const info = await stat(dir).catch(() => undefined);
    if (info && info.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true });
  }
}

async function startRun(req: RunRequest, cwd: string): Promise<RunState> {
  assertConcurrentRunCapacity();
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
    warnings: req.warnings ?? [],
    events: [],
    rawArtifacts: [],
  };
  state.runs.set(runId, run);
  state.cancelledRuns.delete(runId);
  addEvent(run, "run_queued", { runId, artifactDir, planFile: req.planFile, stackId: req.stackId, stackReason: req.stackReason, stackCostTier: req.stackCostTier, warnings: req.warnings ?? [] });
  for (const warning of req.warnings ?? []) addEvent(run, warning.code, { message: warning.message, details: warning.details });
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
      run.structuredError = classifyError(error, { runId, planFile: req.planFile, stackId: req.stackId });
      addEvent(run, run.status === "cancelled" ? "run_cancelled" : "run_failed", { runId, error: run.error, structuredError: run.structuredError });
    } finally {
      clearTimeout(timeout);
      state.cancelledRuns.delete(runId);
      state.runClosers.delete(runId);
      await cleanupRunState(cwd, req.artifactRoot ?? join(".pi", "pal-consensus-runs")).catch(() => undefined);
    }
  })();
  return run;
}

async function artifactManifest(run: RunState) {
  const dir = await realpath(run.artifactDir);
  const entries = await readdir(dir, { withFileTypes: true });
  const artifacts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isSafeArtifactName(entry.name)) continue;
    const path = resolve(dir, entry.name);
    const realFile = await realpath(path).catch(() => undefined);
    if (!realFile || !isPathInside(realFile, dir)) continue;
    const info = await stat(realFile);
    artifacts.push({
      name: entry.name,
      path: realFile,
      kind: artifactKind(entry.name),
      mediaType: artifactMediaType(entry.name),
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name));
  return { runId: run.id, artifactDir: dir, artifacts };
}

async function readArtifact(run: RunState, name: string) {
  if (!isSafeArtifactName(name)) throw new Error("Invalid artifact name. Use a file name ending in .json, .md, .log, or .txt with no path separators.");
  const dir = await realpath(run.artifactDir);
  const file = resolve(dir, name);
  const realFile = await realpath(file);
  if (!isPathInside(realFile, dir)) throw new Error("Artifact path escapes the run artifact directory.");
  const info = await stat(realFile);
  if (!info.isFile()) throw new Error("Artifact is not a file.");
  const maxBytes = maxArtifactReadBytes();
  const readBytes = Math.min(info.size, maxBytes);
  const handle = await open(realFile, "r");
  try {
    const buffer = Buffer.alloc(readBytes);
    await handle.read(buffer, 0, readBytes, 0);
    return {
      name,
      path: realFile,
      kind: artifactKind(name),
      mediaType: artifactMediaType(name),
      bytes: info.size,
      readBytes,
      truncated: info.size > readBytes,
      content: buffer.toString("utf8"),
    };
  } finally {
    await handle.close();
  }
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

async function readRunFindingsSummary(run: RunState) {
  if (!run.findingsPath || !existsSync(run.findingsPath)) return undefined;
  try {
    return extractCompactFindingsSummary(JSON.parse(await readFile(run.findingsPath, "utf8")));
  } catch {
    return undefined;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    assertLocalRequest(req);
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
      if (await serveDashboardAsset(url.pathname, res, state.csrfToken)) return;
      return json(res, 500, { error: "Dashboard assets are missing. Run 'npm run build --workspace pi-pal-consensus-sidecar'." });
    }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, {
      ok: true,
      port: state.port,
      limits: {
        maxPlanBytes: maxPlanBytes(),
        maxConcurrentRuns: maxConcurrentRuns(),
        activeRuns: activeRunCount(),
        maxRuns: maxRuns(),
        retentionDays: retentionDays(),
        cleanArtifacts: shouldCleanArtifacts(),
        maxArtifactReadBytes: maxArtifactReadBytes(),
      },
      modelDiscovery: {
        enabled: modelDiscoveryEnabled(),
        cacheTtlMs: modelDiscoveryTtlMs(),
        availabilityPolicy: modelAvailabilityPolicy(),
      },
      modelRuntimeHealth: {
        ttlMs: modelRuntimeHealthTtlMs(),
        activeCount: Object.keys(activeModelRuntimeHealth()).length,
      },
    });
    if (req.method === "GET" && url.pathname === "/api/session") return json(res, 200, { csrfToken: state.csrfToken });
    if (req.method === "GET" && url.pathname === "/api/config") return json(res, 200, await loadSidecarConfig(state.cwd));
    if (req.method === "GET" && url.pathname === "/api/pal/contract") return json(res, 200, await inspectPalContract(state.cwd));
    if (req.method === "GET" && url.pathname === "/api/pal/models") return json(res, 200, await discoverPalModels(state.cwd, url.searchParams.get("refresh") === "1"));
    if (req.method === "GET" && url.pathname === "/api/model-health") return json(res, 200, { generated_at: new Date().toISOString(), ttl_ms: modelRuntimeHealthTtlMs(), models: Object.values(activeModelRuntimeHealth()).sort((a, b) => a.model.localeCompare(b.model)) });
    if (req.method === "POST" && url.pathname === "/api/recommend-stack") {
      requireCsrf(req, url);
      const body = (await readBody(req)) as Record<string, unknown>;
      const planFile = await validatePlanFile(String(body.planFile || ""), state.cwd);
      const config = await loadSidecarConfig(state.cwd);
      const recommendation = recommendStack(await readFile(planFile, "utf8"), config);
      const availability = state.modelDiscoveryCache?.response.stacks[recommendation.stackId];
      return json(res, 200, { ...recommendation, stack: config.stacks[recommendation.stackId], availability });
    }
    if (req.method === "GET" && url.pathname === "/api/runs") {
      const runs = await Promise.all([...state.runs.values()].map(async (r) => ({ id: r.id, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt, planFile: r.planFile, artifactDir: r.artifactDir, warnings: r.warnings, error: r.error, structuredError: r.structuredError, findingsPath: r.findingsPath, findingsSummary: await readRunFindingsSummary(r) })));
      return json(res, 200, { runs });
    }
    if (req.method === "POST" && url.pathname === "/api/runs") {
      requireCsrf(req, url);
      const runReq = await validateRunRequest(await readBody(req), state.cwd);
      const run = await startRun(runReq, state.cwd);
      return json(res, 202, { run });
    }
    const artifactsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
    if (req.method === "GET" && artifactsMatch) {
      const run = state.runs.get(artifactsMatch[1]);
      if (!run) return json(res, 404, { error: "run not found" });
      return json(res, 200, await artifactManifest(run));
    }
    const artifactReadMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/read$/);
    if (req.method === "GET" && artifactReadMatch) {
      const run = state.runs.get(artifactReadMatch[1]);
      if (!run) return json(res, 404, { error: "run not found" });
      const name = url.searchParams.get("name") || "";
      return json(res, 200, await readArtifact(run, name));
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
      const findingsRecord = findings && typeof findings === "object" ? findings as Record<string, any> : undefined;
      const findingsSummary = findingsRecord?.summary as Record<string, any> | undefined;
      const findingCount = typeof findingsSummary?.total_findings === "number" ? findingsSummary.total_findings : undefined;
      const blockingCount = typeof findingsSummary?.blocking_count === "number" ? findingsSummary.blocking_count : undefined;
      const suggestionCount = typeof findingsSummary?.suggestion_count === "number" ? findingsSummary.suggestion_count : undefined;
      const questionCount = typeof findingsSummary?.question_count === "number" ? findingsSummary.question_count : undefined;
      const failedReviewerCount = typeof findingsSummary?.failed_reviewer_count === "number" ? findingsSummary.failed_reviewer_count : undefined;
      const warningCount = typeof findingsSummary?.warning_count === "number" ? findingsSummary.warning_count : (Array.isArray(finalRun.warnings) ? finalRun.warnings.length : 0);
      const successfulReviewers = findingsSummary?.successful_reviewers;
      const totalReviewers = findingsSummary?.total_reviewers ?? finalRun.reviewers.length;
      const findingsSummaryPath = finalRun.findingsPath ? join(dirname(finalRun.findingsPath), "findings-summary.md") : undefined;
      const summary = [
        `PAL consensus run ${finalRun.status}: ${finalRun.id}`,
        `Recommendation: ${findingsSummary?.recommendation ?? "unavailable"}`,
        `Reviewer success: ${successfulReviewers ?? "?"}/${totalReviewers}`,
        `Findings: ${findingCount ?? "unavailable"}`,
        `Blocking findings: ${blockingCount ?? "unavailable"}`,
        `Suggestions: ${suggestionCount ?? "unavailable"}`,
        `Questions: ${questionCount ?? "unavailable"}`,
        `Warnings: ${warningCount}`,
        `Failed reviewers: ${failedReviewerCount ?? "unavailable"}`,
        `Plan: ${finalRun.planFile}`,
        `Stack: ${runReq.stackId ?? "custom"}${runReq.stackCostTier ? ` (${runReq.stackCostTier})` : ""}`,
        `Artifacts: ${finalRun.artifactDir}`,
        finalRun.findingsPath ? `Findings path: ${finalRun.findingsPath}` : undefined,
        findingsSummaryPath ? `Findings summary: ${findingsSummaryPath}` : undefined,
        finalRun.structuredError ? `Structured error: ${finalRun.structuredError.code} (retryable=${finalRun.structuredError.retryable})` : undefined,
        finalRun.structuredError?.guidance ? `Guidance: ${finalRun.structuredError.guidance}` : undefined,
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
