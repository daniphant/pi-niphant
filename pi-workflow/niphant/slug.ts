import { MAX_PROJECT_SLUG, MAX_TASK_SLUG } from "./constants.js";

const RESERVED = new Set([".", "..", "", "con", "prn", "aux", "nul"]);

export function slugify(input: string, max = MAX_TASK_SLUG, fallback = "task"): string {
  let slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, max)
    .replace(/^[._-]+|[._-]+$/g, "");
  if (RESERVED.has(slug)) slug = fallback;
  return slug || fallback;
}

export function projectSlugFromPath(path: string, origin?: string): string {
  const base = origin?.trim() || path;
  return slugify(base.replace(/^https?:\/\//, "").replace(/\.git$/, ""), MAX_PROJECT_SLUG, "project");
}

export function uniqueName(base: string, exists: (candidate: string) => boolean, max = MAX_TASK_SLUG): string {
  let candidate = slugify(base, max);
  if (!exists(candidate)) return candidate;
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    candidate = `${slugify(base, Math.max(1, max - suffix.length))}${suffix}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not find unique name for ${base}`);
}
