import { describe, expect, it } from "vitest";

import { parseFileStats } from "../extensions/pi-hud/git.js";

describe("parseFileStats", () => {
  it("returns zero counts for empty output", () => {
    expect(parseFileStats("")).toEqual({ modified: 0, added: 0, deleted: 0, untracked: 0 });
  });

  it("counts modified, added, deleted, and untracked entries", () => {
    const porcelain = [
      " M src/foo.ts",
      "M  src/bar.ts",
      "A  src/baz.ts",
      " D src/old.ts",
      "?? notes.txt",
      "?? scratch/ignored.log",
    ].join("\n");

    expect(parseFileStats(porcelain)).toEqual({ modified: 2, added: 1, deleted: 1, untracked: 2 });
  });

  it("treats renames and copies as modified", () => {
    const porcelain = ["R  src/a.ts -> src/b.ts", "C  src/c.ts -> src/d.ts"].join("\n");
    expect(parseFileStats(porcelain)).toEqual({ modified: 2, added: 0, deleted: 0, untracked: 0 });
  });

  it("ignores malformed lines shorter than two characters", () => {
    expect(parseFileStats("\n?\nM\n")).toEqual({ modified: 0, added: 0, deleted: 0, untracked: 0 });
  });
});
