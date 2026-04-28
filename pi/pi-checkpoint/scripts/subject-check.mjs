#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transform } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const source = await readFile(join(root, "index.ts"), "utf8");
const compiled = await transform(source, {
  loader: "ts",
  format: "esm",
  platform: "node",
  target: "node20",
});

const tempDir = await mkdtemp(join(tmpdir(), "pi-checkpoint-subject-check-"));
const modulePath = join(tempDir, "index.mjs");
await writeFile(modulePath, compiled.code, "utf8");

try {
  const { buildCommitSubject } = await import(`file://${modulePath}`);

  const messages = (prompt, assistant) => [
    { role: "user", content: prompt },
    { role: "assistant", content: assistant },
  ];

  const stageContextSubject = buildCommitSubject(
    "M\tpi-workflow/index.ts\nM\tpi-workflow/scripts/smoke-check.mjs",
    messages(
      "fix the workflow generated prompts",
      "Added stageContextGuard(...) to generated workflow prompts and updated smoke checks."
    )
  );
  assert.equal(stageContextSubject, "fix(pi-workflow): add stage context guard");
  assert(!stageContextSubject.includes("stagecontextguard("));

  const functionCallSubject = buildCommitSubject(
    "M\tpi-checkpoint/index.ts",
    messages("update checkpoint helper", "Updated fooBar() to sanitize subject phrases.")
  );
  assert(functionCallSubject.startsWith("chore(pi-checkpoint): update foo bar"));
  assert(!/[()]/.test(functionCallSubject.split(": ")[1]));

  const hudSubject = buildCommitSubject(
    "M\tpi-hud/index.ts",
    messages("add session timer to pi-hud stopwatch", "Done.")
  );
  assert.equal(hudSubject, "feat(pi-hud): add session timer to hud");

  const commitMessageSubject = buildCommitSubject(
    "M\tpi-checkpoint/index.ts",
    messages("fix checkpoint commit message title format", "Done.")
  );
  assert.equal(commitMessageSubject, "fix(pi-checkpoint): improve auto-commit messages");

  const absolutePathSubject = buildCommitSubject(
    "M\tpi-delegated-agents/skills/spawn-agent/SKILL.md",
    messages(
      "make spawn-agent harder to invoke",
      "Updated `/Users/daniphant/.pi/agent/skills/spawn-agent/SKILL.md` to make invocation spawn-only."
    )
  );
  assert.equal(absolutePathSubject, "docs(pi-delegated-agents): update documentation");
  assert(!absolutePathSubject.toLowerCase().includes("/users/"));
  assert(!absolutePathSubject.toLowerCase().includes("daniphant"));

  console.log("pi-checkpoint subject checks passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
