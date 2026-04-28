import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { SessionTotals } from "./types.js";

export const getSessionTotals = (ctx: ExtensionContext): SessionTotals => {
  const totals: SessionTotals = { input: 0, output: 0, cost: 0 };

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const message = entry.message as AssistantMessage;
    totals.input += message.usage?.input ?? 0;
    totals.output += message.usage?.output ?? 0;
    totals.cost += message.usage?.cost?.total ?? 0;
  }

  return totals;
};
