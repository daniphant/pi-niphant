import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const groups = [
  { label: "Pi packages", root: "pi", prefix: "pi-" },
  { label: "Droid plugins", root: "droid", prefix: "droid-" },
];

for (const group of groups) {
  if (!existsSync(group.root)) continue;
  console.log(`${group.label}\n${"=".repeat(group.label.length)}`);

  for (const dir of readdirSync(group.root).filter((name) => name.startsWith(group.prefix)).sort()) {
    const packagePath = join(group.root, dir, "package.json");
    const manifestPath = join(group.root, dir, ".factory-plugin", "plugin.json");
    const metadataPath = existsSync(packagePath) ? packagePath : manifestPath;
    if (!existsSync(metadataPath)) continue;

    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const exts = metadata.pi?.extensions?.length ? ` extensions=${metadata.pi.extensions.join(",")}` : "";
    const skills = metadata.pi?.skills?.length ? ` skills=${metadata.pi.skills.join(",")}` : "";
    console.log(`${group.root}/${dir}\n  ${metadata.description ?? ""}${exts}${skills}\n`);
  }
}
