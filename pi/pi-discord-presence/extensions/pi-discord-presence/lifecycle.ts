import { EXTENSION_SHUTDOWN_TIMEOUT_MS } from "./constants.js";
import type { DiscordPresenceController } from "./controller.js";

type ExtensionApiLike = { on?: (event: string, handler: (event: unknown, ctx: unknown) => void | Promise<void>) => void };

async function settleWithin(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerLifecycleHandlers(pi: ExtensionApiLike, controller: DiscordPresenceController): void {
  pi.on?.("session_start", async (_event, ctx) => { await controller.init(ctx as never); });
  pi.on?.("session_shutdown", async () => { await settleWithin(controller.shutdown(), EXTENSION_SHUTDOWN_TIMEOUT_MS); });
  pi.on?.("agent_start", (_event, ctx) => { controller.touch(ctx as never, "Agent working"); });
  pi.on?.("turn_start", (_event, ctx) => { controller.touch(ctx as never, "Agent working"); });
  pi.on?.("agent_end", (_event, ctx) => { controller.touch(ctx as never, "Waiting for input"); });
  pi.on?.("turn_end", (_event, ctx) => { controller.touch(ctx as never, "Waiting for input"); });
  pi.on?.("message_end", (_event, ctx) => { controller.touch(ctx as never, "Waiting for input"); });
  pi.on?.("model_select", (_event, ctx) => { controller.touch(ctx as never, "Waiting for input"); });

  process.once("beforeExit", () => { void controller.shutdown(); });
}
