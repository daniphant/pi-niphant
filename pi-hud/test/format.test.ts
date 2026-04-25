import { describe, expect, it } from "vitest";

import { clampPercent, formatCompactNumber, formatContextWindow, formatResetCountdown, formatSessionDuration, getAdaptiveLabel, getAdaptiveMeterWidth, getAdaptiveProjectLabel, getProjectLabel, normalizeResetAt, normalizeZaiLimitLabel } from "../extensions/pi-hud/format.js";

describe("format helpers", () => {
  it("clamps percentages", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(120)).toBe(100);
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(null)).toBeNull();
  });

  it("formats compact numbers", () => {
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(1_234)).toBe("1.2k");
    expect(formatCompactNumber(1_250_000)).toBe("1.3M");
  });

  it("formats context windows", () => {
    expect(formatContextWindow(400_000)).toBe("400k");
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(1_500_000)).toBe("1.5M");
  });

  it("formats reset countdowns", () => {
    const now = 1_000_000;
    expect(formatResetCountdown(now + 20 * 60_000, now)).toBe("20m");
    expect(formatResetCountdown(now + 2 * 60 * 60_000 + 10 * 60_000, now)).toBe("2h 10m");
    expect(formatResetCountdown(now + 2 * 24 * 60 * 60_000 + 3 * 60 * 60_000, now)).toBe("2d 3h");
    expect(formatResetCountdown(now - 1, now)).toBe("now");
  });

  it("formats TUI session durations like claude-hud", () => {
    expect(formatSessionDuration(0)).toBe("< 1m");
    expect(formatSessionDuration(59_999)).toBe("< 1m");
    expect(formatSessionDuration(7 * 60_000 + 30_000)).toBe("7m");
    expect(formatSessionDuration(65 * 60_000)).toBe("1h 5m");
    expect(formatSessionDuration((2 * 24 + 3) * 60 * 60_000 + 59 * 60_000)).toBe("2d 3h");
  });

  it("formats project paths relative to home", () => {
    expect(getProjectLabel("/Users/daniphant/projects/pi-hud", "/Users/daniphant")).toBe("~/projects/pi-hud");
    expect(getProjectLabel("/tmp/demo", "/Users/daniphant")).toBe("/tmp/demo");
  });

  it("scales meter width to terminal width", () => {
    expect(getAdaptiveMeterWidth(160)).toBe(12);
    expect(getAdaptiveMeterWidth(120)).toBe(10);
    expect(getAdaptiveMeterWidth(100)).toBe(8);
    expect(getAdaptiveMeterWidth(80)).toBe(6);
    expect(getAdaptiveMeterWidth(60)).toBe(4);
    expect(getAdaptiveMeterWidth(40)).toBe(3);
  });

  it("abbreviates labels on narrow terminals", () => {
    expect(getAdaptiveLabel("Context", "Ctx", 120)).toBe("Context");
    expect(getAdaptiveLabel("Context", "Ctx", 85)).toBe("Context");
    expect(getAdaptiveLabel("Context", "Ctx", 80)).toBe("Ctx");
    expect(getAdaptiveLabel("Usage", "Use", 40)).toBe("Use");
  });

  it("collapses the project path on narrow terminals", () => {
    const cwd = "/Users/daniphant/Projects/pi-extensions";
    const home = "/Users/daniphant";
    expect(getAdaptiveProjectLabel(cwd, 120, home)).toBe("~/Projects/pi-extensions");
    expect(getAdaptiveProjectLabel(cwd, 100, home)).toBe("~/Projects/pi-extensions");
    expect(getAdaptiveProjectLabel(cwd, 80, home)).toBe("Projects/pi-extensions");
    expect(getAdaptiveProjectLabel(cwd, 40, home)).toBe("pi-extensions");
  });

  it("leaves the home marker alone when cwd equals home", () => {
    expect(getAdaptiveProjectLabel("/Users/daniphant", 40, "/Users/daniphant")).toBe("~");
  });

  it("handles absolute paths outside of home", () => {
    expect(getAdaptiveProjectLabel("/tmp/some/demo", 80, "/Users/daniphant")).toBe("some/demo");
    expect(getAdaptiveProjectLabel("/tmp/some/demo", 40, "/Users/daniphant")).toBe("demo");
  });

  it("formats canonical z.ai window labels", () => {
    expect(normalizeZaiLimitLabel(60, "quota")).toBe("1h");
    expect(normalizeZaiLimitLabel(300, "quota")).toBe("5h");
    expect(normalizeZaiLimitLabel(7 * 24 * 60, "quota")).toBe("7d");
  });

  it("normalizes reset timestamps", () => {
    expect(normalizeResetAt(1776053603881)).toBe(1776053603881);
    expect(normalizeResetAt(1776053603)).toBe(1776053603000);
    expect(normalizeResetAt(undefined)).toBeNull();
  });
});
