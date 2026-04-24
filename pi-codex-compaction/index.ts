import { complete } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

const CODEX_SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

const CODEX_SUMMARY_PREFIX = `Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:`;

function notifyEnabled() {
  return !/^(0|false|no|off)$/i.test(process.env.PI_CODEX_COMPACTION_NOTIFY ?? "true");
}

function maxTokens() {
  const parsed = Number(process.env.PI_CODEX_COMPACTION_MAX_TOKENS ?? "12000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12000;
}

function resolveModel(ctx: ExtensionContext): Model<any> | undefined {
  const configured = process.env.PI_CODEX_COMPACTION_MODEL?.trim();
  if (configured) {
    const slash = configured.indexOf("/");
    if (slash > 0) {
      const provider = configured.slice(0, slash);
      const modelId = configured.slice(slash + 1);
      return ctx.modelRegistry.find(provider, modelId);
    }
  }

  // Prefer the active model so compaction inherits the user's current quality/capability choice.
  if (ctx.model) return ctx.model;

  return ctx.modelRegistry.find("openai-codex", "gpt-5.5");
}

function buildPrompt(opts: {
  conversationText: string;
  previousSummary?: string;
  customInstructions?: string;
  readFiles?: string[];
  modifiedFiles?: string[];
}) {
  const previous = opts.previousSummary?.trim()
    ? `\n\nPrevious checkpoint summary to merge forward:\n${opts.previousSummary.trim()}`
    : "";
  const custom = opts.customInstructions?.trim()
    ? `\n\nUser-provided compaction focus/instructions:\n${opts.customInstructions.trim()}`
    : "";
  const readFiles = opts.readFiles?.length
    ? `\n\nFiles read or referenced so far:\n${opts.readFiles.map((f) => `- ${f}`).join("\n")}`
    : "";
  const modifiedFiles = opts.modifiedFiles?.length
    ? `\n\nFiles modified so far:\n${opts.modifiedFiles.map((f) => `- ${f}`).join("\n")}`
    : "";

  return `${CODEX_SUMMARIZATION_PROMPT}${previous}${custom}${readFiles}${modifiedFiles}

Return structured Markdown with these sections when applicable:

## Current Goal
## User Preferences / Constraints
## Work Completed
## Current State
## Files / Symbols / Commands That Matter
## Decisions Made
## Remaining Work
## Risks / Gotchas
## Exact Continuation Instructions

Do not include generic filler. Preserve exact file paths, command names, URLs, API names, model names, and user preferences. If something is uncertain, mark it as uncertain.

<conversation>
${opts.conversationText}
</conversation>`;
}

function extractFileDetails(previousSummary: string | undefined, preparation: any) {
  const details = preparation?.details ?? {};
  const readFiles = Array.isArray(details.readFiles) ? details.readFiles : [];
  const modifiedFiles = Array.isArray(details.modifiedFiles) ? details.modifiedFiles : [];

  // Pi's default preparation usually already handles file details; this fallback
  // lightly extracts XML-ish blocks from previous summaries/custom formats.
  const readFromSummary = [...(previousSummary?.matchAll(/<read-files>([\s\S]*?)<\/read-files>/g) ?? [])]
    .flatMap((m) => m[1].split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  const modifiedFromSummary = [...(previousSummary?.matchAll(/<modified-files>([\s\S]*?)<\/modified-files>/g) ?? [])]
    .flatMap((m) => m[1].split(/\r?\n/).map((s) => s.trim()).filter(Boolean));

  return {
    readFiles: [...new Set([...readFiles, ...readFromSummary])],
    modifiedFiles: [...new Set([...modifiedFiles, ...modifiedFromSummary])],
  };
}

export default function codexCompaction(pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, signal, customInstructions } = event;
    const {
      messagesToSummarize,
      turnPrefixMessages,
      tokensBefore,
      firstKeptEntryId,
      previousSummary,
    } = preparation;

    const model = resolveModel(ctx);
    if (!model) {
      if (ctx.hasUI && notifyEnabled()) ctx.ui.notify("Codex compaction: no usable model found; using Pi default compaction.", "warning");
      return undefined;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      if (ctx.hasUI && notifyEnabled()) {
        ctx.ui.notify(`Codex compaction: auth unavailable for ${model.provider}/${model.id}; using Pi default compaction.${auth.ok ? "" : ` ${auth.error}`}`, "warning");
      }
      return undefined;
    }

    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
    if (!allMessages.length && !previousSummary) return undefined;

    if (ctx.hasUI && notifyEnabled()) {
      ctx.ui.notify(
        `Codex-style compaction: summarizing ${allMessages.length} message(s), ${tokensBefore.toLocaleString()} tokens, with ${model.provider}/${model.id}…`,
        "info",
      );
    }

    const conversationText = serializeConversation(convertToLlm(allMessages));
    const files = extractFileDetails(previousSummary, preparation);
    const prompt = buildPrompt({
      conversationText,
      previousSummary,
      customInstructions,
      readFiles: files.readFiles,
      modifiedFiles: files.modifiedFiles,
    });

    try {
      const response = await complete(
        model,
        {
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: maxTokens(),
          signal,
        },
      );

      const body = response.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();

      if (!body) {
        if (ctx.hasUI && notifyEnabled() && !signal.aborted) ctx.ui.notify("Codex compaction produced an empty summary; using Pi default compaction.", "warning");
        return undefined;
      }

      const summary = `${CODEX_SUMMARY_PREFIX}\n${body}`;

      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore,
          details: {
            style: "codex-checkpoint-handoff",
            model: `${model.provider}/${model.id}`,
            readFiles: files.readFiles,
            modifiedFiles: files.modifiedFiles,
          },
        },
      };
    } catch (error) {
      if (ctx.hasUI && notifyEnabled() && !signal.aborted) {
        ctx.ui.notify(`Codex compaction failed; using Pi default compaction. ${error instanceof Error ? error.message : String(error)}`, "error");
      }
      return undefined;
    }
  });
}
