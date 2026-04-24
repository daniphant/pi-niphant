/**
 * /clear command — like /new but also /reload.
 *
 * Matches the /clear command from Codex CLI and Claude Code.
 * Starts a fresh session AND reloads extensions, skills, prompts,
 * keybindings, and context files from disk.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function clearExtension(pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "New session + reload (like Codex/Claude Code /clear)",
		handler: async (_args, ctx) => {
			const parentSession = ctx.sessionManager.getSessionFile();

			await ctx.newSession({
				parentSession,
				withSession: async (ctx) => {
					await ctx.reload();
					return;
				},
			});
		},
	});
}
