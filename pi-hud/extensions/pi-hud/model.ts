import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { formatContextWindow } from "./format.js";

export const getModelLabel = (pi: ExtensionAPI, ctx: ExtensionContext) => {
  if (!ctx.model) return "no model";
  const modelName = (ctx.model.name || ctx.model.id || "model").trim();
  const thinking = pi.getThinkingLevel();
  const thinkingPart = thinking && thinking !== "off" ? ` ${thinking}` : "";
  return `${modelName}${thinkingPart} (${formatContextWindow(ctx.model.contextWindow)})`;
};
