import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { DelegatedAgentDefinition, DelegatedAgentTask } from "./schema.ts";

const DEFAULT_TOOLS = ["read", "bash", "grep", "find", "ls"];

const BASE_RULES = [
  "Work read-only.",
  "Prefer read, grep, find, ls, and safe bash commands.",
  "Do not edit files.",
  "Inspect structure first, then key files.",
  "Return concise, high-signal output.",
  "Return valid JSON only in this exact shape:",
  "{",
  '  "summary": string,',
  '  "keyFindings": string[],',
  '  "risks": string[],',
  '  "recommendedNextSteps": string[],',
  '  "keyFiles": string[]',
  "}",
].join("\n");

function buildPrompt(role: string, focus: string): string {
  return [
    `You are the ${role} for a parent Pi orchestrator.`,
    "",
    "Rules:",
    BASE_RULES,
    "",
    "Focus:",
    focus,
  ].join("\n");
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugify(value: string, max = 24): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return slug || "agent";
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeAgentName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "auto";
  if (/^[a-zA-Z0-9._-]+$/.test(trimmed)) return trimmed;
  return slugify(trimmed, 40);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_TOOLS];
  const tools = [...new Set(value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean))];
  return tools.length > 0 ? tools : [...DEFAULT_TOOLS];
}

function normalizeOutputSchema(value: unknown): DelegatedAgentDefinition["outputSchema"] | undefined {
  if (value === "repo-summary" || value === "plan-review" || value === "ownership-review") return value;
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeReadJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function roleFocusFromLabel(label: string): string {
  const normalized = normalizeHandle(label);
  if (normalized.includes("frontend") || normalized.includes("ui") || normalized.includes("react")) {
    return "Focus on frontend architecture, UI boundaries, component organization, state, styling, and user-facing risks.";
  }
  if (normalized.includes("backend") || normalized.includes("api") || normalized.includes("service") || normalized.includes("data")) {
    return "Focus on services, APIs, data flow, data access, background workers, and backend boundary risks.";
  }
  if (normalized.includes("infra") || normalized.includes("deploy") || normalized.includes("platform") || normalized.includes("k8") || normalized.includes("devops")) {
    return "Focus on infrastructure, CI/CD, deployment topology, runtime concerns, and operational risks.";
  }
  if (normalized.includes("review") || normalized.includes("critique") || normalized.includes("risk") || normalized.includes("security")) {
    return "Focus on critique, risks, edge cases, and failure modes. Prioritize concrete, actionable concerns.";
  }
  if (normalized.includes("plan") || normalized.includes("planner") || normalized.includes("roadmap")) {
    return "Focus on implementation sequencing, scope boundaries, milestones, and recommended execution order.";
  }
  return "Focus on the delegated task, inspect the most relevant files, and produce a concise high-signal report.";
}

function createDynamicAgentDefinition(name: string, task?: string): DelegatedAgentDefinition {
  const normalizedName = normalizeAgentName(name || "auto");
  const displayName = normalizedName === "auto"
    ? "Delegated Agent"
    : titleCase(normalizedName.replace(/-agent$/i, "")) + (/-agent$/i.test(normalizedName) ? " Agent" : "");
  const shortLabel = slugify(normalizedName === "auto" ? "delegate" : normalizedName, 12);
  const baseFocus = roleFocusFromLabel(normalizedName);
  const taskHint = task?.trim() ? `\n\nPriority task context: ${task.trim()}` : "";

  return {
    name: normalizedName,
    displayName,
    shortLabel,
    description: `${displayName} (dynamic delegated profile).`,
    systemPrompt: buildPrompt(displayName, `${baseFocus}${taskHint}`),
    tools: [...DEFAULT_TOOLS],
    outputSchema: "repo-summary",
  };
}

function normalizeConfiguredAgent(raw: unknown, fallbackName: string): DelegatedAgentDefinition | null {
  if (!isObject(raw)) return null;

  const name = normalizeAgentName(asNonEmptyString(raw.name) ?? fallbackName);
  const displayName = asNonEmptyString(raw.displayName) ?? titleCase(name);
  const shortLabel = slugify(asNonEmptyString(raw.shortLabel) ?? name, 12);
  const description = asNonEmptyString(raw.description) ?? `${displayName} delegated specialist.`;
  const model = asNonEmptyString(raw.model);
  const tools = normalizeTools(raw.tools);
  const outputSchema = normalizeOutputSchema(raw.outputSchema);
  const focus = asNonEmptyString(raw.focus) ?? roleFocusFromLabel(name);
  const systemPrompt = asNonEmptyString(raw.systemPrompt)
    ?? asNonEmptyString(raw.prompt)
    ?? buildPrompt(displayName, focus);

  return {
    name,
    displayName,
    shortLabel,
    description,
    systemPrompt,
    tools,
    model,
    outputSchema,
  };
}

function loadConfiguredAgentsFromFile(filePath: string): DelegatedAgentDefinition[] {
  const raw = safeReadJson(filePath);
  if (!raw) return [];

  const list = Array.isArray(raw)
    ? raw
    : isObject(raw) && Array.isArray(raw.agents)
      ? raw.agents
      : null;

  if (!list) return [];

  return list
    .map((entry, index) => normalizeConfiguredAgent(entry, `agent-${index + 1}`))
    .filter((agent): agent is DelegatedAgentDefinition => Boolean(agent));
}

function mergeAgentLists(...lists: DelegatedAgentDefinition[][]): DelegatedAgentDefinition[] {
  const merged = new Map<string, DelegatedAgentDefinition>();
  for (const list of lists) {
    for (const agent of list) merged.set(agent.name, agent);
  }
  return [...merged.values()];
}

function getUserAgentConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "delegated-agents", "agents.json");
}

function getProjectAgentConfigPaths(cwd?: string): string[] {
  if (!cwd) return [];
  return [
    path.join(cwd, ".pi", "delegated-agents", "agents.json"),
    path.join(cwd, ".pi", "agent", "delegated-agents", "agents.json"),
  ];
}

function getEffectiveAgents(cwd?: string): DelegatedAgentDefinition[] {
  const userConfigured = loadConfiguredAgentsFromFile(getUserAgentConfigPath());
  const projectConfigured = getProjectAgentConfigPaths(cwd)
    .flatMap((filePath) => loadConfiguredAgentsFromFile(filePath));

  return mergeAgentLists(userConfigured, projectConfigured);
}

function findAgentByName(name: string, agents: DelegatedAgentDefinition[]): DelegatedAgentDefinition | undefined {
  const normalizedQuery = normalizeHandle(name);
  if (!normalizedQuery) return undefined;

  const direct = agents.find((agent) => normalizeHandle(agent.name) === normalizedQuery);
  if (direct) return direct;

  return agents.find((agent) => {
    const aliases = [
      agent.shortLabel,
      agent.displayName,
      agent.name.replace(/-agent$/i, ""),
      agent.displayName.replace(/\s+agent$/i, ""),
    ];
    return aliases.some((alias) => normalizeHandle(alias) === normalizedQuery);
  });
}

function matchesTextHint(text: string, hints: RegExp[]): boolean {
  return hints.some((hint) => hint.test(text));
}

function scoreAgentForKeywords(agent: DelegatedAgentDefinition, keywords: string[]): number {
  const haystack = `${agent.name} ${agent.shortLabel} ${agent.displayName} ${agent.description}`.toLowerCase();
  return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function pickBestAgentForKeywords(
  agents: DelegatedAgentDefinition[],
  keywords: string[],
  excludedNames: Set<string>,
): DelegatedAgentDefinition | undefined {
  const ranked = agents
    .filter((agent) => !excludedNames.has(agent.name))
    .map((agent) => ({ agent, score: scoreAgentForKeywords(agent, keywords) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.agent;
}

export function listAgentDefinitions(cwd?: string): DelegatedAgentDefinition[] {
  return getEffectiveAgents(cwd);
}

export function getAgentDefinition(name: string, options?: { cwd?: string; task?: string }): DelegatedAgentDefinition {
  const agents = getEffectiveAgents(options?.cwd);
  const configured = findAgentByName(name, agents);
  if (configured) return configured;
  return createDynamicAgentDefinition(name, options?.task);
}

export function inferDelegatedAgentsFromText(text: string, options?: { cwd?: string }): DelegatedAgentTask[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const normalized = trimmed.toLowerCase();
  const agents = getEffectiveAgents(options?.cwd);
  const selected = new Set<string>();

  for (const agent of agents) {
    const handles = [agent.name, agent.shortLabel, agent.displayName]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (handles.some((handle) => normalized.includes(handle))) {
      selected.add(agent.name);
    }
  }

  const roleHints: Array<{
    fallback: string;
    keywords: string[];
    patterns: RegExp[];
  }> = [
    {
      fallback: "frontend-agent",
      keywords: ["frontend", "ui", "react", "component", "css", "vite", "expo"],
      patterns: [/\bfrontend\b/, /\bfront-end\b/, /\bui\b/, /\breact\b/, /\bexpo\b/],
    },
    {
      fallback: "backend-agent",
      keywords: ["backend", "api", "service", "database", "worker", "queue"],
      patterns: [/\bbackend\b/, /\bapi\b/, /\bservice\b/, /\bdatabase\b/, /\bworker\b/, /\bqueue\b/],
    },
    {
      fallback: "infra-agent",
      keywords: ["infra", "infrastructure", "deployment", "ci", "cd", "kubernetes", "helm"],
      patterns: [/\binfra\b/, /\binfrastructure\b/, /\bdeploy\b/, /\bci\/?cd\b/, /\bkubernetes\b/, /\bhelm\b/],
    },
    {
      fallback: "planner-agent",
      keywords: ["plan", "planner", "roadmap", "sequence", "milestone"],
      patterns: [/\bplan\b/, /\bplanner\b/, /\broadmap\b/, /\bimplementation plan\b/],
    },
    {
      fallback: "reviewer-agent",
      keywords: ["review", "reviewer", "critique", "risk", "edge case", "security"],
      patterns: [/\breview\b/, /\breviewer\b/, /\bcritique\b/, /\brisks?\b/, /\bedge cases?\b/, /\bsecurity\b/],
    },
  ];

  for (const hint of roleHints) {
    if (!matchesTextHint(normalized, hint.patterns)) continue;
    const best = pickBestAgentForKeywords(agents, hint.keywords, selected);
    selected.add(best?.name ?? hint.fallback);
  }

  if (selected.size === 0) {
    const fallback = findAgentByName("general-explorer", agents)
      ?? pickBestAgentForKeywords(agents, ["explore", "general", "scout", "repo"], selected)
      ?? agents[0];

    if (fallback) {
      return [{ agent: fallback.name, task: trimmed }];
    }

    return [{ agent: "auto", task: trimmed }];
  }

  return [...selected].map((agentName) => ({
    agent: normalizeAgentName(agentName),
    task: trimmed,
  }));
}
