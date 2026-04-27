import { VERSION, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PACKAGE_NAME = "@mariozechner/pi-coding-agent";
const CHECKED = Symbol.for("pi-niphant.update-prompt.checked");

type GlobalWithUpdatePrompt = typeof globalThis & { [CHECKED]?: boolean };

function getCurrentVersion(): string | undefined {
	return VERSION;
}

async function getLatestVersion(signal?: AbortSignal): Promise<string | undefined> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`, {
			signal: signal ?? AbortSignal.timeout(10_000),
		});
		if (!response.ok) return undefined;
		const data = (await response.json()) as { version?: string };
		return data.version;
	} catch {
		return undefined;
	}
}

export default function updatePromptExtension(pi: ExtensionAPI) {
	// Pi core checks this env var before it renders its built-in startup update notice.
	// Set it during extension load; core's check runs later, after session_start.
	process.env.PI_SKIP_VERSION_CHECK = process.env.PI_SKIP_VERSION_CHECK || "1";

	async function checkAndPrompt(
		ctx: Parameters<Parameters<typeof pi.on>[1]>[1],
		options: { force?: boolean; dryRun?: boolean } = {}
	) {
		if (!ctx.hasUI || process.env.PI_OFFLINE) return;
		const globalState = globalThis as GlobalWithUpdatePrompt;
		if (!options.force && !options.dryRun && globalState[CHECKED]) return;
		if (!options.dryRun) globalState[CHECKED] = true;

		const currentVersion = getCurrentVersion();
		const latestVersion = options.dryRun ? "999.999.999-test" : await getLatestVersion(ctx.signal);
		if (!currentVersion || !latestVersion) {
			if (options.force) ctx.ui.notify("Could not check Pi update status.", "warning");
			return;
		}
		if (!options.dryRun && currentVersion === latestVersion) {
			if (options.force) ctx.ui.notify(`Pi is already up to date (${currentVersion}).`, "info");
			return;
		}

		const commandText = options.dryRun ? "sleep 2  # fake update test" : `npm install -g ${PACKAGE_NAME}`;
		const shouldUpdate = await ctx.ui.confirm(
			options.dryRun ? "Test Pi update UI?" : "Update Pi?",
			`Current: ${currentVersion}\nLatest:  ${latestVersion}\n\n${options.dryRun ? "Run fake update flow now?" : "Install now with npm?"}\n\n  ${commandText}\n\nPi will exit after ${options.dryRun ? "the fake update" : "updating"}. Start it again to continue.`
		);
		if (!shouldUpdate) return;

		ctx.ui.setStatus("pi-update", options.dryRun ? "Testing Pi update flow..." : `Updating Pi to ${latestVersion}...`);
		ctx.ui.setWidget("pi-update", [
			options.dryRun ? "Testing Pi update flow..." : `Updating Pi to ${latestVersion}...`,
			`Running: ${commandText}`,
		]);
		const result = options.dryRun
			? await pi.exec("node", ["-e", "setTimeout(() => { console.log('fake update complete'); }, 2000)"], {
					timeout: 10_000,
					signal: ctx.signal,
				})
			: await pi.exec("npm", ["install", "-g", PACKAGE_NAME], {
					timeout: 120_000,
					signal: ctx.signal,
				});
		ctx.ui.setStatus("pi-update", undefined);
		ctx.ui.setWidget("pi-update", undefined);

		if (result.code !== 0) {
			ctx.ui.notify(
				`Pi ${options.dryRun ? "update test" : "update"} failed (exit ${result.code}). ${result.stderr || result.stdout || "No output."}`,
				"error"
			);
			return;
		}

		if (options.dryRun) {
			ctx.ui.notify("Pi update test completed. Exiting gracefully; no update was installed.", "info");
		} else {
			ctx.ui.notify("Pi updated. Exiting gracefully; restart Pi to use the new version.", "info");
		}

		ctx.shutdown();
		// In some startup/dialog contexts ctx.shutdown() can be deferred and not visibly
		// terminate the already-idle UI. Fall back to a clean process exit after giving
		// Pi a moment to run its shutdown path and render the notification.
		setTimeout(() => process.exit(0), 750).unref();
	}

	pi.on("session_start", (_event, ctx) => {
		// Defer until after startup rendering settles. Some Pi builds initialize
		// extension UI during session_start but do not reliably display modal
		// dialogs while resource rebinding is still on the stack.
		setTimeout(() => {
			void checkAndPrompt(ctx).catch((error) => {
				ctx.ui.notify(`Pi update check failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			});
		}, 250);
	});

	pi.registerCommand("pi-update-check", {
		description: "Manually check for a Pi core update and optionally install it",
		handler: async (_args, ctx) => {
			await checkAndPrompt(ctx, { force: true });
		},
	});

	pi.registerCommand("pi-update-test", {
		description: "Test the Pi update prompt UI with a fake delayed update command",
		handler: async (_args, ctx) => {
			await checkAndPrompt(ctx, { force: true, dryRun: true });
		},
	});
}
