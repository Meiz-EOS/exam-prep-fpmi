#!/usr/bin/env node
// Course-source sync (docs/architecture/12-sync.md): statuses from the C++ manytask table and MRs,
// algorithms review PRs, the algorithms main-stream table (theory) and cotests solution files.
// Usage: node tools/sync/sync.ts [--pack <name or dir>] [--data <pack data dir>] [--dry-run]  (defaults: tools/lib/settings.ts)
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parse } from "yaml";
import { STATUSES, type Status } from "../../engine/src/core/status.ts";
import { readJson, writeJson } from "../lib/json-files.ts";
import { loadSettings, packPath } from "../lib/settings.ts";
import { buildPack } from "../pack/build-pack.ts";
import {
  type Change, combine, decide, fromAlgoTheory, fromCotests, fromGithubPrs, fromGitlabRefs, fromManytask,
  type GithubPr, type Observation, type Unmapped,
} from "./core.ts";

const run = promisify(execFile);

export interface SyncConfig {
  cpp?: { sheet?: string; tab?: string; login?: string; repo?: string; tasks: Record<string, string> };
  aisd?: { github?: string; sheet?: string; student?: string; cotests?: string };
}

export interface SyncReport {
  at: string;
  changes: Change[];
  unmapped: Unmapped[];
  errors: string[];
}

/** Writes a status into one item document (merge, sets updatedAt); the server passes its own queued writer. */
export type WriteStatus = (id: string, status: Status) => Promise<void>;

async function sheetCsv(id: string, tab?: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${tab ? `&sheet=${encodeURIComponent(tab)}` : ""}`;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`sheet ${id}: HTTP ${res.status}`);
  return res.text();
}

async function listCotests(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir)) {
    if (!/^algos_dz_\d+$/.test(d)) continue;
    for (const f of await readdir(join(dir, d)).catch(() => [])) out.push(`${d}/${f}`);
  }
  return out;
}

/** Gathers every configured source; a failing source is reported and skipped, the others still apply. */
export async function observe(cfg: SyncConfig, items: ReadonlySet<string>): Promise<{ obs: Observation[]; unmapped: Unmapped[]; errors: string[] }> {
  const obs: Observation[] = [];
  const unmapped: Unmapped[] = [];
  const errors: string[] = [];
  const take = async (name: string, f: () => Promise<{ obs: Observation[]; unmapped: Unmapped[] }>) => {
    try {
      const r = await f();
      obs.push(...r.obs.filter((o) => items.has(o.item)));
      unmapped.push(...r.unmapped, ...r.obs.filter((o) => !items.has(o.item)).map((o) => ({ source: name, key: o.item })));
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const { cpp, aisd } = cfg;
  if (cpp?.sheet && cpp.login) await take("manytask", async () => fromManytask(await sheetCsv(cpp.sheet!, cpp.tab), cpp.login!, cpp.tasks));
  if (cpp?.repo) {
    await take("gitlab MR", async () => fromGitlabRefs((await run("git", ["-C", cpp.repo!, "ls-remote", "origin"], { timeout: 30_000 })).stdout, cpp.tasks));
  }
  if (aisd?.github) {
    await take("github PR", async () => {
      const { stdout } = await run("gh", ["pr", "list", "-R", aisd.github!, "--state", "all", "--limit", "200",
        "--json", "number,headRefName,state,reviewDecision"], { timeout: 30_000 });
      return fromGithubPrs(JSON.parse(stdout) as GithubPr[], items);
    });
  }
  if (aisd?.sheet && aisd.student) await take("algo sheet", async () => fromAlgoTheory(await sheetCsv(aisd.sheet!), aisd.student!, items));
  if (aisd?.cotests) await take("cotests", async () => fromCotests(await listCotests(aisd.cotests!), items));
  return { obs, unmapped, errors };
}

/** Direct file writer for the CLI (the server passes its queued one). */
export function fileWriter(data: string): WriteStatus {
  return async (id, status) => {
    const dir = join(data, "items");
    const prev = (await readJson(join(dir, `${id}.json`))) ?? {};
    await writeJson(dir, id, { ...prev, status, updatedAt: new Date().toISOString() });
  };
}

/** Personal config lives next to the progress, not in the pack (13-classmates.md#private). */
export function syncConfigPath(data: string): string {
  return join(data, "sync.yaml");
}

/** One sync run over a pack data folder; returns the report (also stored in meta/sync.json). Config: <data>/sync.yaml. */
export async function runSync(o: { pack: string; data: string; dryRun?: boolean; write?: WriteStatus; now?: Date }): Promise<SyncReport> {
  const cfg = parse(await readFile(syncConfigPath(o.data), "utf8")) as SyncConfig;
  const items = new Set(buildPack(o.pack).items.map((i) => i.id));
  const { obs, unmapped, errors } = await observe(cfg, items);

  const current = new Map<string, Status>();
  for (const id of items) {
    const s = (await readJson(join(o.data, "items", `${id}.json`)))?.status;
    if (typeof s === "string" && (STATUSES as readonly string[]).includes(s)) current.set(id, s as Status);
  }
  const meta = (await readJson(join(o.data, "meta", "sync.json"))) ?? {};
  const seen = (meta.seen && typeof meta.seen === "object" ? meta.seen : {}) as Record<string, string>;
  const { changes, seen: nextSeen } = decide(combine(obs), current, seen);
  const report: SyncReport = { at: (o.now ?? new Date()).toISOString(), changes, unmapped, errors };
  if (o.dryRun) return report;

  const write = o.write ?? fileWriter(o.data);
  for (const c of changes) await write(c.item, c.to);
  await writeJson(join(o.data, "meta"), "sync", { seen: nextSeen, last: report, updatedAt: report.at });
  return report;
}

export function formatReport(r: SyncReport): string {
  const lines = [`sync ${r.at}: ${r.changes.length} change(s)`];
  for (const c of r.changes) lines.push(`  ${c.item}: ${c.from} → ${c.to}  (${c.source})`);
  for (const u of r.unmapped) lines.push(`  no pack item: ${u.source} ${u.key}`);
  for (const e of r.errors) lines.push(`  ERROR ${e}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { pack: { type: "string" }, data: { type: "string" }, "dry-run": { type: "boolean" } } });
  const s = loadSettings();
  const pack = values.pack ? packPath(s.root, values.pack) : s.pack;
  const data = resolve(values.data ?? join(s.dataDir, basename(pack)));
  if (!existsSync(syncConfigPath(data))) {
    console.log(`sync: off, no ${syncConfigPath(data)}`);
    return;
  }
  const report = await runSync({ pack, data, dryRun: values["dry-run"] });
  console.log(formatReport(report));
  if (report.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
