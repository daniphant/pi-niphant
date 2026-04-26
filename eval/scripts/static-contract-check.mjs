#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { discoverSkills, parseSkillFrontmatter } from "./lib.mjs";

const args = new Set(process.argv.slice(2));
const frontmatterOnly = args.has("--frontmatter-only");
const maxWordsArg = process.argv.find((arg) => arg.startsWith("--max-skill-words="));
const maxWords = maxWordsArg ? Number(maxWordsArg.split("=")[1]) : 1800;

const skills = discoverSkills();
const violations = [];
let totalWords = 0;
let portabilityIssues = 0;
let skillBloat = 0;

for (const skill of skills) {
  if (!skill.exists) {
    violations.push({ type: "missing_skill_file", file: skill.file });
    continue;
  }
  const text = readFileSync(skill.file, "utf8");
  const fm = parseSkillFrontmatter(text);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  totalWords += words;
  if (!fm.ok) violations.push({ type: "invalid_frontmatter", file: skill.file });
  if (!fm.data.name) violations.push({ type: "missing_frontmatter_name", file: skill.file });
  if (!fm.data.description) violations.push({ type: "missing_frontmatter_description", file: skill.file });
  if (words > maxWords) {
    skillBloat += 1;
    violations.push({ type: "skill_word_limit", file: skill.file, words, maxWords });
  }
  if (frontmatterOnly) continue;

  const hardCodedUserPaths = text.match(/\/Users\/[A-Za-z0-9._-]+\//g) ?? [];
  if (hardCodedUserPaths.length) {
    portabilityIssues += hardCodedUserPaths.length;
    violations.push({ type: "user_local_absolute_path", file: skill.file, count: hardCodedUserPaths.length });
  }

  if (/claim (success|done|fixed)|say (success|done|fixed)/i.test(text) && !/verify|verification|evidence|test output|diagnostic/i.test(text)) {
    violations.push({ type: "completion_claim_without_verification_contract", file: skill.file });
  }

  if (/workflow-(brainstorm|spec|plan)\/SKILL\.md$/.test(skill.file)) {
    const implementationAllowPattern = /(?:^|\n)\s*[-*]?\s*(?:you may|may|can|should|must|go ahead and)\s+(?:implement code|make code changes|edit implementation)/i;
    if (implementationAllowPattern.test(text)) {
      violations.push({ type: "workflow_stage_may_allow_implementation", file: skill.file });
    }
  }
}

const frontmatterViolations = violations.filter((v) => v.type.includes("frontmatter") || v.type === "missing_skill_file").length;
const result = {
  ok: violations.length === 0,
  skillCount: skills.length,
  totalWords,
  averageWords: skills.length ? totalWords / skills.length : 0,
  maxWords,
  portabilityIssues,
  skillBloat,
  frontmatterViolations,
  violations,
  metrics: {
    static_contract_score: skills.length ? Math.max(0, 1 - violations.length / (skills.length * 4)) : 0,
    portability_score: skills.length ? Math.max(0, 1 - portabilityIssues / skills.length) : 0,
    token_words: totalWords,
    policy_violations: violations.length,
    portability_issues: portabilityIssues,
    skill_bloat: skillBloat,
  },
};

console.log(JSON.stringify(result, null, 2));
if (frontmatterOnly && frontmatterViolations > 0) process.exit(1);
if (args.has("--fail-on-violations") && violations.length > 0) process.exit(1);
