import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical, migrate, unwrap } from "./from-artifact";

// Real v4.1 snapshot (Igor only): ZACH_SNAPSHOT=<zachetka-snapshots>/v4.1-after npm test
const SNAP = process.env.ZACH_SNAPSHOT ?? "";
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "zach-mig-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("from-artifact", () => {
  it("unwraps bare bodies and {id, data} wrappers", () => {
    expect(unwrap({ status: "x", id: "a" }, "f")).toEqual({ id: "a", body: { status: "x" } });
    expect(unwrap({ id: "b", data: { status: "y" } }, "f")).toEqual({ id: "b", body: { status: "y" } });
    expect(unwrap({ status: "z" }, "f")).toEqual({ id: "f", body: { status: "z" } });
    expect(canonical({ b: 1, a: [{ d: 2, c: null }] })).toBe(canonical({ a: [{ c: null, d: 2 }], b: 1 }));
  });

  it("copies a small snapshot with all three collections and refuses a second run", () => {
    const from = tmp(); const data = join(tmp(), "pack");
    for (const c of ["items", "attempts", "meta"]) mkdirSync(join(from, c));
    writeFileSync(join(from, "items/a.json"), JSON.stringify({ status: "сдано", override: null }));
    writeFileSync(join(from, "attempts/x.json"), JSON.stringify({ id: "x", data: { test: "t", answers: [] } }));
    writeFileSync(join(from, "meta/today.json"), JSON.stringify({ plan: [{ text: "п", done: false }] }));
    expect(migrate(from, data)).toEqual({ items: 1, attempts: 1, meta: 1 });
    expect(JSON.parse(readFileSync(join(data, "attempts/x.json"), "utf8"))).toEqual({ test: "t", answers: [] });
    expect(() => migrate(from, data)).toThrow(/not empty/);
  });

  it("rejects ids that the server would not accept", () => {
    const from = tmp();
    mkdirSync(join(from, "items"));
    writeFileSync(join(from, "items/a.json"), JSON.stringify({ id: "../a", data: {} }));
    expect(() => migrate(from, join(tmp(), "p"))).toThrow(/not allowed/);
  });

  it.runIf(!!SNAP && existsSync(SNAP))("moves the real v4.1 snapshot: 121 items, 2 attempts", () => {
    expect(migrate(SNAP, join(tmp(), "igor"))).toEqual({ items: 121, attempts: 2, meta: 0 });
  });
});
