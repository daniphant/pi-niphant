import type { ProviderKey } from "../types.js";

export const detectQuotaProvider = (model: {
  provider?: string;
  id?: string;
  name?: string;
} | null | undefined): ProviderKey | null => {
  if (!model) return null;
  const provider = (model.provider || "").toLowerCase();
  const id = (model.id || "").toLowerCase();
  const name = (model.name || "").toLowerCase();
  const haystack = `${provider} ${id} ${name}`;

  if (haystack.includes("codex")) return "codex";
  if (provider === "zai" || haystack.includes("glm") || haystack.includes("z.ai") || haystack.includes("bigmodel")) {
    return "zai";
  }

  return null;
};
