// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpStore, RELOAD_MS } from "../src/store/http";
import type { Snapshot, StoreError } from "../src/store/types";

const tick = () => new Promise((r) => setTimeout(r, 0));

type Call = { method: string; url: string; body?: unknown };

/** Fake server: answers GET /api/<col> from `db`, records writes. */
function fakeFetch(db: Record<string, unknown[]>, opts: { status?: number; hold?: Promise<void> } = {}) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (opts.status) return new Response("x", { status: opts.status });
    if (method === "GET") {
      const docs = structuredClone(db[url.split("/").pop()!] ?? []);
      if (opts.hold) await opts.hold;
      return Response.json(docs);
    }
    if (method === "POST") return Response.json({ id: "new1" });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HttpStore", () => {
  it("loads a collection and reloads on focus", async () => {
    const db = { items: [{ id: "a", status: "не начато" }] };
    const calls = fakeFetch(db);
    const s = new HttpStore();
    const seen: Snapshot[] = [];
    const stop = s.subscribe("items", (x) => seen.push(x), () => {});
    await tick();
    expect(seen.at(-1)).toEqual({ docs: [{ id: "a", status: "не начато" }], fromCache: false });
    db.items[0]!.status = "сдано";
    window.dispatchEvent(new Event("focus"));
    await tick();
    expect(seen.at(-1)?.docs[0]?.status).toBe("сдано");
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
    stop();
    window.dispatchEvent(new Event("focus"));
    await tick();
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("reloads on a timer and stops after unsubscribe", async () => {
    vi.useFakeTimers();
    const calls = fakeFetch({ items: [] });
    const s = new HttpStore();
    const stop = s.subscribe("items", () => {}, () => {});
    await vi.advanceTimersByTimeAsync(RELOAD_MS * 2);
    expect(calls).toHaveLength(3);
    stop();
    await vi.advanceTimersByTimeAsync(RELOAD_MS * 2);
    expect(calls).toHaveLength(3);
  });

  it("reports a server error as unavailable", async () => {
    fakeFetch({}, { status: 500 });
    const errs: StoreError[] = [];
    new HttpStore().subscribe("items", () => {}, (e) => errs.push(e));
    await tick();
    expect(errs[0]?.code).toBe("unavailable");
  });

  it("shows a write at once, sends a PATCH, rejects on failure", async () => {
    const calls = fakeFetch({ items: [] });
    const s = new HttpStore();
    const seen: Snapshot[] = [];
    s.subscribe("items", (x) => seen.push(x), () => {});
    await tick();
    const p = s.update("items", "a", { status: "сдано", override: null });
    expect(seen.at(-1)?.docs[0]).toMatchObject({ id: "a", status: "сдано", override: null });
    expect(seen.at(-1)?.fromCache).toBe(true);
    await p;
    expect(calls.at(-1)).toEqual({ method: "PATCH", url: "/api/items/a", body: { status: "сдано", override: null } });
    fakeFetch({}, { status: 500 });
    await expect(s.update("items", "a", { status: "принято" })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("serializes writes to one document", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { n: string };
      order.push(`start ${body.n}`);
      if (body.n === "1") await gate;
      order.push(`end ${body.n}`);
      return Response.json({ ok: true });
    }));
    const s = new HttpStore();
    const a = s.update("items", "x", { n: "1" });
    const b = s.update("items", "x", { n: "2" });
    await tick();
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("drops a reload that started before a local write", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const db = { items: [{ id: "a", status: "не начато" }] };
    fakeFetch(db);
    const s = new HttpStore();
    const seen: Snapshot[] = [];
    s.subscribe("items", (x) => seen.push(x), () => {});
    await tick();
    fakeFetch(db, { hold });
    window.dispatchEvent(new Event("focus"));
    await tick();
    await s.update("items", "a", { status: "сдано" });
    release();
    await tick();
    expect(seen.at(-1)?.docs[0]?.status).toBe("сдано");
  });

  it("create returns the server id; remove sends DELETE", async () => {
    const calls = fakeFetch({ attempts: [] });
    const s = new HttpStore();
    expect(await s.create("attempts", { test: "t1" })).toBe("new1");
    await s.remove("attempts", "new1");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/attempts", "DELETE /api/attempts/new1"]);
    expect(await s.canWrite()).toBe(true);
  });
});

describe("HttpStore exchange", () => {
  const file = { format: "zachetka-progress/1", pack: "p", exportedAt: "2026-11-11T00:00:00Z", collections: { items: [], attempts: [], meta: [] } } as const;

  it("exports from the server and rejects a non-exchange answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(file)));
    expect((await new HttpStore().exportFile()).format).toBe("zachetka-progress/1");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hello: 1 })));
    await expect(new HttpStore().exportFile()).rejects.toMatchObject({ code: "invalid" });
  });

  it("imports, then reloads subscribed collections", async () => {
    let items = [{ id: "a", status: "old" }];
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/import") {
        expect(JSON.parse(String(init?.body)).format).toBe("zachetka-progress/1");
        items = [{ id: "a", status: "new" }];
        return Response.json({ added: 0, updated: 1, kept: 0 });
      }
      return Response.json(url === "/api/items" ? items : []);
    }));
    const s = new HttpStore();
    const seen: Snapshot[] = [];
    const stop = s.subscribe("items", (x) => seen.push(x), () => {});
    await tick();
    expect(seen.at(-1)?.docs[0]?.status).toBe("old");
    expect(await s.importFile(structuredClone(file) as any)).toEqual({ added: 0, updated: 1, kept: 0 });
    expect(seen.at(-1)?.docs[0]?.status).toBe("new");
    expect(calls).toEqual(["GET /api/items", "POST /api/import", "GET /api/items"]);
    stop();
  });

  it("maps a 400 from import to invalid and a network failure to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 400 })));
    await expect(new HttpStore().importFile(file as any)).rejects.toMatchObject({ code: "invalid" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    await expect(new HttpStore().importFile(file as any)).rejects.toMatchObject({ code: "unavailable" });
  });
});
