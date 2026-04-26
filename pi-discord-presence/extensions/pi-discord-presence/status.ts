import type { ClientIdResolution, ConnectionState, DiscordPresenceSettings } from "./types.js";

export function formatStatus(settings: DiscordPresenceSettings, clientId: ClientIdResolution, connection: ConnectionState, backoffAttempt: number): string {
  const privacy = `project=${settings.showProject ? "shown" : "hidden"}, model=${settings.showModel ? "shown" : "hidden"}`;
  return [
    `Discord Presence: ${settings.enabled ? "enabled" : "disabled"}`,
    `connection=${connection}`,
    `clientIdSource=${clientId.source}`,
    `privacy(${privacy})`,
    `reconnectAttempt=${backoffAttempt}`,
  ].join("; ");
}

export function disconnectedStatusHint(reason: string): string {
  return `Discord Presence disconnected (${reason}). Run /discord-presence reconnect after opening Discord.`;
}
