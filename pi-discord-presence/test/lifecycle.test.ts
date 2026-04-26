import { describe, expect, it } from "vitest";
import { EXTENSION_SHUTDOWN_TIMEOUT_MS } from "../extensions/pi-discord-presence/constants.js";
import { registerLifecycleHandlers } from "../extensions/pi-discord-presence/lifecycle.js";

describe("lifecycle handlers", () => {
  it("does not let session shutdown hang indefinitely", async () => {
    const handlers = new Map<string, (event?: unknown, ctx?: unknown) => void | Promise<void>>();
    const pi = { on: (event: string, handler: (event?: unknown, ctx?: unknown) => void | Promise<void>) => { handlers.set(event, handler); } };
    const controller = {
      init: async () => {},
      shutdown: () => new Promise<void>(() => {}),
      touch: () => {},
    };

    registerLifecycleHandlers(pi, controller as never);
    const shutdown = handlers.get("session_shutdown");
    expect(shutdown).toBeDefined();

    const startedAt = Date.now();
    await shutdown?.();
    expect(Date.now() - startedAt).toBeLessThan(EXTENSION_SHUTDOWN_TIMEOUT_MS + 500);
  });
});
