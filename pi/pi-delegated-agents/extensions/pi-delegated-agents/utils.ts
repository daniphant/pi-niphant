import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const require = createRequire(import.meta.url);

export function safeReadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJsonAtomic(filePath: string, payload: object): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }
}

export function truncate(text: string, max = 90): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

export function formatDuration(startedAt?: number, endedAt?: number): string {
  if (!startedAt) return "";
  const ms = (endedAt ?? Date.now()) - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

export function readTail(filePath: string, bytes = 4000): string[] {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(filePath, "r");
    try {
      const size = stat.size - start;
      const buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, start);
      return buffer
        .toString("utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-6);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

export function shortenPath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

export function getJitiCliPath(): string | undefined {
  const candidates: Array<() => string> = [
    () => path.join(path.dirname(require.resolve("jiti/package.json")), "lib", "jiti-cli.mjs"),
    () => path.join(path.dirname(require.resolve("@mariozechner/jiti/package.json")), "lib", "jiti-cli.mjs"),
    () => {
      const entry = process.argv[1];
      if (!entry) throw new Error("Missing process.argv[1]");
      const piRequire = createRequire(fs.realpathSync(entry));
      return path.join(path.dirname(piRequire.resolve("@mariozechner/jiti/package.json")), "lib", "jiti-cli.mjs");
    },
    () => {
      const entry = process.argv[1];
      if (!entry) throw new Error("Missing process.argv[1]");
      const piRequire = createRequire(fs.realpathSync(entry));
      return path.join(path.dirname(piRequire.resolve("jiti/package.json")), "lib", "jiti-cli.mjs");
    },
  ];

  for (const candidate of candidates) {
    try {
      const resolved = candidate();
      if (fs.existsSync(resolved)) return resolved;
    } catch {}
  }
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return null;
}
