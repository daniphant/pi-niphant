import { mkdtemp, readFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRegistryPath, parseRegistry, summarizeRegistry, writeHeartbeat } from "../extensions/pi-discord-presence/registry.js";
import type { InstanceHeartbeat } from "../extensions/pi-discord-presence/types.js";

function heartbeat(id: string, now: number): InstanceHeartbeat {
  return { id, pid: id === "a" ? 1 : 2, startedAt: now - 100, lastActiveAt: now, projectLabel: "Pi", modelLabel: "AI model", status: "Waiting for input", updatedAt: now };
}

describe("registry", () => {
  it("defensively parses and drops stale entries", () => {
    const now = 100_000;
    const registry = parseRegistry(JSON.stringify({ schemaVersion: 1, instances: [heartbeat("a", now), { ...heartbeat("b", now - 100_000), updatedAt: now - 100_000 }] }), now);
    expect(registry.instances.map((entry) => entry.id)).toEqual(["a"]);
    expect(parseRegistry("not json").instances).toEqual([]);
  });

  it("writes heartbeat with restrictive mode where supported", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "pi-discord-registry-"));
    const file = getRegistryPath(home);
    const registry = await writeHeartbeat(heartbeat("a", Date.now()), file);
    expect(registry.instances).toHaveLength(1);
    expect(JSON.parse(await readFile(file, "utf8")).instances[0].id).toBe("a");
    if (process.platform !== "win32") {
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it("summarizes count and last active", () => {
    const now = Date.now();
    expect(summarizeRegistry({ schemaVersion: 1, instances: [heartbeat("a", now), { ...heartbeat("b", now + 1), pid: 2 }] }).lastActive?.id).toBe("b");
  });
});
