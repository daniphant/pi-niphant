import { RPC_OPERATION_TIMEOUT_MS } from "./constants.js";
import type { ConnectionState, DiscordActivity, RpcAdapter } from "./types.js";

type SocketLike = {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  destroy?: () => void;
};

type RpcTransportLike = {
  close?: () => void;
  send?: (...args: unknown[]) => unknown;
  socket?: SocketLike;
};

type RpcClientLike = {
  connect?: () => Promise<unknown>;
  login?: (options?: unknown) => Promise<unknown>;
  user?: unknown;
  request?: (method: string, args?: unknown) => Promise<unknown>;
  setActivity?: (activity: Record<string, unknown>) => Promise<unknown>;
  clearActivity?: () => Promise<unknown>;
  destroy?: () => void | Promise<void>;
  transport?: RpcTransportLike;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type RpcModule = {
  Client?: new (options: { clientId?: string }) => RpcClientLike;
  default?: { Client?: new (options: { clientId?: string }) => RpcClientLike } | (new (options: { clientId?: string }) => RpcClientLike);
};

export function classifyRpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown Discord RPC error");
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (/client.?id|application|oauth|invalid/i.test(message)) return "Invalid or unconfigured Discord client ID";
  if (/EPIPE|ECONNRESET|ENOENT|ECONNREFUSED|not.?found|discord/i.test(`${code} ${message}`)) return "Discord RPC unavailable; is Discord running?";
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Discord RPC cleanup timed out")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class LazyDiscordRpcAdapter implements RpcAdapter {
  private client: RpcClientLike | null = null;
  private state: ConnectionState = "disconnected";
  private lastError: string | null = null;
  private guardedSockets = new WeakSet<object>();
  private observedTransportError: unknown = null;

  constructor(
    private readonly importer: () => Promise<RpcModule> = () => import("@xhayper/discord-rpc").then((module) => module as unknown as RpcModule),
    private readonly operationTimeoutMs = RPC_OPERATION_TIMEOUT_MS,
  ) {}

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
    this.observedTransportError = null;
    let client: RpcClientLike | null = null;
    try {
      const module = await this.importer();
      const Client = getClientCtor(module);
      client = new Client({ clientId });
      this.installTransportErrorGuard(client);
      client.on?.("disconnected", () => {
        this.state = "disconnected";
      });
      if (client.connect) await withTimeout(client.connect(), this.operationTimeoutMs);
      else if (client.login) await withTimeout(client.login(), this.operationTimeoutMs);
      if (this.observedTransportError) throw this.observedTransportError;
      this.client = client;
      this.state = "connected";
    } catch (error) {
      this.state = "error";
      this.lastError = classifyRpcError(error);
      try { await (client ?? this.client)?.destroy?.(); } catch { /* non-fatal cleanup */ }
      this.client = null;
      throw error;
    }
  }

  private installTransportErrorGuard(client: RpcClientLike): void {
    const transport = client.transport;
    if (!transport) return;

    const guardCurrentSocket = () => {
      const socket = transport.socket;
      if (!socket || this.guardedSockets.has(socket)) return;
      this.guardedSockets.add(socket);
      socket.on?.("error", (error: unknown) => this.handleTransportError(error, socket));
    };

    guardCurrentSocket();
    const originalSend = transport.send;
    if (typeof originalSend === "function") {
      transport.send = (...args: unknown[]) => {
        guardCurrentSocket();
        try {
          return originalSend.apply(transport, args);
        } finally {
          guardCurrentSocket();
        }
      };
    }
  }

  private handleTransportError(error: unknown, socket?: SocketLike): void {
    this.observedTransportError = error;
    this.state = "error";
    this.lastError = classifyRpcError(error);
    try { socket?.destroy?.(); } catch { /* non-fatal socket cleanup */ }
  }

  async setActivity(activity: DiscordActivity): Promise<void> {
    if (!this.client || this.state !== "connected") return;
    try {
      const rpcActivity = toRpcActivity(activity);
      if (this.client.setActivity) await withTimeout(this.client.setActivity(rpcActivity), this.operationTimeoutMs);
      else if (this.client.request) await withTimeout(this.client.request("SET_ACTIVITY", { pid: process.pid, activity: rpcActivity }), this.operationTimeoutMs);
    } catch (error) {
      this.state = "error";
      this.lastError = classifyRpcError(error);
      throw error;
    }
  }

  async clearActivity(): Promise<void> {
    if (!this.client) return;
    try {
      if (this.client.clearActivity) await withTimeout(this.client.clearActivity(), this.operationTimeoutMs);
      else if (this.client.request) await withTimeout(this.client.request("SET_ACTIVITY", { pid: process.pid }), this.operationTimeoutMs);
    } catch {
      // Best-effort cleanup.
    }
  }

  async destroy(): Promise<void> {
    await this.clearActivity();
    try {
      const destroyResult = this.client?.destroy?.();
      if (destroyResult) await withTimeout(Promise.resolve(destroyResult), this.operationTimeoutMs);
      this.client?.transport?.close?.();
    } catch {
      // Non-fatal shutdown.
    } finally {
      this.client = null;
      this.state = "disconnected";
    }
  }
}
