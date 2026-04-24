import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

for (const dir of readdirSync(".").filter((name) => name.startsWith("pi-")).sort()) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const exts = pkg.pi?.extensions?.length ? ` extensions=${pkg.pi.extensions.join(",")}` : "";
  const skills = pkg.pi?.skills?.length ? ` skills=${pkg.pi.skills.join(",")}` : "";
  console.log(`${dir}\n  ${pkg.description ?? ""}${exts}${skills}\n`);
}
