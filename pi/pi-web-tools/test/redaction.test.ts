import { describe, expect, it } from "vitest";
import { formatError, redactSecrets } from "../src/output.js";

describe("redaction", () => {
  it("redacts brave-like and long tokens", () => expect(redactSecrets("BSAabcdefghijklmnopqrstuvwxyz123456 api_key=secretsecretsecretsecretsecretsecret")).not.toContain("abcdefghijklmnopqrstuvwxyz"));
  it("redacts env key in errors", () => { process.env.BRAVE_SEARCH_API_KEY = "BSA_REALISTIC_SECRET_TOKEN_123456789"; expect(formatError("x", new Error(process.env.BRAVE_SEARCH_API_KEY))).not.toContain(process.env.BRAVE_SEARCH_API_KEY); });
});
