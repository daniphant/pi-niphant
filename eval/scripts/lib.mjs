import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = process.cwd();

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function walk(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path, predicate));
    else if (predicate(path)) out.push(path);
  }
  return out;
}

export function discoverPackages() {
  const piRoot = join(ROOT, "pi");
  return readdirSync(piRoot)
    .filter((name) => name.startsWith("pi-") && existsSync(join(piRoot, name, "package.json")))
    .sort()
    .map((name) => {
      const dir = join("pi", name);
      const packageJson = readJson(join(ROOT, dir, "package.json"));
      return { dir, packageJson };
    });
}

export function discoverSkills() {
  const skills = [];
  for (const { dir, packageJson } of discoverPackages()) {
    for (const skillRef of packageJson.pi?.skills ?? []) {
      const skillDir = join(ROOT, dir, skillRef);
      const skillFile = join(skillDir, "SKILL.md");
      if (existsSync(skillFile)) {
        skills.push({
          package: dir,
          ref: skillRef,
          dir: relative(ROOT, skillDir),
          file: relative(ROOT, skillFile),
          exists: true,
        });
        continue;
      }

      const childSkillFiles = existsSync(skillDir)
        ? readdirSync(skillDir)
            .sort()
            .map((name) => join(skillDir, name, "SKILL.md"))
            .filter((file) => existsSync(file))
        : [];

      if (childSkillFiles.length) {
        for (const childSkillFile of childSkillFiles) {
          skills.push({
            package: dir,
            ref: skillRef,
            dir: relative(ROOT, join(childSkillFile, "..")),
            file: relative(ROOT, childSkillFile),
            exists: true,
          });
        }
        continue;
      }

      skills.push({
        package: dir,
        ref: skillRef,
        dir: relative(ROOT, skillDir),
        file: relative(ROOT, skillFile),
        exists: false,
      });
    }
  }
  return skills;
}

export function parseSkillFrontmatter(text) {
  if (!text.startsWith("---\n")) return { ok: false, data: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { ok: false, data: {}, body: text };
  const raw = text.slice(4, end).trim();
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]] = match[2].replace(/^['\"]|['\"]$/g, "");
  }
  return { ok: true, data, body: text.slice(end + 5) };
}

export function loadSkillText(file) {
  const abs = join(ROOT, file);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}

export function compilePattern(pattern) {
  if (typeof pattern === "string") return new RegExp(pattern, "ims");
  return new RegExp(pattern.regex, pattern.flags ?? "ims");
}

export function asMetricLine(name, value) {
  const number = Number.isFinite(value) ? value : 0;
  return `METRIC ${name}=${number}`;
}
