import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const askUserQuestionParameters = Type.Object({
	question: Type.String({
		description: "The concise question to ask the user.",
	}),
	suggestions: Type.Optional(
		Type.Array(Type.String(), {
			description: "Optional suggested answers. Use only when the answer is likely one of these choices.",
		})
	),
	allow_freeform: Type.Optional(
		Type.Boolean({
			description: "Whether the user may type an answer outside suggestions. Defaults to true.",
		})
	),
	placeholder: Type.Optional(Type.String({ description: "Placeholder text for a free-form answer." })),
	timeout_ms: Type.Optional(
		Type.Number({
			description: "Optional timeout in milliseconds. If it expires, the tool returns with cancelled=true.",
			minimum: 1,
		})
	),
});

export default function askUserExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User",
		description:
			"Ask the user a clarifying question through Pi's native UI and return their answer. Use this only when blocked or when a decision materially affects the work.",
		promptSnippet: "Ask the user a blocking clarifying question and wait for the answer.",
		promptGuidelines: [
			"Use ask_user_question only when you are genuinely blocked or need a user decision that materially changes the outcome; otherwise proceed with reasonable assumptions and mention them.",
			"When using ask_user_question, ask one concise question at a time and include suggested answers when helpful.",
		],
		parameters: askUserQuestionParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: "Cannot ask the user: Pi UI is not available in this mode.",
						},
					],
					details: { cancelled: true, reason: "no_ui" },
				};
			}

			const question = params.question.trim();
			const suggestions = (params.suggestions ?? []).map((s: string) => s.trim()).filter(Boolean);
			const allowFreeform = params.allow_freeform ?? true;
			const timeout = params.timeout_ms ? { timeout: params.timeout_ms } : undefined;

			if (signal?.aborted) {
				return { content: [{ type: "text" as const, text: "Question cancelled." }], details: { cancelled: true } };
			}

			let answer: string | undefined;
			if (suggestions.length > 0) {
				const other = "Other…";
				const options = allowFreeform ? [...suggestions, other] : suggestions;
				const choice = await ctx.ui.select(question, options, timeout);
				if (choice && choice !== other) answer = choice;
				else if (choice === other) answer = await ctx.ui.input(question, params.placeholder ?? "Type your answer", timeout);
			} else {
				answer = await ctx.ui.input(question, params.placeholder ?? "Type your answer", timeout);
			}

			if (answer === undefined || answer.trim() === "") {
				return {
					content: [{ type: "text" as const, text: "No answer provided." }],
					details: { cancelled: true, question },
				};
			}

			return {
				content: [{ type: "text" as const, text: answer }],
				details: { cancelled: false, question, answer },
			};
		},
	});
}
