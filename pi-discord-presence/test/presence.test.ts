import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvValue, resolveClientId } from "../extensions/pi-discord-presence/client-id.js";
import { ReconnectBackoff, jitter } from "../extensions/pi-discord-presence/backoff.js";
import { buildActivity, selectLastActive } from "../extensions/pi-discord-presence/presence.js";

describe("presence mapping", () => {
  it("uses generic labels by default", () => {
    const activity = buildActivity({ projectLabel: "SecretRepo", modelLabel: "secret-model", sessionCount: 2, status: "Waiting for input", startedAt: 1_000, showProject: false, showModel: false });
    expect(activity.details).toBe("Working in Pi");
    expect(activity.state).toBe("AI model • 2 Pi sessions");
  });

  it("uses sanitized opt-in labels", () => {
    const activity = buildActivity({ projectLabel: "/Secret/Repo", modelLabel: "model$1", sessionCount: 1, status: "Agent working", startedAt: 1_000, showProject: true, showModel: true });
    expect(activity.details).toBe("Working in Secret Repo");
    expect(activity.state).toBe("model 1 • 1 Pi session");
  });

  it("selects last-active deterministically", () => {
    const selected = selectLastActive([
      { id: "b", pid: 20, startedAt: 1, lastActiveAt: 10, projectLabel: "Pi", modelLabel: "AI model", status: "Idle", updatedAt: 10 },
      { id: "a", pid: 10, startedAt: 1, lastActiveAt: 10, projectLabel: "Pi", modelLabel: "AI model", status: "Idle", updatedAt: 10 },
    ]);
    expect(selected?.id).toBe("a");
  });
});

describe("client id and backoff", () => {
  it("resolves env before env files and settings", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-discord-env-"));
    const envFile = path.join(dir, ".env");
    await writeFile(envFile, "PI_DISCORD_CLIENT_ID=345678901234567890\n", "utf8");
    expect(resolveClientId({ clientId: "123456789012345678" }, { PI_DISCORD_CLIENT_ID: "234567890123456789" }, [envFile])).toMatchObject({ source: "env", configured: true });
    expect(resolveClientId({ clientId: "123456789012345678" }, {}, [envFile])).toMatchObject({ source: "env-file", configured: true });
    expect(resolveClientId({ clientId: "123456789012345678" }, {}, [])).toMatchObject({ source: "settings", configured: true });
    expect(resolveClientId({}, {}, [])).toMatchObject({ source: "missing", configured: false });
  });

  it("parses quoted .env client id values", () => {
    expect(parseEnvValue("# comment\nPI_DISCORD_CLIENT_ID=\"1497753988873982113\"\n")).toBe("1497753988873982113");
  });

  it("backs off with bounded delays and jitter", () => {
    const backoff = new ReconnectBackoff();
    expect([backoff.nextDelay(), backoff.nextDelay(), backoff.nextDelay()]).toEqual([1000, 2000, 5000]);
    backoff.reset();
    expect(backoff.nextDelay()).toBe(1000);
    expect(jitter(1000, 0.2, () => 0.5)).toBe(1000);
  });
});
