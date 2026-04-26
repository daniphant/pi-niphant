#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { compilePattern, loadSkillText, walk } from "./lib.mjs";

const suiteArgIndex = process.argv.indexOf("--suite");
const suiteFilter = suiteArgIndex >= 0 ? process.argv[suiteArgIndex + 1] : "all";

function suiteFiles() {
  const base = join(process.cwd(), "eval", "suites");
  return walk(base, (path) => path.endsWith(".json"))
    .filter((path) => suiteFilter === "all" || path.includes(`${suiteFilter}/`) || basename(path, ".json") === suiteFilter);
}

function readCaseFile(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(data) ? data : data.cases ?? [];
}

function evaluatePatternGroup(text, patterns = []) {
  const results = [];
  for (const pattern of patterns) {
    const re = compilePattern(pattern);
    const ok = re.test(text);
    results.push({ pattern: typeof pattern === "string" ? pattern : pattern.regex, ok });
  }
  return results;
}

const cases = suiteFiles().flatMap((file) =>
  readCaseFile(file).map((testCase) => ({ ...testCase, suiteFile: relative(process.cwd(), file) })),
);

const results = [];
for (const testCase of cases) {
  const files = testCase.files ?? (testCase.file ? [testCase.file] : []);
  const missing = files.filter((file) => !existsSync(join(process.cwd(), file)));
  const text = files.map(loadSkillText).join("\n\n--- FILE BREAK ---\n\n");
  const required = evaluatePatternGroup(text, testCase.required ?? []);
  const forbidden = evaluatePatternGroup(text, testCase.forbidden ?? []).map((r) => ({ ...r, ok: !r.ok }));
  const checks = [...required, ...forbidden];
  if (missing.length) checks.push(...missing.map((file) => ({ pattern: `file exists: ${file}`, ok: false })));
  const passed = checks.filter((check) => check.ok).length;
  const total = checks.length || 1;
  const score = passed / total;
  results.push({
    id: testCase.id,
    suite: testCase.suite ?? testCase.suiteFile.split("/").at(-2),
    files,
    score,
    passed,
    total,
    failed: checks.filter((check) => !check.ok),
  });
}

const bySuite = {};
for (const result of results) {
  bySuite[result.suite] ??= { score: 0, passed: 0, total: 0, cases: 0 };
  bySuite[result.suite].score += result.score;
  bySuite[result.suite].passed += result.passed;
  bySuite[result.suite].total += result.total;
  bySuite[result.suite].cases += 1;
}
for (const suite of Object.values(bySuite)) {
  suite.accuracy = suite.total ? suite.passed / suite.total : 0;
  suite.caseScore = suite.cases ? suite.score / suite.cases : 0;
}

const failedCases = results.filter((result) => result.score < 1);
const metrics = {
  behavior_score: results.length ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0,
  routing_accuracy: bySuite.routing?.accuracy ?? 0,
  policy_consistency_score: bySuite["policy-consistency"]?.accuracy ?? 0,
  workflow_gate_accuracy: bySuite.workflow?.accuracy ?? 0,
  debugging_score: bySuite.debugging?.accuracy ?? 0,
  github_explorer_score: bySuite["github-explorer"]?.accuracy ?? 0,
  e2e_skill_score: bySuite["e2e-web-agent"]?.accuracy ?? 0,
  delegation_precision: bySuite.delegation?.accuracy ?? 0,
  workflow_gate_failures: bySuite.workflow ? bySuite.workflow.total - bySuite.workflow.passed : 0,
  guessing_violations: failedCases.filter((c) => c.suite === "debugging").length,
  unsupported_delegations: failedCases.filter((c) => c.suite === "delegation" || c.suite === "policy-consistency").length,
};

console.log(JSON.stringify({ suiteFilter, caseCount: results.length, bySuite, failedCases, results, metrics }, null, 2));
