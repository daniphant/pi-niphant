import { DISCORD_FIELD_MAX_CHARS, PI_LOGO_ASSET_KEY } from "./constants.js";
import { sanitizeModelLabel, sanitizeProjectLabel, truncateText } from "./sanitize.js";
import type { ActivityInput, DiscordActivity, InstanceHeartbeat } from "./types.js";

export function buildActivity(input: ActivityInput): DiscordActivity {
  const project = input.showProject ? sanitizeProjectLabel(input.projectLabel) : "Pi";
  const model = input.showModel ? sanitizeModelLabel(input.modelLabel) : "AI model";
  const sessionCount = Math.max(1, input.sessionCount);
  const sessionSuffix = sessionCount === 1 ? "" : ` • ${sessionCount} sessions`;

  return {
    details: truncateText(`Working in ${project}`, DISCORD_FIELD_MAX_CHARS),
    state: truncateText(`${model}${sessionSuffix}`, DISCORD_FIELD_MAX_CHARS),
    largeImageKey: PI_LOGO_ASSET_KEY,
    largeImageText: "Pi Coding Agent",
    smallImageText: input.status,
    startTimestamp: Math.floor(input.startedAt / 1000),
  };
}

export function selectLastActive(instances: InstanceHeartbeat[]): InstanceHeartbeat | null {
  return [...instances].sort((a, b) => {
    if (b.lastActiveAt !== a.lastActiveAt) return b.lastActiveAt - a.lastActiveAt;
    if (a.pid !== b.pid) return a.pid - b.pid;
    return a.id.localeCompare(b.id);
  })[0] ?? null;
}
