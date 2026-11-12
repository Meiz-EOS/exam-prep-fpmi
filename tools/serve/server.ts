#!/usr/bin/env node
// Local server for the PC version (docs/architecture/07-standalone.md): static page + progress API on JSON files.
// Usage: node tools/serve/server.ts [--port 4317] [--pack <name or dir>] [--data <pack data dir>] [--dist dist/local]
// Defaults for pack and data: tools/lib/settings.ts (zachetka.local.json).
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildExchange, ExchangeError, parseExchange, planImport, type Collections } from "../../engine/src/core/exchange.ts";
import type { Doc } from "../../engine/src/store/types.ts";
import { readJson as readDoc, writeJson as writeDoc } from "../lib/json-files.ts";
import { loadSettings, packPath } from "../lib/settings.ts";
import { formatReport, runSync, syncConfigPath } from "../sync/sync.ts";

const COLLECTIONS = ["items", "attempts", "meta"] as const;
const DEFAULT_PORT = 4317;
const MAX_BODY = 256 * 1024;
const MAX_IMPORT = 8 * 1024 * 1024; // exchange file (11-apk.md#capability)
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface ServeOptions {
  port: number;       // 0 = any free port (tests)
  pack: string;
  data: string;       // folder with items/, attempts/, meta/
  dist: string;       // folder with index.html
  /** Pack folder: run the course-source sync at start and hourly if <data>/sync.yaml exists (12-sync.md). Off in tests. */
  syncPack?: string;
}

const SYNC_EVERY_MS = 60 * 60 * 1000;

/** Course-source sync through the same per-document queue as PATCH. */
function scheduleSync(o: ServeOptions): () => void {
  if (!existsSync(syncConfigPath(o.data))) {
    console.log(`sync: off, no ${syncConfigPath(o.data)}`);
    return () => undefined;
  }
  const once = () => runSync({
    pack: o.syncPack!, data: o.data,
    write: (id, status) => serial(`items/${id}`, async () => {
      const dir = join(o.data, "items");
      const prev = (await readDoc(join(dir, `${id}.json`))) ?? {};
      await writeDoc(dir, id, { ...prev, status, updatedAt: new Date().toISOString() });
    }),
  }).then((r) => console.log(formatReport(r)), (e: unknown) => console.error("sync failed:", e));
  void once();
  const timer = setInterval(() => void once(), SYNC_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

type Body = Record<string, unknown>;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One write at a time per document. */
const tails = new Map<string, Promise<unknown>>();
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
  tails.set(key, next);
  void next.finally(() => { if (tails.get(key) === next) tails.delete(key); }).catch(() => undefined);
  return next;
}

async function listDocs(dir: string): Promise<Body[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const docs: Body[] = [];
  for (const name of names.filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) {
    const body = await readDoc(join(dir, name));
    if (body) docs.push({ ...body, id: name.slice(0, -5) });
  }
  return docs;
}

async function readBody(req: IncomingMessage, max = MAX_BODY): Promise<Body> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "JSON only");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "object expected");
  const { id: _id, ...rest } = value as Body;
  return rest;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function api(o: ServeOptions, req: IncomingMessage, res: ServerResponse, parts: string[]): Promise<void> {
  const method = req.method ?? "GET";
  if (parts[0] === "health" && parts.length === 1 && method === "GET") return json(res, 200, { ok: true, pack: o.pack });
  if (parts[0] === "export" && parts.length === 1 && method === "GET") return json(res, 200, await exportAll(o));
  if (parts[0] === "import" && parts.length === 1 && method === "POST") return json(res, 200, await importFile(o, await readBody(req, MAX_IMPORT)));
  const [col, id, ...extra] = parts;
  if (!col || !(COLLECTIONS as readonly string[]).includes(col) || extra.length) throw new HttpError(404, "unknown path");
  const dir = join(o.data, col);
  if (id === undefined) {
    if (method === "GET") return json(res, 200, await listDocs(dir));
    if (method === "POST") {
      const body = await readBody(req);
      const newId = randomUUID().replaceAll("-", "").slice(0, 20);
      await writeDoc(dir, newId, { ...body, updatedAt: new Date().toISOString() });
      return json(res, 201, { id: newId });
    }
    throw new HttpError(405, "method");
  }
  if (!ID.test(id)) throw new HttpError(400, "bad id");
  if (method === "PATCH") {
    const patch = await readBody(req);
    await serial(`${col}/${id}`, async () => {
      const prev = (await readDoc(join(dir, `${id}.json`))) ?? {};
      await writeDoc(dir, id, { ...prev, ...patch, updatedAt: new Date().toISOString() });
    });
    return json(res, 200, { ok: true });
  }
  if (method === "DELETE") {
    await serial(`${col}/${id}`, () => rm(join(dir, `${id}.json`), { force: true }));
    return json(res, 200, { ok: true });
  }
  throw new HttpError(405, "method");
}

async function readAll(o: ServeOptions): Promise<Collections> {
  const out = {} as Collections;
  for (const col of COLLECTIONS) out[col] = (await listDocs(join(o.data, col))) as Doc[];
  return out;
}

/** Exchange file from the disk, so agent writes (meta/today) are included. */
async function exportAll(o: ServeOptions) {
  return buildExchange(o.pack, await readAll(o));
}

/** Merges an exchange file; documents are written as they are, keeping their updatedAt. */
async function importFile(o: ServeOptions, body: Body): Promise<{ added: number; updated: number; kept: number }> {
  let file;
  try {
    file = parseExchange(body, o.pack);
  } catch (e) {
    if (e instanceof ExchangeError) throw new HttpError(400, e.message);
    throw e;
  }
  const stats = { added: 0, updated: 0, kept: 0 };
  for (const col of COLLECTIONS) {
    const dir = join(o.data, col);
    for (const doc of file.collections[col]) {
      // Decide per document inside its queue: a PATCH from the tab may land meanwhile.
      await serial(`${col}/${doc.id}`, async () => {
        const prev = await readDoc(join(dir, `${doc.id}.json`));
        const plan = planImport({ [col]: prev ? [{ ...prev, id: doc.id }] : [] }, { ...file, collections: { items: [], attempts: [], meta: [], [col]: [doc] } });
        stats.added += plan.added;
        stats.updated += plan.updated;
        stats.kept += plan.kept;
        for (const w of plan.writes) {
          const { id: _id, ...rest } = w.doc;
          await writeDoc(dir, doc.id, rest);
        }
      });
    }
  }
  return stats;
}

async function page(o: ServeOptions, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method");
  if (path !== "/" && path !== "/index.html") throw new HttpError(404, "not found");
  let html: Buffer;
  try {
    html = await readFile(join(o.dist, "index.html")); // read per request: a new build shows after reload
  } catch {
    throw new HttpError(404, "no build: run npm run build:local");
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : html);
}

function handler(o: ServeOptions, port: () => number) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const p = port();
      if (req.headers.host !== `127.0.0.1:${p}` && req.headers.host !== `localhost:${p}`) throw new HttpError(403, "host");
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path.startsWith("/api/")) await api(o, req, res, path.slice(5).split("/").filter(Boolean).map(decodeURIComponent));
      else await page(o, req, res, path);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) json(res, status, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    }
  };
}

/** Starts the server on 127.0.0.1; resolves when it listens. */
export function startServer(o: ServeOptions): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  let port = o.port;
  const server = createServer(handler(o, () => port));
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(o.port, "127.0.0.1", () => {
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : o.port;
      const stopSync = o.syncPack ? scheduleSync(o) : () => undefined;
      ok({ server, port, close: () => new Promise<void>((done) => { stopSync(); server.close(() => done()); }) });
    });
  });
}

function main(): void {
  const { values } = parseArgs({
    options: { port: { type: "string" }, pack: { type: "string" }, data: { type: "string" }, dist: { type: "string" }, "no-sync": { type: "boolean" } },
  });
  const s = loadSettings();
  const packDir = values.pack ? packPath(s.root, values.pack) : s.pack;
  const pack = basename(packDir);
  const o: ServeOptions = {
    port: Number(values.port ?? DEFAULT_PORT),
    pack,
    data: resolve(values.data ?? join(s.dataDir, pack)),
    dist: resolve(values.dist ?? join(s.root, "dist/local")),
    syncPack: values["no-sync"] ? undefined : packDir,
  };
  startServer(o).then(({ port }) => {
    console.log(`zachetka: http://127.0.0.1:${port}/  data=${o.data}`);
  }, (e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
