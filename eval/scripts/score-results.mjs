#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { asMetricLine } from "./lib.mjs";

function readResult(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { error: String(error), metrics: {} };
  }
}

const [staticPath = ".eval-results/static.json", behaviorPath = ".eval-results/behavior.json"] = process.argv.slice(2);
const staticResult = readResult(staticPath);
const behaviorResult = readResult(behaviorPath);
const s = staticResult.metrics ?? {};
const b = behaviorResult.metrics ?? {};

const routing = b.routing_accuracy ?? 0;
const policy = b.policy_consistency_score ?? 0;
const workflow = b.workflow_gate_accuracy ?? 0;
const verification = Math.max(b.debugging_score ?? 0, 0);
const portability = s.portability_score ?? 0;
const tokenWords = s.token_words ?? 0;
const normalizedBloatPenalty = Math.min(1, Math.max(0, (tokenWords - 12000) / 24000));

const niphantSkillScore =
  0.30 * routing +
  0.25 * policy +
  0.20 * workflow +
  0.15 * verification +
  0.10 * portability -
  0.05 * normalizedBloatPenalty;

const metrics = {
  niphant_skill_score: Math.max(0, Number(niphantSkillScore.toFixed(6))),
  routing_accuracy: routing,
  policy_consistency_score: policy,
  workflow_gate_accuracy: workflow,
  debugging_score: b.debugging_score ?? 0,
  github_explorer_score: b.github_explorer_score ?? 0,
  e2e_skill_score: b.e2e_skill_score ?? 0,
  delegation_precision: b.delegation_precision ?? 0,
  policy_violations: s.policy_violations ?? 0,
  workflow_gate_failures: b.workflow_gate_failures ?? 0,
  unsupported_delegations: b.unsupported_delegations ?? 0,
  portability_issues: s.portability_issues ?? 0,
  token_words: tokenWords,
};

for (const [name, value] of Object.entries(metrics)) {
  console.log(asMetricLine(name, value));
}

console.log(JSON.stringify({ metrics, staticSummary: staticResult.metrics, behaviorSummary: behaviorResult.metrics }, null, 2));
