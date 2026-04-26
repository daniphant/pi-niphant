export type PresenceStatus = "Agent working" | "Waiting for input" | "Idle";
export type ClientIdSource = "env" | "settings" | "default" | "missing";
export type ConnectionState = "disabled" | "unconfigured" | "disconnected" | "connecting" | "connected" | "error";

export interface DiscordPresenceSettings {
  enabled: boolean;
  showProject: boolean;
  showModel: boolean;
  firstRunNoticeShown: boolean;
  clientId?: string;
}

export interface ClientIdResolution {
  clientId: string | null;
  source: ClientIdSource;
  configured: boolean;
}

export interface InstanceHeartbeat {
  id: string;
  pid: number;
  startedAt: number;
  lastActiveAt: number;
  projectLabel: string;
  modelLabel: string;
  status: PresenceStatus;
  connectionState?: ConnectionState;
  updatedAt: number;
}

export interface RegistryFile {
  schemaVersion: 1;
  instances: InstanceHeartbeat[];
}

export interface LeaderLease {
  schemaVersion: 1;
  instanceId: string;
  expiresAt: number;
  updatedAt: number;
}

export interface ActivityInput {
  projectLabel: string;
  modelLabel: string;
  sessionCount: number;
  status: PresenceStatus;
  startedAt: number;
  showProject: boolean;
  showModel: boolean;
}

export interface DiscordActivity {
  details: string;
  state: string;
  largeImageKey?: string;
  largeImageText?: string;
  smallImageText?: string;
  startTimestamp?: number;
}

export interface RpcAdapter {
  connect(clientId: string): Promise<void>;
  setActivity(activity: DiscordActivity): Promise<void>;
  clearActivity(): Promise<void>;
  destroy(): Promise<void>;
  getState(): ConnectionState;
  getLastError(): string | null;
}
