#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const APPLICATION_ID = "1498702978939621568";
const CLIENT_ID_ENV = "DROID_DISCORD_CLIENT_ID";
const DATA_DIR = path.join(os.homedir(), ".factory", "discord-presence");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const FACTORY_SETTINGS_PATH = path.join(os.homedir(), ".factory", "settings.json");
const PID_PATH = path.join(DATA_DIR, "daemon.pid");
const LOG_PATH = path.join(DATA_DIR, "daemon.log");
const IDLE_AFTER_MS = 15 * 60_000;
const STALE_AFTER_MS = 60 * 60_000;
const LOOP_MS = 5_000;
const DISCORD_FIELD_MAX_CHARS = 128;
const RPC_PACKAGE_NAME = "@xhayper/discord-rpc";

const DEFAULT_SETTINGS = {
  enabled: true,
  showProject: true,
  showModel: true,
  showMode: true,
  clientId: APPLICATION_ID,
};

function truncate(value, max = DISCORD_FIELD_MAX_CHARS) {
  const clean = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}…`;
}

function sanitizeLabel(value, fallback) {
  const clean = truncate(value || fallback, 64).replace(/[`*_~<>{}[\]()\\]/g, "").trim();
  return clean || fallback;
}

function labelFromModelValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const display = value.name || value.displayName || value.label || value.title;
  if (typeof display === "string" && display.trim()) return display;
  const id = typeof value.id === "string" ? value.id : typeof value.modelId === "string" ? value.modelId : typeof value.model === "string" ? value.model : "";
  const provider = typeof value.provider === "string" ? value.provider : "";
  if (id && provider && !id.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) return `${provider} ${id}`;
  return id;
}

function sanitizeModelLabel(value) {
  return sanitizeLabel(labelFromModelValue(value), "AI model");
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await ensureDataDir();
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function loadSettings() {
  const raw = await readJson(SETTINGS_PATH, DEFAULT_SETTINGS);
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
    showProject: typeof raw.showProject === "boolean" ? raw.showProject : DEFAULT_SETTINGS.showProject,
    showModel: typeof raw.showModel === "boolean" ? raw.showModel : DEFAULT_SETTINGS.showModel,
    showMode: typeof raw.showMode === "boolean" ? raw.showMode : DEFAULT_SETTINGS.showMode,
    clientId: typeof raw.clientId === "string" && raw.clientId.trim() ? raw.clientId.trim() : APPLICATION_ID,
  };
}

function isPidAlive(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readDaemonPid() {
  try {
    const pid = Number((await readFile(PID_PATH, "utf8")).trim());
    return Number.isInteger(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

async function ensureDaemon() {
  const pid = await readDaemonPid();
  if (isPidAlive(pid)) return;
  await ensureDataDir();
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, "--daemon"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, DROID_DISCORD_PRESENCE_LOG: LOG_PATH },
  });
  child.unref();
  await writeFile(PID_PATH, `${child.pid}\n`, { mode: 0o600 });
}

async function stopDaemon() {
  const pid = await readDaemonPid();
  if (isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
    }
    for (let attempt = 0; attempt < 20 && isPidAlive(pid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    await unlink(PID_PATH);
  } catch {
  }
}

async function readStdinJson() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readFactorySettings() {
  return await readJson(FACTORY_SETTINGS_PATH, {});
}

function modelLabelFromFactorySettings(settings) {
  const configured = settings?.sessionDefaultSettings?.model;
  if (typeof configured !== "string" || !configured.trim()) return "";
  const custom = Array.isArray(settings.customModels)
    ? settings.customModels.find((item) => item?.id === configured || item?.model === configured)
    : null;
  return labelFromModelValue(custom) || configured;
}

function modelLabelFromTranscript(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return "";
  try {
    const raw = readFileSync(transcriptPath, "utf8");
    const match = raw.match(/(?:^|\n)Model:\s*([^\n<]+)/);
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

function statusForHook(input) {
  switch (input?.hook_event_name) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      return "Agent working";
    case "Notification":
      return /waiting|permission|input/i.test(String(input.message ?? "")) ? "Waiting for input" : "Agent working";
    case "SessionEnd":
    case "Stop":
      return "Waiting for input";
    default:
      return "Waiting for input";
  }
}

async function buildHookState(input, previous) {
  const now = Date.now();
  const cwd = typeof input?.cwd === "string" && input.cwd ? input.cwd : previous.cwd || process.cwd();
  const permissionMode = typeof input?.permission_mode === "string" ? input.permission_mode : previous.permissionMode || "default";
  const hookName = String(input?.hook_event_name ?? "Manual");
  const activeStatus = statusForHook(input);
  const projectLabel = sanitizeLabel(path.basename(cwd), "Droid");
  const modeLabel = sanitizeLabel(permissionMode.replace(/^auto-/, "auto "), "Droid CLI");
  const factorySettings = await readFactorySettings();
  const modelLabel = sanitizeModelLabel(
    input?.model
      || modelLabelFromTranscript(input?.transcript_path)
      || modelLabelFromFactorySettings(factorySettings)
      || previous.modelLabel
      || "AI model"
  );

  return {
    id: previous.id || randomUUID(),
    sessionId: input?.session_id || previous.sessionId || null,
    cwd,
    permissionMode,
    hookName,
    projectLabel,
    modelLabel,
    modeLabel,
    status: activeStatus,
    startedAt: previous.startedAt || now,
    lastActiveAt: activeStatus === "Agent working" ? now : previous.lastActiveAt || now,
    updatedAt: now,
    shutdown: hookName === "SessionEnd",
  };
}

function clientId(settings) {
  return (process.env[CLIENT_ID_ENV] || settings.clientId || APPLICATION_ID).trim();
}

function buildActivity(state, settings) {
  const project = settings.showProject ? sanitizeLabel(state.projectLabel, "Droid") : "Droid";
  const model = settings.showModel ? sanitizeModelLabel(state.modelLabel) : "AI model";
  return {
    details: truncate(`Working in ${project}`),
    state: truncate(model),
    smallImageText: "Droid",
    startTimestamp: Math.floor(Number(state.startedAt || Date.now()) / 1000),
  };
}

async function appendLog(message) {
  const logPath = process.env.DROID_DISCORD_PRESENCE_LOG || LOG_PATH;
  try {
    await ensureDataDir();
    await writeFile(logPath, `${new Date().toISOString()} ${message}\n`, { flag: "a", mode: 0o600 });
  } catch {
  }
}

async function importRpcModule() {
  try {
    return await import(RPC_PACKAGE_NAME);
  } catch (error) {
    const roots = [
      path.join(new URL("..", import.meta.url).pathname, "node_modules"),
      process.env.FACTORY_PROJECT_DIR ? path.join(process.env.FACTORY_PROJECT_DIR, "node_modules") : "",
      path.join(process.cwd(), "node_modules"),
    ].filter(Boolean);

    for (const root of roots) {
      const packagePath = path.join(root, RPC_PACKAGE_NAME, "package.json");
      if (!existsSync(packagePath)) continue;
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
      const main = typeof packageJson.main === "string" ? packageJson.main : "index.js";
      return await import(pathToFileURL(path.join(root, RPC_PACKAGE_NAME, main)).href);
    }

    throw error;
  }
}

function getClientCtor(module) {
  if (module.Client) return module.Client;
  if (typeof module.default === "function") return module.default;
  if (module.default?.Client) return module.default.Client;
  throw new Error("Discord RPC module did not expose a Client constructor");
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runDaemon() {
  await ensureDataDir();
  let client = null;
  let connectedClientId = null;
  let lastPayload = "";
  let shuttingDown = false;

  async function destroy() {
    try {
      if (client?.clearActivity) await withTimeout(client.clearActivity(), 1500, "clearActivity");
      else if (client?.request) await withTimeout(client.request("SET_ACTIVITY", { pid: process.pid }), 1500, "clearActivity");
    } catch {
    }
    try {
      await Promise.resolve(client?.destroy?.());
      client?.transport?.close?.();
    } catch {
    }
    client = null;
    connectedClientId = null;
  }

  async function connect(id) {
    if (client && connectedClientId === id) return;
    await destroy();
    const module = await importRpcModule();
    const Client = getClientCtor(module);
    const nextClient = new Client({ clientId: id });
    if (nextClient.connect) await withTimeout(nextClient.connect(), 1500, "connect");
    else if (nextClient.login) await withTimeout(nextClient.login(), 1500, "login");
    client = nextClient;
    connectedClientId = id;
  }

  async function setActivity(activity) {
    if (client?.setActivity) await withTimeout(client.setActivity(activity), 1500, "setActivity");
    else if (client?.request) await withTimeout(client.request("SET_ACTIVITY", { pid: process.pid, activity }), 1500, "setActivity");
  }

  process.on("SIGTERM", () => {
    shuttingDown = true;
    void destroy().finally(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    shuttingDown = true;
    void destroy().finally(() => process.exit(0));
  });

  await writeFile(PID_PATH, `${process.pid}\n`, { mode: 0o600 });

  while (!shuttingDown) {
    try {
      const settings = await loadSettings();
      const state = await readJson(STATE_PATH, {});
      const stale = Date.now() - Number(state.updatedAt || 0) > STALE_AFTER_MS;
      if (!settings.enabled || state.shutdown || stale) {
        await destroy();
        if (state.shutdown) break;
      } else {
        const id = clientId(settings);
        await connect(id);
        const activity = buildActivity(state, settings);
        const payload = JSON.stringify(activity);
        if (payload !== lastPayload) {
          await setActivity(activity);
          lastPayload = payload;
        }
      }
    } catch (error) {
      await appendLog(error instanceof Error ? error.message : String(error));
      await destroy();
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, LOOP_MS);
      timer.unref?.();
    });
  }

  await destroy();
  try {
    await unlink(PID_PATH);
  } catch {
  }
}

async function runHook() {
  const input = await readStdinJson();
  const settings = await loadSettings();
  const previous = await readJson(STATE_PATH, {});
  const state = await buildHookState(input, previous);
  await writeJson(SETTINGS_PATH, settings);
  await writeJson(STATE_PATH, state);
  if (settings.enabled && !state.shutdown) await ensureDaemon();
}

async function runCommand(args) {
  const subcommand = String(args[0] || "status").toLowerCase();
  const settings = await loadSettings();

  if (subcommand === "on") {
    settings.enabled = true;
    await writeJson(SETTINGS_PATH, settings);
    await ensureDaemon();
    console.log("Discord Presence enabled for Droid.");
    return;
  }

  if (subcommand === "off") {
    settings.enabled = false;
    await writeJson(SETTINGS_PATH, settings);
    await stopDaemon();
    console.log("Discord Presence disabled for Droid.");
    return;
  }

  if (subcommand === "show-project" || subcommand === "hide-project") {
    settings.showProject = subcommand === "show-project";
    await writeJson(SETTINGS_PATH, settings);
    console.log(settings.showProject ? "Project labels enabled." : "Project labels hidden.");
    return;
  }

  if (subcommand === "show-model" || subcommand === "hide-model") {
    settings.showModel = subcommand === "show-model";
    await writeJson(SETTINGS_PATH, settings);
    console.log(settings.showModel ? "Model labels enabled." : "Model labels hidden.");
    return;
  }

  if (subcommand === "show-mode" || subcommand === "hide-mode") {
    settings.showMode = subcommand === "show-mode";
    await writeJson(SETTINGS_PATH, settings);
    console.log(settings.showMode ? "Permission mode labels enabled." : "Permission mode labels hidden.");
    return;
  }

  if (subcommand === "reconnect") {
    await stopDaemon();
    await ensureDaemon();
    console.log("Discord Presence reconnect requested.");
    return;
  }

  if (subcommand === "status") {
    const pid = await readDaemonPid();
    const state = await readJson(STATE_PATH, {});
    console.log(`Discord Presence: ${settings.enabled ? "enabled" : "disabled"}`);
    console.log(`Application ID: ${clientId(settings)}`);
    console.log(`Daemon: ${isPidAlive(pid) ? `running (${pid})` : "stopped"}`);
    console.log(`Project labels: ${settings.showProject ? "shown" : "hidden"}`);
    console.log(`Model labels: ${settings.showModel ? "shown" : "hidden"}`);
    console.log(`Mode labels: ${settings.showMode ? "shown" : "hidden"}`);
    if (state.updatedAt) console.log(`Last update: ${new Date(state.updatedAt).toLocaleString()}`);
    return;
  }

  console.log("Usage: /discord-presence on|off|status|reconnect|show-project|hide-project|show-model|hide-model|show-mode|hide-mode");
}

if (process.argv.includes("--daemon")) {
  await runDaemon();
} else if (process.argv.includes("--command")) {
  const index = process.argv.indexOf("--command");
  await runCommand(process.argv.slice(index + 1));
} else {
  await runHook();
}
