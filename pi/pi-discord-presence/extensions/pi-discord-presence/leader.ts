import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { LEASE_DURATION_MS, REGISTRY_SCHEMA_VERSION } from "./constants.js";
import { assertNotSymlink, ensurePrivateDir, getExtensionDir } from "./filesystem.js";
import type { LeaderLease } from "./types.js";

export const getLeaderPath = (home?: string) => path.join(getExtensionDir(home), "leader.lock");

export function parseLease(raw: string): LeaderLease | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LeaderLease>;
    if (parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION) return null;
    if (typeof parsed.instanceId !== "string" || !parsed.instanceId) return null;
    if (typeof parsed.expiresAt !== "number" || typeof parsed.updatedAt !== "number") return null;
    return parsed as LeaderLease;
  } catch {
    return null;
  }
}

export async function readLease(file = getLeaderPath()): Promise<LeaderLease | null> {
  try {
    return parseLease(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeLease(file: string, lease: LeaderLease, exclusive: boolean): Promise<void> {
  await ensurePrivateDir(path.dirname(file));
  await assertNotSymlink(file);
  await writeFile(file, `${JSON.stringify(lease, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: exclusive ? "wx" : "w" });
}

export async function acquireOrRenewLeadership(instanceId: string, file = getLeaderPath(), now = Date.now()): Promise<boolean> {
  const next: LeaderLease = { schemaVersion: REGISTRY_SCHEMA_VERSION, instanceId, updatedAt: now, expiresAt: now + LEASE_DURATION_MS };
  const current = await readLease(file);
  if (!current) {
    try {
      await writeLease(file, next, true);
      return true;
    } catch {
      const raced = await readLease(file);
      if (!raced || raced.expiresAt <= now || raced.instanceId === instanceId) {
        await writeLease(file, next, false);
        return true;
      }
      return false;
    }
  }

  if (current.instanceId === instanceId || current.expiresAt <= now) {
    await writeLease(file, next, false);
    return true;
  }

  return false;
}

export async function releaseLeadership(instanceId: string, file = getLeaderPath()): Promise<void> {
  const current = await readLease(file);
  if (current?.instanceId === instanceId) {
    await rm(file, { force: true });
  }
}
