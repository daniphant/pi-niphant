import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireOrRenewLeadership, getLeaderPath, parseLease, readLease, releaseLeadership } from "../extensions/pi-discord-presence/leader.js";

describe("leader lease", () => {
  it("parses leases defensively", () => {
    expect(parseLease("bad")).toBeNull();
    expect(parseLease(JSON.stringify({ schemaVersion: 1, instanceId: "a", expiresAt: 2, updatedAt: 1 }))?.instanceId).toBe("a");
  });

  it("acquires, rejects contenders, renews, expires, and releases", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "pi-discord-leader-"));
    const file = getLeaderPath(home);
    expect(await acquireOrRenewLeadership("a", file, 1_000)).toBe(true);
    expect(await acquireOrRenewLeadership("b", file, 2_000)).toBe(false);
    expect(await acquireOrRenewLeadership("a", file, 3_000)).toBe(true);
    expect((await readLease(file))?.instanceId).toBe("a");
    expect(await acquireOrRenewLeadership("b", file, 40_000)).toBe(true);
    await releaseLeadership("b", file);
    expect(await readLease(file)).toBeNull();
  });
});
