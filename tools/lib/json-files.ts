// JSON documents on disk, shared by the PC server and the sync (one way to write into the data repo).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Parsed file, or null when it does not exist. */
export async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Atomic write of `<dir>/<id>.json`: temp file next to the target, then rename. */
export async function writeJson(dir: string, id: string, body: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${id}.${randomUUID()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`);
  await rename(tmp, join(dir, `${id}.json`));
}
