import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getEnvValue, parseEnvValue } from "../src/env.js";

describe("env loading", () => {
  afterEach(() => { delete process.env.BRAVE_SEARCH_API_KEY; delete process.env.PI_WEB_TOOLS_DISABLE_ENV_FILE; });

  it("parses quoted .env values", () => {
    expect(parseEnvValue("# comment\nBRAVE_SEARCH_API_KEY='BSA_SECRET_TOKEN_123456789012345'\n", "BRAVE_SEARCH_API_KEY")).toBe("BSA_SECRET_TOKEN_123456789012345");
  });

  it("resolves process env before env files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-tools-env-"));
    const envFile = path.join(dir, ".env");
    await writeFile(envFile, "BRAVE_SEARCH_API_KEY=BSA_FILE_TOKEN_123456789012345\n", "utf8");
    expect(getEnvValue("BRAVE_SEARCH_API_KEY", { BRAVE_SEARCH_API_KEY: "BSA_PROCESS_TOKEN_123456789012345" } as NodeJS.ProcessEnv, [envFile])).toBe("BSA_PROCESS_TOKEN_123456789012345");
    expect(getEnvValue("BRAVE_SEARCH_API_KEY", {} as NodeJS.ProcessEnv, [envFile])).toBe("BSA_FILE_TOKEN_123456789012345");
  });
});
