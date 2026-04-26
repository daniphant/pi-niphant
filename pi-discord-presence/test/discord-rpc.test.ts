import { describe, expect, it, vi } from "vitest";
import { classifyRpcError, LazyDiscordRpcAdapter } from "../extensions/pi-discord-presence/discord-rpc.js";

describe("LazyDiscordRpcAdapter", () => {
  it("does not import until connect and can set/clear/destroy activity", async () => {
    const calls: string[] = [];
    class Client {
      on() {}
      async login() { calls.push("login"); }
      async setActivity() { calls.push("setActivity"); }
      async clearActivity() { calls.push("clearActivity"); }
      destroy() { calls.push("destroy"); }
    }
    const importer = vi.fn(async () => ({ Client }));
    const adapter = new LazyDiscordRpcAdapter(importer);
    expect(importer).not.toHaveBeenCalled();
    await adapter.connect("123456789012345678");
    await adapter.setActivity({ details: "Working in Pi", state: "AI model • 1 Pi session" });
    await adapter.destroy();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["login", "setActivity", "clearActivity", "destroy"]);
  });

  it("tracks errors safely", async () => {
    const adapter = new LazyDiscordRpcAdapter(async () => { throw new Error("client id invalid 123456789012345678"); });
    await expect(adapter.connect("123456789012345678")).rejects.toThrow();
    expect(adapter.getState()).toBe("error");
    expect(adapter.getLastError()).toBe("Invalid or unconfigured Discord client ID");
  });
});

describe("classifyRpcError", () => {
  it("classifies common RPC failures", () => {
    expect(classifyRpcError(new Error("ENOENT discord-ipc"))).toContain("Discord RPC unavailable");
    expect(classifyRpcError(new Error("bad client id"))).toContain("client ID");
  });
});
