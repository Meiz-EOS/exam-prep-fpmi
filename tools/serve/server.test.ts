import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "./server";

let dir: string;
let port: number;
let close: () => Promise<void>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "zach-serve-"));
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist/index.html"), "<!doctype html><title>Z</title>");
  mkdirSync(join(dir, "data/items"), { recursive: true });
  writeFileSync(join(dir, "data/items/a.json"), JSON.stringify({ status: "сдано", updatedAt: "2026-11-01T00:00:00Z" }));
  ({ port, close } = await startServer({ port: 0, pack: "p", data: join(dir, "data"), dist: join(dir, "dist") }));
});
afterAll(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

/** Raw request so the Host header can be forged (fetch forbids it). */
function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any; text: string }> {
  return new Promise((ok, fail) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request({
      host: "127.0.0.1", port, method, path,
      headers: { Host: `127.0.0.1:${port}`, ...(data !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        let json: any;
        try { json = JSON.parse(text); } catch { json = undefined; }
        ok({ status: res.statusCode ?? 0, json, text });
      });
    });
    req.on("error", fail);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const disk = (col: string, id: string) => JSON.parse(readFileSync(join(dir, "data", col, `${id}.json`), "utf8"));

describe("local server", () => {
  it("health and page", async () => {
    expect((await call("GET", "/api/health")).json).toEqual({ ok: true, pack: "p" });
    const page = await call("GET", "/");
    expect(page.status).toBe(200);
    expect(page.text).toContain("<title>Z</title>");
    expect((await call("GET", "/other.js")).status).toBe(404);
  });

  it("lists collections, empty and not", async () => {
    expect((await call("GET", "/api/attempts")).json).toEqual([]);
    expect((await call("GET", "/api/items")).json).toEqual([{ id: "a", status: "сдано", updatedAt: "2026-11-01T00:00:00Z" }]);
  });

  it("PATCH creates and merges shallowly; null is kept; server sets updatedAt", async () => {
    expect((await call("PATCH", "/api/items/b", { status: "сдано", override: { due: "x" } })).status).toBe(200);
    await call("PATCH", "/api/items/b", { override: null, note: "n", id: "evil" });
    const b = disk("items", "b");
    expect(b).toMatchObject({ status: "сдано", override: null, note: "n" });
    expect(b.id).toBeUndefined();
    expect(Date.parse(b.updatedAt)).toBeGreaterThan(Date.parse("2026-11-09"));
  });

  it("POST returns a new id; DELETE removes; no temp files left", async () => {
    const r = await call("POST", "/api/attempts", { test: "t1" });
    expect(r.status).toBe(201);
    expect(disk("attempts", r.json.id)).toMatchObject({ test: "t1" });
    await call("DELETE", `/api/attempts/${r.json.id}`);
    expect((await call("GET", "/api/attempts")).json).toEqual([]);
    expect(readdirSync(join(dir, "data/items")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects bad ids, collections, bodies, hosts and content types", async () => {
    expect((await call("PATCH", "/api/items/..%2Fx", { a: 1 })).status).toBe(400);
    expect((await call("PATCH", "/api/items/a.b", { a: 1 })).status).toBe(400);
    expect((await call("GET", "/api/secrets")).status).toBe(404);
    expect((await call("PATCH", "/api/items/c", "{bad")).status).toBe(400);
    expect((await call("PATCH", "/api/items/c", [1])).status).toBe(400);
    expect((await call("GET", "/api/items", undefined, { Host: "evil.example:80" })).status).toBe(403);
    expect((await call("GET", "/api/items", undefined, { Host: `localhost:${port}` })).status).toBe(200);
    expect((await call("PATCH", "/api/items/c", "{}", { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await call("PATCH", "/api/items/c", { big: "x".repeat(300 * 1024) })).status).toBe(413);
  });

  it("20 parallel PATCHes to one document keep every field", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => call("PATCH", "/api/meta/today", { [`f${i}`]: i })));
    const doc = disk("meta", "today");
    for (let i = 0; i < 20; i++) expect(doc[`f${i}`]).toBe(i);
  });
});

describe("exchange", () => {
  const file = (items: unknown[], extra: Record<string, unknown> = {}) => ({
    format: "zachetka-progress/1", pack: "p", exportedAt: "2026-11-11T00:00:00Z", collections: { items, attempts: [], meta: [] }, ...extra,
  });

  it("export reads every collection from disk with updatedAt", async () => {
    mkdirSync(join(dir, "data/meta"), { recursive: true });
    writeFileSync(join(dir, "data/meta/today.json"), JSON.stringify({ plan: [], updatedAt: "2026-11-11T06:00:00.000Z" }));
    const r = await call("GET", "/api/export");
    expect(r.status).toBe(200);
    expect(r.json.format).toBe("zachetka-progress/1");
    expect(r.json.pack).toBe("p");
    expect(r.json.collections.meta).toEqual([{ id: "today", plan: [], updatedAt: "2026-11-11T06:00:00.000Z" }]);
    expect(r.json.collections.items.find((d: any) => d.id === "a")?.updatedAt).toBeTruthy();
  });

  it("import keeps newer local docs, takes newer ones with their updatedAt, adds new; repeat is a no-op", async () => {
    writeFileSync(join(dir, "data/items/x1.json"), JSON.stringify({ status: "pc", updatedAt: "2026-11-10T00:00:00.000Z" }));
    writeFileSync(join(dir, "data/items/x2.json"), JSON.stringify({ status: "pc", updatedAt: "2026-11-10T00:00:00.000Z" }));
    const f = file([
      { id: "x1", status: "phone", updatedAt: "2026-11-11T09:00:00.000Z" },
      { id: "x2", status: "phone", updatedAt: "2026-11-09T09:00:00.000Z" },
      { id: "x3", status: "phone", updatedAt: "2026-11-11T09:00:00.000Z" },
    ]);
    const r = await call("POST", "/api/import", f);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ added: 1, updated: 1, kept: 1 });
    const x1 = JSON.parse(readFileSync(join(dir, "data/items/x1.json"), "utf8"));
    expect(x1).toEqual({ status: "phone", updatedAt: "2026-11-11T09:00:00.000Z" });
    expect(JSON.parse(readFileSync(join(dir, "data/items/x2.json"), "utf8")).status).toBe("pc");
    expect(JSON.parse(readFileSync(join(dir, "data/items/x3.json"), "utf8")).status).toBe("phone");
    expect((await call("POST", "/api/import", f)).json).toEqual({ added: 0, updated: 0, kept: 3 });
    expect(readdirSync(join(dir, "data/items")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects foreign packs, bad files, oversize bodies, foreign hosts and non-JSON", async () => {
    expect((await call("POST", "/api/import", file([], { pack: "other" }))).status).toBe(400);
    expect((await call("POST", "/api/import", { hello: 1 })).status).toBe(400);
    expect((await call("POST", "/api/import", file([{ id: "../x", updatedAt: "2026-11-11T09:00:00.000Z" }]))).status).toBe(400);
    expect((await call("POST", "/api/import", "x".repeat(8 * 1024 * 1024 + 10))).status).toBe(413);
    expect((await call("POST", "/api/import", file([]), { Host: "evil.example:80" })).status).toBe(403);
    expect((await call("POST", "/api/import", file([]), { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await call("GET", "/api/import")).status).toBe(404);
  });
});
