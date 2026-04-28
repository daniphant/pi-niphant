import os from "node:os";
import path from "node:path";
import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DATA_DIR_NAME } from "./constants.js";

export const getExtensionDir = (home = os.homedir()) => path.join(home, ".pi", "agent", "extensions", DATA_DIR_NAME);

export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const stat = await lstat(dir);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to use symlinked directory: ${dir}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("symlinked")) throw error;
    throw error;
  }
}

export async function assertNotSymlink(file: string): Promise<void> {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to write symlink: ${file}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  await ensurePrivateDir(path.dirname(file));
  await assertNotSymlink(file);
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(tmp, file);
}
