import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DiscordPresenceController } from "../extensions/pi-discord-presence/controller.js";
import type { DiscordActivity, RpcAdapter, ConnectionState } from "../extensions/pi-discord-presence/types.js";

async function waitFor(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 500) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

class FakeRpc implements RpcAdapter {
  state: ConnectionState = "disconnected";
  activities: DiscordActivity[] = [];
  connects = 0;
  destroyed = 0;
  async connect() { this.connects += 1; this.state = "connected"; }
  async setActivity(activity: DiscordActivity) { this.activities.push(activity); }
  async clearActivity() {}
  async destroy() { this.destroyed += 1; this.state = "disconnected"; }
  getState() { return this.state; }
  getLastError() { return null; }
}

describe("DiscordPresenceController", () => {
  it("reports missing client ID without connecting", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-discord-controller-"));
    const rpc = new FakeRpc();
    const statuses: string[] = [];
    const controller = new DiscordPresenceController({ rpc, registryPath: path.join(tmp, "instances.json"), leaderPath: path.join(tmp, "leader.lock"), settingsPath: path.join(tmp, "settings.json"), clientIdEnvFiles: [] });
    await controller.init({ cwd: tmp, model: "secret", hasUI: true, ui: { setStatus: (message) => statuses.push(message), notify: vi.fn() } });
    expect(rpc.connects).toBe(0);
    await waitFor(() => expect(statuses.at(-1)).toContain("missing client ID"));
    await controller.shutdown();
  });

  it("can disable and reconnect without throwing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pi-discord-controller-"));
    const rpc = new FakeRpc();
    const controller = new DiscordPresenceController({ rpc, registryPath: path.join(tmp, "instances.json"), leaderPath: path.join(tmp, "leader.lock"), settingsPath: path.join(tmp, "settings.json"), clientIdEnvFiles: [] });
    expect(await controller.disable({ hasUI: false })).toContain("disabled");
    expect(rpc.destroyed).toBeGreaterThan(0);
    expect(await controller.reconnect({ hasUI: false })).toContain("reconnect");
    await controller.shutdown();
  });
});
