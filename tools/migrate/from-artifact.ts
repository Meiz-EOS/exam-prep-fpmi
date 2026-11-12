#!/usr/bin/env node
// One-time move of progress from a claude.ai snapshot (ArtifactData list … out_dir) into the PC data folder.
// Usage: node tools/migrate/from-artifact.ts --from <snapshot dir> --data <pack data dir>
// docs/architecture/07-standalone.md#migration, steps 2–3.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const COLLECTIONS = ["items", "attempts", "meta"] as const;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

type Body = Record<string, unknown>;

/** A snapshot file holds either the bare body or an {id, data} wrapper. */
export function unwrap(raw: Body, fileId: string): { id: string; body: Body } {
  const wrapped = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data);
  const id = typeof raw.id === "string" ? raw.id : fileId;
  const { id: _drop, ...body } = (wrapped ? raw.data : raw) as Body;
  return { id, body };
}

/** JSON with sorted keys, for comparing bodies regardless of key order and spacing. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Body)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function jsonFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort() : [];
}

export type Counts = Record<(typeof COLLECTIONS)[number], number>;

/** Copies the snapshot into `data`, then re-reads both sides and compares. Throws on any problem. */
export function migrate(from: string, data: string): Counts {
  for (const col of COLLECTIONS) {
    if (jsonFiles(join(data, col)).length) throw new Error(`${join(data, col)} is not empty; refusing to overwrite`);
  }
  const counts = { items: 0, attempts: 0, meta: 0 } as Counts;
  const expected = new Map<string, string>();
  for (const col of COLLECTIONS) {
    const files = jsonFiles(join(from, col));
    if (!files.length) continue;
    mkdirSync(join(data, col), { recursive: true });
    for (const f of files) {
      const { id, body } = unwrap(JSON.parse(readFileSync(join(from, col, f), "utf8")) as Body, f.slice(0, -5));
      if (!ID.test(id)) throw new Error(`${col}/${f}: id ${JSON.stringify(id)} is not allowed in the data folder`);
      if (expected.has(`${col}/${id}`)) throw new Error(`${col}/${id}: duplicate`);
      writeFileSync(join(data, col, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`);
      expected.set(`${col}/${id}`, canonical(body));
      counts[col]++;
    }
  }
  // Verify: the same set of documents with equal bodies.
  let seen = 0;
  for (const col of COLLECTIONS) {
    for (const f of jsonFiles(join(data, col))) {
      const key = `${col}/${f.slice(0, -5)}`;
      const got = canonical(JSON.parse(readFileSync(join(data, col, f), "utf8")));
      if (expected.get(key) !== got) throw new Error(`${key}: differs after copy`);
      seen++;
    }
  }
  if (seen !== expected.size) throw new Error(`copied ${expected.size}, found ${seen}`);
  return counts;
}

function main(): void {
  const { values } = parseArgs({ options: { from: { type: "string" }, data: { type: "string" } } });
  if (!values.from || !values.data) throw new Error("usage: from-artifact.ts --from <snapshot> --data <pack data dir>");
  const counts = migrate(resolve(values.from), resolve(values.data));
  console.log(`ok: items ${counts.items}, attempts ${counts.attempts}, meta ${counts.meta}; bodies match`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
