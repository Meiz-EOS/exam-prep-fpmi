import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory";
import { KeyedQueue, type Snapshot } from "../src/store/types";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("MemoryStore", () => {
  it("delivers initial data and later changes", async () => {
    const s = new MemoryStore({ items: [{ id: "a", status: "не начато" }] });
    const seen: Snapshot[] = [];
    s.subscribe("items", (snap) => seen.push(snap), () => {});
    await tick();
    expect(seen.at(-1)?.docs).toEqual([{ id: "a", status: "не начато" }]);
    await s.update("items", "a", { status: "сдано" });
    expect(seen.at(-1)?.docs[0]).toMatchObject({ id: "a", status: "сдано" });
    expect(typeof seen.at(-1)?.docs[0]?.updatedAt).toBe("string");
  });
  it("update creates a missing doc; create returns id; remove deletes", async () => {
    const s = new MemoryStore();
    const seen: Snapshot[] = [];
    s.subscribe("items", (snap) => seen.push(snap), () => {});
    await s.update("items", "x", { note: "n" });
    const id = await s.create("items", { custom: true });
    expect(seen.at(-1)?.docs.map((d) => d.id).sort()).toEqual([id, "x"].sort());
    await s.remove("items", "x");
    expect(seen.at(-1)?.docs.map((d) => d.id)).toEqual([id]);
  });
  it("read-only store rejects writes", async () => {
    const s = new MemoryStore({}, false);
    await expect(s.update("items", "a", {})).rejects.toMatchObject({ code: "read_only" });
    expect(await s.canWrite()).toBe(false);
  });
});

describe("KeyedQueue", () => {
  it("runs tasks for one key in order, even after a failure", async () => {
    const q = new KeyedQueue();
    const log: string[] = [];
    const slow = (name: string, ms: number, fail = false) => () =>
      new Promise<void>((res, rej) => setTimeout(() => { log.push(name); fail ? rej(new Error(name)) : res(); }, ms));
    const a = q.run("k", slow("a", 20, true));
    const b = q.run("k", slow("b", 0));
    const c = q.run("other", slow("c", 0));
    await Promise.allSettled([a, b, c]);
    expect(log.indexOf("a")).toBeLessThan(log.indexOf("b"));
    expect(log[0]).toBe("c");
  });
});
