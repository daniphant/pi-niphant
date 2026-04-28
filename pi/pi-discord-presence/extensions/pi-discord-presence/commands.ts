import type { DiscordPresenceController } from "./controller.js";

type ContextLike = { hasUI?: boolean; ui?: { notify?: (message: string, level?: string) => void } };

function reply(ctx: ContextLike, message: string): string {
  if (ctx.hasUI) ctx.ui?.notify?.(message, "info");
  return message;
}

export async function handleDiscordPresenceCommand(controller: DiscordPresenceController, args: string | string[] | undefined, ctx: ContextLike): Promise<string> {
  const parts = Array.isArray(args) ? args : String(args ?? "").split(/\s+/).filter(Boolean);
  const subcommand = (parts[0] ?? "status").toLowerCase();

  switch (subcommand) {
    case "on":
      return reply(ctx, await controller.enable(ctx));
    case "off":
      return reply(ctx, await controller.disable(ctx));
    case "reconnect":
      return reply(ctx, await controller.reconnect(ctx));
    case "show-project":
      await controller.setPrivacy(true, undefined);
      return reply(ctx, "Discord Presence will show sanitized project labels.");
    case "hide-project":
      await controller.setPrivacy(false, undefined);
      return reply(ctx, "Discord Presence will hide project labels.");
    case "show-model":
      await controller.setPrivacy(undefined, true);
      return reply(ctx, "Discord Presence will show sanitized model labels.");
    case "hide-model":
      await controller.setPrivacy(undefined, false);
      return reply(ctx, "Discord Presence will hide model labels.");
    case "status":
      return reply(ctx, await controller.statusLine());
    default:
      return reply(ctx, "Usage: /discord-presence on|off|status|reconnect|show-project|hide-project|show-model|hide-model");
  }
}
