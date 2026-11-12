import { describe, expect, it } from "vitest";
import { buildExchange, DOC_ID } from "../src/core/exchange";
import { BACKUPS_KEPT, CapacitorStore, type Disk } from "../src/store/capacitor";
import type { Snapshot, StoreError } from "../src/store/types";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** In-memory disk; `renameOverExisting: false` mimics a platform whose rename refuses to overwrite. */
function memDisk(opts: { renameOverExisting?: boolean } = {}) {
  const files = new Map<string, string>();
  const log: string[] = [];
  const disk: Disk = {
    async read(p) { return files.get(p) ?? null; },
    async write(p, t) { log.push(`write ${p}`); files.set(p, t); },
    async rename(a, b) {
      if (!files.has(a)) throw new Error("no source");
      if (files.has(b) && opts.renameOverExisting === false) throw new Error("exists");
      files.set(b, files.get(a)!); files.delete(a); log.push(`rename ${a}`);
    },
    async remove(p) { files.delete(p); },
    async list(dir) { return [...files.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)); },
  };
  return { disk, files, log };
}

async function first(s: CapacitorStore, col: "items" | "attempts" | "meta"): Promise<Snapshot> {
  return new Promise((ok, fail) => { const stop = s.subscribe(col, (x) => { stop(); ok(x); }, fail); });
}

describe("CapacitorStore", () => {
  it("starts empty, and writes survive a restart", async () => {
    const { disk, files } = memDisk();
    const s = new CapacitorStore(disk, "p");
    expect((await first(s, "items")).docs).toEqual([]);
    await s.update("items", "a", { status: "сдано" });
    expect(JSON.parse(files.get("zachetka/p/items.json")!)).toMatchObject([{ id: "a", status: "сдано" }]);
    expect(files.has("zachetka/p/items.json.tmp")).toBe(false);
    const again = new CapacitorStore(disk, "p");
    const snap = await first(again, "items");
    expect(snap.fromCache).toBe(false);
    expect(snap.docs[0]).toMatchObject({ id: "a", status: "сдано" });
    expect(typeof snap.docs[0]!.updatedAt).toBe("string");
  });

  it("shows a change to subscribers at once and keeps every field of parallel writes", async () => {
    const { disk, files } = memDisk();
    const s = new CapacitorStore(disk, "p");
    const seen: Snapshot[] = [];
    s.subscribe("items", (x) => seen.push(x), () => {});
    await tick();
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.update("items", "a", { [`f${i}`]: i })));
    expect(Object.keys(seen.at(-1)!.docs[0]!).filter((k) => k.startsWith("f"))).toHaveLength(20);
    const disk20 = JSON.parse(files.get("zachetka/p/items.json")!)[0];
    expect(Object.keys(disk20).filter((k) => k.startsWith("f"))).toHaveLength(20);
  });

  it("works when rename refuses to overwrite, and recovers from a leftover temp file", async () => {
    const { disk, files } = memDisk({ renameOverExisting: false });
    const s = new CapacitorStore(disk, "p");
    await s.update("items", "a", { v: 1 });
    await s.update("items", "a", { v: 2 });
    expect(JSON.parse(files.get("zachetka/p/items.json")!)[0].v).toBe(2);
    // crash after deleting the old file, before the rename
    files.set("zachetka/p/items.json.tmp", files.get("zachetka/p/items.json")!);
    files.delete("zachetka/p/items.json");
    expect((await first(new CapacitorStore(disk, "p"), "items")).docs[0]).toMatchObject({ v: 2 });
  });

  it("reports a broken file as an error, not as empty data", async () => {
    const { disk, files } = memDisk();
    files.set("zachetka/p/items.json", "{oops");
    const err = await new Promise<StoreError>((ok) => new CapacitorStore(disk, "p").subscribe("items", () => {}, ok));
    expect(err.code).toBe("invalid");
  });

  it("create gives ids valid for the exchange file and unique", async () => {
    const s = new CapacitorStore(memDisk().disk, "p");
    const ids = await Promise.all(Array.from({ length: 50 }, () => s.create("attempts", { test: "t" })));
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(DOC_ID);
  });

  it("export → import elsewhere moves everything; import keeps the last backups", async () => {
    const phone = memDisk();
    const s = new CapacitorStore(phone.disk, "p");
    await s.update("items", "a", { status: "сдано" });
    await s.create("attempts", { test: "t" });
    const file = await s.exportFile();
    expect(file.pack).toBe("p");

    const pc = new CapacitorStore(memDisk().disk, "p");
    expect(await pc.importFile(file)).toEqual({ added: 2, updated: 0, kept: 0 });
    expect((await pc.exportFile()).collections).toEqual(file.collections);

    for (let i = 0; i < BACKUPS_KEPT + 2; i++) {
      await new Promise((r) => setTimeout(r, 2));
      await s.importFile(buildExchange("p", {}));
    }
    expect((await phone.disk.list("zachetka/p/backup")).length).toBe(BACKUPS_KEPT);
  });

  it("import notifies subscribers and never deletes", async () => {
    const s = new CapacitorStore(memDisk().disk, "p");
    await s.update("items", "mine", { status: "pc" });
    const seen: Snapshot[] = [];
    s.subscribe("items", (x) => seen.push(x), () => {});
    await tick();
    await s.importFile(buildExchange("p", { items: [{ id: "theirs", updatedAt: "2026-11-11T00:00:00.000Z" }] }));
    expect(seen.at(-1)!.docs.map((d) => d.id).sort()).toEqual(["mine", "theirs"]);
  });
});
