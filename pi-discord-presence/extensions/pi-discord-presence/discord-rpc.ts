import type { ConnectionState, DiscordActivity, RpcAdapter } from "./types.js";

type RpcClientLike = {
  connect?: () => Promise<unknown>;
  login?: (options?: unknown) => Promise<unknown>;
  user?: unknown;
  request?: (method: string, args?: unknown) => Promise<unknown>;
  setActivity?: (activity: Record<string, unknown>) => Promise<unknown>;
  clearActivity?: () => Promise<unknown>;
  destroy?: () => void | Promise<void>;
  transport?: { close?: () => void };
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type RpcModule = {
  Client?: new (options: { clientId?: string }) => RpcClientLike;
  default?: { Client?: new (options: { clientId?: string }) => RpcClientLike } | (new (options: { clientId?: string }) => RpcClientLike);
};

export function classifyRpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown Discord RPC error");
  if (/client.?id|application|oauth|invalid/i.test(message)) return "Invalid or unconfigured Discord client ID";
  if (/ENOENT|ECONNREFUSED|not.?found|discord/i.test(message)) return "Discord RPC unavailable; is Discord running?";
  return message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 180);
}

function getClientCtor(module: RpcModule): new (options: { clientId?: string }) => RpcClientLike {
  if (module.Client) return module.Client;
  if (typeof module.default === "function") return module.default;
  if (module.default && typeof module.default === "object" && module.default.Client) return module.default.Client;
  throw new Error("Discord RPC module did not expose a Client constructor");
}

function toRpcActivity(activity: DiscordActivity): Record<string, unknown> {
  return {
    details: activity.details,
    state: activity.state,
    largeImageKey: activity.largeImageKey,
    largeImageText: activity.largeImageText,
    smallImageText: activity.smallImageText,
    startTimestamp: activity.startTimestamp,
  };
}

export class LazyDiscordRpcAdapter implements RpcAdapter {
  private client: RpcClientLike | null = null;
  private state: ConnectionState = "disconnected";
  private lastError: string | null = null;

  constructor(private readonly importer: () => Promise<RpcModule> = () => import("@xhayper/discord-rpc").then((module) => module as unknown as RpcModule)) {}

  getState(): ConnectionState {
    return this.state;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  async connect(clientId: string): Promise<void> {
    if (this.state === "connected") return;
    this.state = "connecting";
    this.lastError = null;
    try {
      const module = await this.importer();
      const Client = getClientCtor(module);
      const client = new Client({ clientId });
      client.on?.("disconnected", () => {
        this.state = "disconnected";
      });
      if (client.connect) await client.connect();
      else if (client.login) await client.login();
      this.client = client;
      this.state = "connected";
    } catch (error) {
      this.state = "error";
      this.lastError = classifyRpcError(error);
      throw error;
    }
  }

  async setActivity(activity: DiscordActivity): Promise<void> {
    if (!this.client || this.state !== "connected") return;
    try {
      const rpcActivity = toRpcActivity(activity);
      if (this.client.setActivity) await this.client.setActivity(rpcActivity);
      else if (this.client.request) await this.client.request("SET_ACTIVITY", { pid: process.pid, activity: rpcActivity });
    } catch (error) {
      this.state = "error";
      this.lastError = classifyRpcError(error);
      throw error;
    }
  }

  async clearActivity(): Promise<void> {
    if (!this.client) return;
    try {
      if (this.client.clearActivity) await this.client.clearActivity();
      else if (this.client.request) await this.client.request("SET_ACTIVITY", { pid: process.pid });
    } catch {
      // Best-effort cleanup.
    }
  }

  async destroy(): Promise<void> {
    await this.clearActivity();
    try {
      await this.client?.destroy?.();
      this.client?.transport?.close?.();
    } catch {
      // Non-fatal shutdown.
    } finally {
      this.client = null;
      this.state = "disconnected";
    }
  }
}
