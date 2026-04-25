#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

function assertIncludes(file, needle, label = needle) {
  const text = read(file);
  if (!text.includes(needle)) failures.push(`${file}: missing ${label}`);
}

function assertMatches(file, pattern, label = String(pattern)) {
  const text = read(file);
  if (!pattern.test(text)) failures.push(`${file}: missing ${label}`);
}

// Command routing smoke checks.
assertIncludes("index.ts", 'pi.registerCommand("workflow"', "workflow command registration");
assertIncludes("index.ts", "sendSlugSelection", "unnamed /workflow slug-selection routing");
assertIncludes("index.ts", "pendingSlugSelectionByCwd", "recursion guard state");
assertIncludes("index.ts", "/workflow --name <slug> --", "explicit generated follow-up");
assertIncludes("index.ts", 'pi.registerCommand("workflow-execute"', "workflow-execute command registration");
assertIncludes("index.ts", 'pi.registerCommand("workflow-implement"', "workflow-implement alias registration");
assertIncludes("index.ts", "Deprecated alias for /workflow-execute", "deprecated implement description");
assertMatches("index.ts", /\^\[a-z0-9\]\(\?:\[a-z0-9-\]\{0,30\}\[a-z0-9\]\)\?\$/, "strict slug validation regex");
assertIncludes("index.ts", "Refusing repeated unnamed /workflow", "repeated unnamed refusal");
assertIncludes("index.ts", "Browser review: skipped_for_trivial", "trivial execution marker checks");

// Route schema checks.
for (const file of ["templates/workflow.research.md", "skills/workflow-brainstorm/SKILL.md"]) {
  assertIncludes(file, "## Complexity / Route Recommendation");
  for (const label of [
    "- Complexity:",
    "- Recommended route:",
    "- Spec:",
    "- Plan:",
    "- Consensus:",
    "- Browser review:",
    "- Execution source:",
    "- Trivial execution approved:",
    "- Workflow task tracking:",
    "- Next command after /clear:",
  ]) assertIncludes(file, label);
}
assertIncludes("skills/workflow-brainstorm/SKILL.md", "Refuse to run if the prompt does not include concrete workflow file paths", "bundle-less brainstorm refusal");
assertIncludes("skills/workflow-brainstorm/SKILL.md", "Do not implement code", "brainstorm no implementation");

// Stage policy checks.
assertIncludes("skills/workflow-spec/SKILL.md", "Do not automatically run PAL consensus", "spec prompted consensus");
assertIncludes("skills/workflow-spec/SKILL.md", "Browser annotation/user review is required", "spec mandatory browser review");
assertIncludes("skills/workflow-spec/SKILL.md", "Refuse", "spec route refusal");
assertIncludes("skills/workflow-spec/SKILL.md", "Do not use `workflow.toml` for spec status/gates", "spec no TOML gate state");
assertIncludes("skills/workflow-plan/SKILL.md", "Planning may proceed from either", "plan spec-or-research support");
assertIncludes("skills/workflow-plan/SKILL.md", "If research is insufficient", "plan research sufficiency refusal");
assertIncludes("skills/workflow-plan/SKILL.md", "Do not automatically run PAL consensus", "plan prompted consensus");
assertIncludes("skills/workflow-plan/SKILL.md", "Browser annotation/user review is required", "plan mandatory browser review");
assertIncludes("skills/workflow-plan/SKILL.md", "execution/task state only", "plan TOML task-state-only");
assertIncludes("skills/workflow-implement/SKILL.md", "Do not rely on `workflow.spec.md`", "execute no spec dependency");
assertIncludes("skills/workflow-implement/SKILL.md", "If any marker is absent or incompatible", "execute missing-marker refusal");
assertIncludes("skills/workflow-implement/SKILL.md", "workflow.plan.md` as the authoritative", "execute plan authority");

if (failures.length) {
  console.error("pi-workflow smoke check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("pi-workflow smoke check passed");
