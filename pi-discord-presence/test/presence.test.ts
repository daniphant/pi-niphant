import { describe, expect, it } from "vitest";
import { resolveClientId } from "../extensions/pi-discord-presence/client-id.js";
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
  it("resolves env before settings and hides placeholder default", () => {
    expect(resolveClientId({ clientId: "123456789012345678" }, { PI_DISCORD_CLIENT_ID: "234567890123456789" })).toMatchObject({ source: "env", configured: true });
    expect(resolveClientId({}, {})).toMatchObject({ source: "missing", configured: false });
  });

  it("backs off with bounded delays and jitter", () => {
    const backoff = new ReconnectBackoff();
    expect([backoff.nextDelay(), backoff.nextDelay(), backoff.nextDelay()]).toEqual([1000, 2000, 5000]);
    backoff.reset();
    expect(backoff.nextDelay()).toBe(1000);
    expect(jitter(1000, 0.2, () => 0.5)).toBe(1000);
  });
});
