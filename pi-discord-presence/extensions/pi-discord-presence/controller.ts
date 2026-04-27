import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { ACTIVITY_DEBOUNCE_MS, HEARTBEAT_INTERVAL_MS, IDLE_AFTER_MS, LEASE_RENEW_MS } from "./constants.js";
import { ReconnectBackoff, jitter, shouldRunThrottled } from "./backoff.js";
import { resolveClientId } from "./client-id.js";
import { LazyDiscordRpcAdapter } from "./discord-rpc.js";
import { acquireOrRenewLeadership, getLeaderPath, releaseLeadership } from "./leader.js";
import { buildActivity } from "./presence.js";
import { getRegistryPath, readRegistry, removeHeartbeat, summarizeRegistry, writeHeartbeat } from "./registry.js";
import { sanitizeModelLabel, sanitizeProjectLabel } from "./sanitize.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings.js";
import { disconnectedStatusHint, formatStatus } from "./status.js";
import type { ClientIdResolution, ConnectionState, DiscordPresenceSettings, InstanceHeartbeat, PresenceStatus, RpcAdapter } from "./types.js";

type UiLike = { notify?: (message: string, level?: string) => void; setStatus?: (message: string) => void };
type ContextLike = { cwd?: string; model?: unknown; hasUI?: boolean; ui?: UiLike };
type ContextSnapshot = { cwd?: string; model?: unknown; ui?: UiLike };

type Timer = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;

function clearTimer(timer: Timer | null): void {
  if (timer) clearTimeout(timer as ReturnType<typeof setTimeout>);
}

function unref(timer: Timer): Timer {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

export class DiscordPresenceController {
  readonly instanceId = randomUUID();
  private settings: DiscordPresenceSettings = { ...DEFAULT_SETTINGS };
  private rpc: RpcAdapter;
  private backoff = new ReconnectBackoff();
  private latestCtx: ContextSnapshot | null = null;
  private status: PresenceStatus = "Waiting for input";
  private startedAt = Date.now();
  private lastActiveAt = Date.now();
  private lastActivityUpdateAt = 0;
  private heartbeatTimer: Timer | null = null;
  private idleTimer: Timer | null = null;
  private reconnectTimer: Timer | null = null;
  private leaderTimer: Timer | null = null;
  private isLeader = false;
  private registryPath: string;
  private leaderPath: string;
  private settingsPath: string | undefined;
  private clientIdEnvFiles: string[] | undefined;
  private shuttingDown = false;

  constructor(options: { rpc?: RpcAdapter; registryPath?: string; leaderPath?: string; settingsPath?: string; clientIdEnvFiles?: string[] } = {}) {
    this.rpc = options.rpc ?? new LazyDiscordRpcAdapter();
    this.registryPath = options.registryPath ?? getRegistryPath();
    this.leaderPath = options.leaderPath ?? getLeaderPath();
    this.settingsPath = options.settingsPath;
    this.clientIdEnvFiles = options.clientIdEnvFiles;
  }

  getSettings(): DiscordPresenceSettings { return this.settings; }
  getConnectionState(): ConnectionState { return this.settings.enabled ? this.rpc.getState() : "disabled"; }
  getBackoffAttempt(): number { return this.backoff.getAttempt(); }
  resolveClientId(): ClientIdResolution { return resolveClientId(this.settings, process.env, this.clientIdEnvFiles); }

  async init(ctx: ContextLike): Promise<void> {
    this.shuttingDown = false;
    this.latestCtx = this.captureContext(ctx);
    this.settings = await loadSettings(this.settingsPath);
    if (this.settings.enabled && !this.settings.firstRunNoticeShown) {
      this.notify(ctx, "Discord Presence is active and shows sanitized project/model labels. Use /discord-presence hide-project or hide-model to make it more private, or /discord-presence off to disable it.");
      this.settings.firstRunNoticeShown = true;
      await this.persist();
    }
    this.touch(ctx, "Waiting for input");
    this.startTimers();
    void this.tick(true);
  }

  touch(ctx: ContextLike | null, status: PresenceStatus): void {
    if (this.shuttingDown) return;
    if (ctx) this.latestCtx = this.captureContext(ctx);
    this.status = status;
    this.lastActiveAt = Date.now();
    this.scheduleIdle();
    void this.tick();
  }

  async enable(ctx: ContextLike): Promise<string> {
    this.shuttingDown = false;
    this.latestCtx = this.captureContext(ctx);
    this.settings.enabled = true;
    await this.persist();
    this.backoff.reset();
    this.startTimers();
    await this.tick(true);
    return "Discord Presence enabled.";
  }

  async disable(ctx?: ContextLike): Promise<string> {
    if (ctx) this.latestCtx = this.captureContext(ctx);
    this.settings.enabled = false;
    await this.persist();
    await this.rpc.destroy();
    await releaseLeadership(this.instanceId, this.leaderPath);
    await removeHeartbeat(this.instanceId, this.registryPath);
    this.isLeader = false;
    clearTimer(this.reconnectTimer); this.reconnectTimer = null;
    return "Discord Presence disabled and cleared best-effort.";
  }

  async reconnect(ctx?: ContextLike): Promise<string> {
    if (ctx) this.latestCtx = this.captureContext(ctx);
    this.backoff.reset();
    clearTimer(this.reconnectTimer); this.reconnectTimer = null;
    await this.rpc.destroy();
    await this.tick(true);
    return "Discord Presence reconnect requested.";
  }

  async statusLine(): Promise<string> {
    return formatStatus(this.settings, this.resolveClientId(), this.getConnectionState(), this.backoff.getAttempt());
  }

  async setPrivacy(showProject: boolean | undefined, showModel: boolean | undefined): Promise<void> {
    if (typeof showProject === "boolean") this.settings.showProject = showProject;
    if (typeof showModel === "boolean") this.settings.showModel = showModel;
    await this.persist();
    await this.tick(true);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    clearTimer(this.heartbeatTimer); clearTimer(this.idleTimer); clearTimer(this.reconnectTimer); clearTimer(this.leaderTimer);
    this.heartbeatTimer = this.idleTimer = this.reconnectTimer = this.leaderTimer = null;
    await this.rpc.destroy();
    await releaseLeadership(this.instanceId, this.leaderPath);
    await removeHeartbeat(this.instanceId, this.registryPath);
  }

  private async persist(): Promise<void> {
    try { await saveSettings(this.settings, this.settingsPath); } catch { /* non-fatal */ }
  }

  private captureContext(ctx: ContextLike): ContextSnapshot {
    const snapshot: ContextSnapshot = {};
    try { snapshot.cwd = ctx.cwd; } catch { /* stale ctx; ignore */ }
    try { snapshot.model = ctx.model; } catch { /* stale ctx; ignore */ }
    try { if (ctx.hasUI) snapshot.ui = ctx.ui; } catch { /* stale ctx; ignore */ }
    return snapshot;
  }

  private notify(ctx: ContextLike, message: string): void {
    try { if (ctx.hasUI) ctx.ui?.notify?.(message, "info"); } catch { /* stale ctx; ignore */ }
  }

  private setUiStatus(message: string): void {
    try { this.latestCtx?.ui?.setStatus?.(message); } catch { /* stale UI; ignore */ }
  }

  private startTimers(): void {
    if (!this.heartbeatTimer) this.heartbeatTimer = unref(setInterval(() => void this.tick(), jitter(HEARTBEAT_INTERVAL_MS)));
    if (!this.leaderTimer) this.leaderTimer = unref(setInterval(() => void this.renewLeadership(), LEASE_RENEW_MS));
    this.scheduleIdle();
  }

  private scheduleIdle(): void {
    clearTimer(this.idleTimer);
    this.idleTimer = unref(setTimeout(() => {
      if (Date.now() - this.lastActiveAt >= IDLE_AFTER_MS) this.status = "Idle";
      void this.tick(true);
    }, IDLE_AFTER_MS));
  }

  private makeHeartbeat(now = Date.now()): InstanceHeartbeat {
    const ctx = this.latestCtx;
    const projectSource = this.settings.showProject ? basename(ctx?.cwd || "") : "Pi";
    const modelSource = this.settings.showModel ? ctx?.model : "AI model";
    return {
      id: this.instanceId,
      pid: process.pid,
      startedAt: this.startedAt,
      lastActiveAt: this.lastActiveAt,
      projectLabel: this.settings.showProject ? sanitizeProjectLabel(projectSource) : "Pi",
      modelLabel: this.settings.showModel ? sanitizeModelLabel(modelSource) : "AI model",
      status: this.status,
      connectionState: this.getConnectionState(),
      updatedAt: now,
    };
  }

  private async renewLeadership(): Promise<void> {
    if (!this.settings.enabled || !this.resolveClientId().configured) {
      if (this.isLeader) await releaseLeadership(this.instanceId, this.leaderPath);
      this.isLeader = false;
      return;
    }
    this.isLeader = await acquireOrRenewLeadership(this.instanceId, this.leaderPath);
    if (!this.isLeader) await this.rpc.destroy();
  }

  private async tick(force = false): Promise<void> {
    const now = Date.now();
    if (this.shuttingDown || !this.settings.enabled) return;
    const clientId = this.resolveClientId();
    const registry = await writeHeartbeat(this.makeHeartbeat(now), this.registryPath, now);
    if (!clientId.configured || !clientId.clientId) {
      this.setUiStatus(disconnectedStatusHint("missing client ID"));
      return;
    }
    await this.renewLeadership();
    if (!this.isLeader) return;
    if (!force && !shouldRunThrottled(now, this.lastActivityUpdateAt, ACTIVITY_DEBOUNCE_MS)) return;

    try {
      if (this.rpc.getState() !== "connected") await this.rpc.connect(clientId.clientId);
      const freshRegistry = summarizeRegistry(await readRegistry(this.registryPath, now));
      const lastActive = freshRegistry.lastActive ?? summarizeRegistry(registry).lastActive ?? this.makeHeartbeat(now);
      await this.rpc.setActivity(buildActivity({
        projectLabel: lastActive.projectLabel,
        modelLabel: lastActive.modelLabel,
        sessionCount: Math.max(1, freshRegistry.count || registry.instances.length),
        status: lastActive.status,
        startedAt: lastActive.startedAt,
        showProject: this.settings.showProject,
        showModel: this.settings.showModel,
      }));
      this.lastActivityUpdateAt = now;
      this.backoff.reset();
    } catch {
      this.setUiStatus(disconnectedStatusHint(this.rpc.getLastError() ?? "RPC unavailable"));
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.settings.enabled || !this.isLeader) return;
    const delay = this.backoff.nextDelay();
    this.reconnectTimer = unref(setTimeout(() => {
      this.reconnectTimer = null;
      void this.tick(true);
    }, delay));
  }
}
