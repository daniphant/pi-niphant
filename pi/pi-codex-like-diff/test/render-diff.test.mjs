import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

process.env.FORCE_COLOR = "1";
const require = createRequire(import.meta.url);
const piRoot = "/Users/daniphant/.local/share/mise/installs/node/24.14.0/lib/node_modules/@mariozechner/pi-coding-agent";
const linkPath = new URL("../node_modules/@mariozechner/pi-coding-agent", import.meta.url).pathname;
mkdirSync(dirname(linkPath), { recursive: true });
if (!existsSync(linkPath)) symlinkSync(piRoot, linkPath, "dir");
const { createJiti } = require(require.resolve("@mariozechner/jiti", { paths: [piRoot] }));
const jiti = createJiti(`${piRoot}/dist/index.js`, { interopDefault: true, moduleCache: false });
const { Theme } = await import(`${piRoot}/dist/index.js`);
const { renderCodexLikeDiff, parseDiffLine } = await jiti.import(new URL("../render-diff.ts", import.meta.url).pathname);

const fg = {
  accent: "#89b4fa", border: "#45475a", borderAccent: "#89b4fa", borderMuted: "#313244",
  success: "#a6e3a1", error: "#f38ba8", warning: "#f9e2af", muted: "#6c7086", dim: "#585b70", text: "#cdd6f4", thinkingText: "#bac2de",
  userMessageText: "#cdd6f4", customMessageText: "#cdd6f4", customMessageLabel: "#89b4fa", toolTitle: "#cba6f7", toolOutput: "#cdd6f4",
  mdHeading: "#f5c2e7", mdLink: "#89b4fa", mdLinkUrl: "#74c7ec", mdCode: "#a6e3a1", mdCodeBlock: "#cdd6f4", mdCodeBlockBorder: "#45475a", mdQuote: "#bac2de", mdQuoteBorder: "#585b70", mdHr: "#45475a", mdListBullet: "#f9e2af",
  toolDiffAdded: "#a6e3a1", toolDiffRemoved: "#f38ba8", toolDiffContext: "#9399b2",
  syntaxComment: "#6c7086", syntaxKeyword: "#cba6f7", syntaxFunction: "#89b4fa", syntaxVariable: "#cdd6f4", syntaxString: "#a6e3a1", syntaxNumber: "#fab387", syntaxType: "#f9e2af", syntaxOperator: "#89dceb", syntaxPunctuation: "#bac2de",
  thinkingOff: "#6c7086", thinkingMinimal: "#89b4fa", thinkingLow: "#a6e3a1", thinkingMedium: "#f9e2af", thinkingHigh: "#fab387", thinkingXhigh: "#f38ba8", bashMode: "#a6e3a1"
};
const bg = { selectedBg: "#313244", userMessageBg: "#1e1e2e", customMessageBg: "#1e1e2e", toolPendingBg: "#313244", toolSuccessBg: "#253244", toolErrorBg: "#3a2434" };
const theme = new Theme(fg, bg, "truecolor");

assert.deepEqual(parseDiffLine("+12 const x = 1;"), { prefix: "+", lineNum: "12", content: "const x = 1;", raw: "+12 const x = 1;" });

const diff = [
  " 1 function demo() {",
  "-2   const value = 1;",
  "+2   const value = 2;",
  " 3 }"
].join("\n");
const rendered = renderCodexLikeDiff(diff, theme, { filePath: "demo.ts" });
assert.match(rendered, /\x1b\[48;2;35;68;50m\+2/); // added bg
assert.match(rendered, /\x1b\[48;2;74;38;52m-2/); // removed bg
assert.match(rendered, /\x1b\[38;2;/); // syntax/context foregrounds
assert.match(rendered, /\x1b\[1m\x1b\[4m2\x1b\[24m\x1b\[22m/); // bold+underline changed token
assert.doesNotMatch(rendered, /\x1b\[7m/); // no inverse
const pureAdd = renderCodexLikeDiff("+3   return value;", theme, { filePath: "demo.ts" });
assert.match(pureAdd, /\+3\s+return value;/);

const unknown = renderCodexLikeDiff("+1 hello plain", theme, { filePath: "file.unknownext" });
assert.match(unknown, /\x1b\[48;2;35;68;50m\+1 hello plain\x1b\[49m/);

console.log("render-diff tests passed");
