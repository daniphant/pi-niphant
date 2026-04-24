import { describe, expect, it } from "vitest";

import { buildBar, formatGitBranch, renderContextBlock, renderHudField, renderQuotaBlock, renderQuotaResetBlock } from "../extensions/pi-hud/render.js";
import type { ThemeLike } from "../extensions/pi-hud/types.js";

const theme: ThemeLike = {
  fg: (_color, text) => text,
};

const taggingTheme: ThemeLike = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
};

describe("renderQuotaBlock", () => {
  it("renders codex usage", () => {
    const rendered = renderQuotaBlock(theme, {
      kind: "codex",
      plan: null,
      sessionUsedPercent: 12,
      sessionResetAt: Date.now() + 60_000,
      weeklyUsedPercent: 40,
      weeklyResetAt: Date.now() + 120_000,
    }, true, null, "codex", 12);

    expect(rendered).toContain("USAGE");
    expect(rendered).toContain("12%");
    expect(rendered).toContain("40%");
  });

  it("renders unavailable state", () => {
    expect(renderQuotaBlock(theme, null, false, "boom", "zai", 12)).toBe("USAGE unavailable");
  });

  it("renders reset as a separate compact HUD segment", () => {
    const rendered = renderQuotaResetBlock(theme, {
      kind: "codex",
      plan: null,
      sessionUsedPercent: 12,
      sessionResetAt: Date.now() + 60_000,
      weeklyUsedPercent: null,
      weeklyResetAt: null,
    }, "codex");

    expect(rendered).toContain("RESET");
    expect(rendered).toContain("m");
  });
});

describe("renderHudField", () => {
  it("renders screenshot-style uppercase labels", () => {
    expect(renderHudField(theme, "Model", "gpt-5.5")).toBe("MODEL gpt-5.5");
  });
});

describe("renderContextBlock", () => {
  it("renders a compact updating state instead of an empty --% meter when context usage is unknown", () => {
    expect(renderContextBlock(taggingTheme, null, 6, 120)).toBe("<accent>CONTEXT</accent> <muted>updating…</muted>");
  });

  it("renders the normal context meter when usage is known", () => {
    expect(renderContextBlock(taggingTheme, 50, 4, 120)).toBe("<accent>CONTEXT</accent> <success>██░░</success> <success>50%</success>");
  });
});

describe("buildBar", () => {
  // Regression for the post-compact "whole bar is red" bug: pi's getContextUsage returns
  // { percent: null } right after a compact, and the fallback color must be muted — not
  // the inverted-quota error red that would make an empty bar look like a full quota.
  it("uses a muted color when percent is unknown and no color was provided", () => {
    expect(buildBar(taggingTheme, null, 6)).toBe("<muted>░░░░░░</muted>");
  });

  it("honors an explicit color even when percent is null", () => {
    expect(buildBar(taggingTheme, null, 4, { color: "warning" })).toBe("<warning>░░░░</warning>");
  });

  it("applies the standard meter color for known percents", () => {
    expect(buildBar(taggingTheme, 10, 4)).toBe("<error>░░░░</error>");
    expect(buildBar(taggingTheme, 50, 4)).toBe("<success>██░░</success>");
  });
});

describe("formatGitBranch", () => {
  const cleanStatus = { branch: "main", isDirty: false, ahead: 0, behind: 0, fileStats: null };

  it("returns null when no status is provided", () => {
    expect(formatGitBranch(theme, null)).toBeNull();
    expect(formatGitBranch(theme, undefined)).toBeNull();
  });

  it("colors parens and branch distinctly like claude-hud's git segment", () => {
    expect(formatGitBranch(taggingTheme, cleanStatus)).toBe(
      "<customMessageLabel>git:(</customMessageLabel><accent>main</accent><customMessageLabel>)</customMessageLabel>",
    );
  });

  it("marks a dirty tree with a warning-colored star", () => {
    const rendered = formatGitBranch(taggingTheme, { ...cleanStatus, isDirty: true });
    expect(rendered).toContain("<warning>*</warning>");
  });

  it("colors ahead as success and behind as error", () => {
    const rendered = formatGitBranch(taggingTheme, { ...cleanStatus, ahead: 2, behind: 1 });
    expect(rendered).toContain("<success>↑2</success>");
    expect(rendered).toContain("<error>↓1</error>");
  });

  it("hides ahead/behind when the caller disables it", () => {
    const rendered = formatGitBranch(
      taggingTheme,
      { ...cleanStatus, ahead: 3, behind: 4 },
      { showAheadBehind: false },
    );
    expect(rendered).not.toContain("↑");
    expect(rendered).not.toContain("↓");
  });

  it("renders each file-stat indicator in its own color", () => {
    const rendered = formatGitBranch(taggingTheme, {
      ...cleanStatus,
      isDirty: true,
      fileStats: { modified: 2, added: 1, deleted: 3, untracked: 4 },
    });
    expect(rendered).toContain("<warning>!2</warning>");
    expect(rendered).toContain("<success>+1</success>");
    expect(rendered).toContain("<error>✘3</error>");
    expect(rendered).toContain("<muted>?4</muted>");
  });

  it("omits file stats when disabled (used in compact renders)", () => {
    const rendered = formatGitBranch(
      taggingTheme,
      {
        ...cleanStatus,
        isDirty: true,
        fileStats: { modified: 2, added: 0, deleted: 0, untracked: 0 },
      },
      { showFileStats: false },
    );
    expect(rendered).not.toContain("!2");
  });
});
