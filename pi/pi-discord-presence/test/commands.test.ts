import { describe, expect, it } from "vitest";
import { handleDiscordPresenceCommand } from "../extensions/pi-discord-presence/commands.js";

describe("commands", () => {
  it("routes subcommands", async () => {
    const calls: string[] = [];
    const controller = {
      enable: async () => { calls.push("enable"); return "enabled"; },
      disable: async () => { calls.push("disable"); return "disabled"; },
      reconnect: async () => { calls.push("reconnect"); return "reconnect"; },
      statusLine: async () => "status",
      setPrivacy: async () => { calls.push("privacy"); },
    } as never;
    const ctx = { hasUI: false };
    expect(await handleDiscordPresenceCommand(controller, "on", ctx)).toBe("enabled");
    expect(await handleDiscordPresenceCommand(controller, "off", ctx)).toBe("disabled");
    expect(await handleDiscordPresenceCommand(controller, "reconnect", ctx)).toBe("reconnect");
    expect(await handleDiscordPresenceCommand(controller, "status", ctx)).toBe("status");
    expect(await handleDiscordPresenceCommand(controller, "show-project", ctx)).toContain("project");
    expect(calls).toEqual(["enable", "disable", "reconnect", "privacy"]);
  });
});
