import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DELEGATED_TOOLS = new Set(["run_delegated_agents", "infer_and_run_delegated_agents"]);

const EXPLICIT_DELEGATION_PATTERNS = [
  /\bspawn\b.*\bagent\b/i,
  /\bsub-?agent\b/i,
  /\brun\b.*\bagent\b/i,
  /\bdelegate\b/i,
  /\bhave\b.*\bagent\b/i,
  /\bask\b.*\bagent\b/i,
  /\bconsensus\b/i,
  /\bask\b.*\b(models?|reviewers?)\b/i,
  /\b(e2e|end-to-end|browser|playwright)\b.*\b(agent|test|verify|check)\b/i,
];

const OBJECTIVE_ARTIFACT_PATTERNS = [
  /\b(e2e|end-to-end|browser|playwright|screenshot|trace|console|network)\b/i,
  /\bconsensus\b/i,
  /\bindependent\s+(verification|review)\b/i,
  /\b(long-running|long running|benchmark|test suite|ci)\b/i,
];

const BAD_EXPLORATION_PATTERNS = [
  /\b(explore|inspect|map|summari[sz]e|analy[sz]e)\b.*\b(repo|repository|codebase|architecture|frontend|backend)\b/i,
  /\b(find|locate)\b.*\b(where|file|implementation|code)\b/i,
  /\barchitecture\s+summary\b/i,
];

function stringifyInput(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return String(input ?? "");
  }
}

function permittedByText(text: string): boolean {
  return EXPLICIT_DELEGATION_PATTERNS.some((pattern) => pattern.test(text)) || OBJECTIVE_ARTIFACT_PATTERNS.some((pattern) => pattern.test(text));
}

export default function delegationGuard(pi: ExtensionAPI) {
  let latestUserInput = "";

  pi.on("input", async (event) => {
    if (event.source !== "extension") latestUserInput = event.text;
    return { action: "continue" as const };
  });

  pi.on("tool_call", async (event) => {
    if (!DELEGATED_TOOLS.has(event.toolName)) return undefined;

    const toolInput = stringifyInput(event.input);
    const combined = `${latestUserInput}\n${toolInput}`;

    if (BAD_EXPLORATION_PATTERNS.some((pattern) => pattern.test(toolInput)) && !permittedByText(latestUserInput)) {
      return {
        block: true,
        reason:
          "Delegated agents are disabled for ordinary exploration/repo inspection. Inspect code directly in the main context unless the user explicitly asks to delegate.",
      };
    }

    if (!permittedByText(combined)) {
      return {
        block: true,
        reason:
          "Delegated agents require explicit user delegation intent or an objective artifact-producing task (E2E/browser, consensus, independent verification, long-running tests). Do the work directly in the main context.",
      };
    }

    return undefined;
  });
}
