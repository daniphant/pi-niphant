import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCK_STALE_MS } from "./constants.js";
import { locksDir } from "./paths.js";
import { slugify } from "./slug.js";

export interface LockHandle { file: string; release(): void }

export function acquireLock(home: string, name: string, staleMs = LOCK_STALE_MS): LockHandle {
  mkdirSync(locksDir(home), { recursive: true });
  const file = join(locksDir(home), `${slugify(name, 120, "lock")}.lock`);
  const now = Date.now();
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (typeof data.createdAtMs === "number" && now - data.createdAtMs > staleMs) rmSync(file, { force: true });
    } catch { rmSync(file, { force: true }); }
  }
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, createdAtMs: now, createdAt: new Date(now).toISOString() }), { flag: "wx" });
  } catch {
    throw new Error(`Another niphant operation is already running (${file}). Retry shortly or remove stale lock with /niphant-status locks.`);
  }
  return { file, release: () => rmSync(file, { force: true }) };
}

export function clearLocks(home: string): number {
  if (!existsSync(locksDir(home))) return 0;
  let count = 0;
  for (const entry of readdirSync(locksDir(home))) {
    if (entry.endsWith(".lock")) { rmSync(join(locksDir(home), entry), { force: true }); count++; }
  }
  return count;
}
