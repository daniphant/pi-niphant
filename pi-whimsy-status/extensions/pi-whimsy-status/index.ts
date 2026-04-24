import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const REFRESH_MS = 100;
const ROTATE_MS = 7000;
const SHIMMER_SWEEP_MS = 2200;
const SHIMMER_PADDING = 8;
const SHIMMER_HALF_WIDTH = 4;

const messages = [
	// Familiar classics for variety
	"Pondering…",
	"Mulling…",
	"Ruminating…",
	"Noodling…",
	"Marinating…",
	"Concocting…",
	"Wrangling…",
	"Reticulating splines…",
	"Consulting the oracle…",
	"Stroking chin thoughtfully…",

	// Pi-flavored twists
	"Untangling the context noodles…",
	"Polishing the pi-edges…",
	"Whispering to the token stream…",
	"Coaxing the gremlins into alignment…",
	"Consulting the tiny terminal gods…",
	"Teaching the bytes some manners…",
	"Bribing the spinner sprites…",
	"Giving the prompt a second espresso…",
	"Negotiating with the cache…",
	"Wiggling the commas into place…",
	"Dusting off the semicolons…",
	"Tuning the vibes to hexadecimal…",
	"Tidying the invisible whitespace…",
	"Convincing tabs and spaces to collaborate…",
	"Folding the branches neatly…",
	"Reassuring the linter…",
	"Making the cursor feel included…",
	"Asking the shell nicely…",
	"Counting to UTF-8…",
	"Re-threading the stack of thoughts…",
	"Sharpening the Unicode…",
	"Coaching the diff into existence…",
	"Putting the ducks in dependency order…",
	"Reading the room temperature of the prompt…",
	"Smoothing the edges off the edge cases…",
	"Encouraging the logs to be more forthcoming…",
	"Lining up the invisible moving parts…",
	"Sweeping for stray backticks…",
	"Giving the heuristics a pep talk…",
	"Massaging the context window…",
];

function shuffle<T>(items: readonly T[]): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j]!, copy[i]!];
	}
	return copy;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
	return `${seconds}s`;
}

function shimmerText(theme: ExtensionContext["ui"]["theme"], text: string): string {
	const chars = [...text];
	if (chars.length === 0) return text;

	const period = chars.length + SHIMMER_PADDING * 2;
	const phase = (Date.now() % SHIMMER_SWEEP_MS) / SHIMMER_SWEEP_MS;
	const position = phase * period;

	return chars
		.map((char, index) => {
			const distance = Math.abs(index + SHIMMER_PADDING - position);
			if (distance > SHIMMER_HALF_WIDTH) return theme.fg("muted", char);

			const intensity = 0.5 * (1 + Math.cos(Math.PI * (distance / SHIMMER_HALF_WIDTH)));
			if (intensity > 0.7) return theme.fg("accent", char);
			if (intensity > 0.35) return theme.fg("thinkingMedium", char);
			return theme.fg("muted", char);
		})
		.join("");
}

function renderStatus(ctx: ExtensionContext, message: string, startedAt: number): string {
	const theme = ctx.ui.theme;
	const elapsed = formatDuration(Date.now() - startedAt);
	const animatedMessage = shimmerText(theme, message);
	const metaOpen = theme.fg("dim", ` (${elapsed} • `);
	const interrupt = theme.fg("dim", "esc");
	const metaClose = theme.fg("dim", " to interrupt)");
	return `${animatedMessage}${metaOpen}${interrupt}${metaClose}`;
}

export default function whimsicalStatus(pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let startedAt: number | null = null;
	let rotatedAt = 0;
	let currentMessage = "Working…";
	let queue = shuffle(messages);

	function nextMessage(): string {
		if (messages.length === 0) return "Working…";
		if (queue.length === 0) {
			queue = shuffle(messages.filter((message) => message !== currentMessage));
			if (queue.length === 0) queue = shuffle(messages);
		}
		return queue.shift() ?? "Working…";
	}

	function clearWorkingMessage(ctx: ExtensionContext) {
		ctx.ui.setWorkingMessage();
	}

	function stop(ctx: ExtensionContext) {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		startedAt = null;
		rotatedAt = 0;
		clearWorkingMessage(ctx);
	}

	function tick(ctx: ExtensionContext) {
		if (startedAt === null) return;
		if (Date.now() - rotatedAt >= ROTATE_MS) {
			currentMessage = nextMessage();
			rotatedAt = Date.now();
		}
		ctx.ui.setWorkingMessage(renderStatus(ctx, currentMessage, startedAt));
	}

	function start(ctx: ExtensionContext) {
		stop(ctx);
		startedAt = Date.now();
		rotatedAt = startedAt;
		currentMessage = nextMessage();
		tick(ctx);
		timer = setInterval(() => tick(ctx), REFRESH_MS);
	}

	pi.on("session_start", async (_event, ctx) => {
		clearWorkingMessage(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		start(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		stop(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stop(ctx);
	});
}
