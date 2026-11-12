import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hotList } from "../src/core/hot";
import { mergeView } from "../src/core/merge";
import { parse } from "yaml";
import { buildPack } from "../../tools/pack/build-pack";
import { loadSettings } from "../../tools/lib/settings";

// The real pack against the v0 data it was built from (W1-09 check).
// v0 data is personal: it lives in the data folder (13-classmates.md#private), so this runs only where it exists.
const priv = join(loadSettings({ env: { ...process.env, ZACH_PACK: "packs/igor-2026w" } }).packData, "private");
const has = existsSync(join(priv, "v0-seed.json")) && existsSync(join(priv, "notes.yaml"));
const pack = buildPack("packs/igor-2026w");
const seed = (has ? JSON.parse(readFileSync(join(priv, "v0-seed.json"), "utf8")) : {}) as Record<string, Record<string, unknown>>;
const privateNotes = (has ? parse(readFileSync(join(priv, "notes.yaml"), "utf8")) : {}) as Record<string, string>;
const docs: ({ id: string } & Record<string, unknown>)[] = Object.entries(seed).map(([id, d]) => ({ ...d, id }));

describe.runIf(has)("igor-2026w with v0 data", () => {
  const view = mergeView(pack, docs);
  it("due soon on 2026-11-07: v0 items; assignment 2 moved to 23.11/30.11 by the course, so not yet due", () => {
    // Items added later (past work, W1-17) have no v0 document, so they are left out here.
    const known = new Set([...docs.map((d) => d.id), "matan2-submit"]);
    expect(hotList(view.items, "2026-11-07").map((h) => h.item.id).filter((id) => known.has(id))).toEqual(["aisd-td04", "cpp-string"]);
  });
  it("matan assignments 2 and 3 from the booklet: 49 problem rows each, stars as printed", () => {
    for (const n of [2, 3]) {
      const probs = view.items.filter((i) => i.id.startsWith(`matan${n}-w`));
      expect(probs).toHaveLength(49);
      expect(probs.filter((i) => i.star)).toHaveLength(n === 2 ? 3 : 5);
    }
  });
  it("groups and statuses carried over", () => {
    expect(view.items.filter((i) => i.group === "АиГ задание 2 · неделя 1")).toHaveLength(8);
    expect(view.items.find((i) => i.id === "aig-kr1")).toMatchObject({ status: "принято", score: 7 });
    expect(view.orphans).toEqual([]);
    expect(view.exams).toHaveLength(5);
  });
  it("only v0 notes with chat refs leak as student notes; the W1-11 cleanup removes them", () => {
    const leaked = view.items.filter((i) => i.note).map((i) => i.id).sort();
    expect(leaked).toEqual(Object.keys(privateNotes).sort());
    // Cleanup: drop note where it still equals the v0 original.
    const cleaned = docs.map((d) => (d.note === seed[d.id]?.note ? { ...d, note: undefined } : d));
    expect(mergeView(pack, cleaned).items.filter((i) => i.note)).toEqual([]);
  });
});
