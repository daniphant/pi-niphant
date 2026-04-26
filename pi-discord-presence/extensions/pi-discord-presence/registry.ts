import path from "node:path";
import { readFile } from "node:fs/promises";
import { HEARTBEAT_TTL_MS, REGISTRY_SCHEMA_VERSION } from "./constants.js";
import { atomicWriteJson, getExtensionDir } from "./filesystem.js";
import { selectLastActive } from "./presence.js";
import type { InstanceHeartbeat, RegistryFile } from "./types.js";

export const getRegistryPath = (home?: string) => path.join(getExtensionDir(home), "instances.json");

export function parseRegistry(raw: string, now = Date.now(), ttlMs = HEARTBEAT_TTL_MS): RegistryFile {
  try {
    const parsed = JSON.parse(raw) as Partial<RegistryFile>;
    const instances = Array.isArray(parsed.instances) ? parsed.instances : [];
    return {
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      instances: instances.filter(isHeartbeat).filter((entry) => now - entry.updatedAt <= ttlMs),
    };
  } catch {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, instances: [] };
  }
}

function isHeartbeat(value: unknown): value is InstanceHeartbeat {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<InstanceHeartbeat>;
  return typeof item.id === "string"
    && typeof item.pid === "number"
    && typeof item.startedAt === "number"
    && typeof item.lastActiveAt === "number"
    && typeof item.updatedAt === "number"
    && typeof item.projectLabel === "string"
    && typeof item.modelLabel === "string"
    && (item.status === "Agent working" || item.status === "Waiting for input" || item.status === "Idle");
}

export async function readRegistry(file = getRegistryPath(), now = Date.now()): Promise<RegistryFile> {
  try {
    return parseRegistry(await readFile(file, "utf8"), now);
  } catch {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, instances: [] };
  }
}

export async function writeHeartbeat(entry: InstanceHeartbeat, file = getRegistryPath(), now = Date.now()): Promise<RegistryFile> {
  let registry = await readRegistry(file, now);
  registry = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    instances: [...registry.instances.filter((item) => item.id !== entry.id), entry].filter((item) => now - item.updatedAt <= HEARTBEAT_TTL_MS),
  };
  await atomicWriteJson(file, registry);
  return registry;
}

export async function removeHeartbeat(instanceId: string, file = getRegistryPath(), now = Date.now()): Promise<RegistryFile> {
  const registry = await readRegistry(file, now);
  const next = { schemaVersion: REGISTRY_SCHEMA_VERSION, instances: registry.instances.filter((item) => item.id !== instanceId) };
  await atomicWriteJson(file, next);
  return next;
}

export function summarizeRegistry(registry: RegistryFile): { count: number; lastActive: InstanceHeartbeat | null } {
  return { count: registry.instances.length, lastActive: selectLastActive(registry.instances) };
}
