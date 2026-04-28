import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { handleDiscordPresenceCommand } from "./commands.js";
import { DiscordPresenceController } from "./controller.js";
import { registerLifecycleHandlers } from "./lifecycle.js";

export default function discordPresenceExtension(pi: ExtensionAPI): void {
  const controller = new DiscordPresenceController();

  registerLifecycleHandlers(pi as never, controller);

  pi.registerCommand("discord-presence", {
    description: "Control Discord Rich Presence for Pi",
    handler: async (args, ctx) => {
      await handleDiscordPresenceCommand(controller, args as string | string[] | undefined, ctx as never);
    },
  });
}
