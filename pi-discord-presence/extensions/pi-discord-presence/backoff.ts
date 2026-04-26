import { RECONNECT_DELAYS_MS } from "./constants.js";

export class ReconnectBackoff {
  private attempt = 0;

  nextDelay(): number {
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }

  getAttempt(): number {
    return this.attempt;
  }
}

export function shouldRunThrottled(now: number, lastRunAt: number, intervalMs: number): boolean {
  return lastRunAt <= 0 || now - lastRunAt >= intervalMs;
}

export function jitter(baseMs: number, ratio = 0.2, random = Math.random): number {
  const spread = baseMs * ratio;
  return Math.max(0, Math.round(baseMs - spread + random() * spread * 2));
}
