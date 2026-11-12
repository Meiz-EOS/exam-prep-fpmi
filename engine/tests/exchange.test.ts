import { describe, expect, it } from "vitest";
import {
  applyPlan, buildExchange, ExchangeError, isExchangeCapable, parseExchange, planImport, type Collections,
} from "../src/core/exchange.ts";

const P = "igor-2026w";
const doc = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({ id, updatedAt, ...extra });

function roundTrip(c: Partial<Collections>) {
  return parseExchange(JSON.parse(JSON.stringify(buildExchange(P, c))), P);
}

describe("exchange file", () => {
  it("builds format, pack and all three collections", () => {
    const f = buildExchange(P, { items: [doc("b", "2026-11-01T00:00:00.000Z"), doc("a", "2026-11-01T00:00:00.000Z")] },
      new Date("2026-11-11T20:00:00Z"));
    expect(f.format).toBe("zachetka-progress/1");
    expect(f.exportedAt).toBe("2026-11-11T20:00:00.000Z");
    expect(f.collections.items.map((d) => d.id)).toEqual(["a", "b"]);
    expect(f.collections.attempts).toEqual([]);
    expect(f.collections.meta).toEqual([]);
  });

  it("export → import into empty → export gives the same documents", () => {
    const c = {
      items: [doc("i1", "2026-11-10T10:00:00.000Z", { status: "сдано", override: null })],
      attempts: [doc("a1", "2026-11-10T11:00:00.000Z", { answers: [{ q: "x", score: 1 }] })],
      meta: [doc("today", "2026-11-11T06:00:00.000Z", { plan: [] })],
    };
    const file = roundTrip(c);
    const merged = applyPlan({}, planImport({}, file));
    expect(buildExchange(P, merged, new Date(0)).collections).toEqual(buildExchange(P, c, new Date(0)).collections);
  });

  it("rejects foreign, wrong-format and malformed files", () => {
    const ok = buildExchange(P, { items: [doc("i1", "2026-11-10T10:00:00.000Z")] });
    const code = (v: unknown) => { try { parseExchange(v, P); return "ok"; } catch (e) { return (e as ExchangeError).code; } };
    expect(code(ok)).toBe("ok");
    expect(code(null)).toBe("not_exchange");
    expect(code({ hello: 1 })).toBe("not_exchange");
    expect(code({ ...ok, format: "zachetka-progress/2" })).toBe("format");
    expect(code({ ...ok, pack: "other" })).toBe("other_pack");
    expect(code({ ...ok, collections: { items: [doc("../x", "2026-11-10T10:00:00.000Z")] } })).toBe("bad_doc");
    expect(code({ ...ok, collections: { items: [{ id: "i1" }] } })).toBe("ok"); // pre-W5 docs have no stamp
    expect(code({ ...ok, collections: { items: [doc("i1", "not a date")] } })).toBe("bad_doc");
    expect(code({ ...ok, collections: { items: [doc("i1", "2026-11-10T10:00:00.000Z"), doc("i1", "2026-11-10T10:00:00.000Z")] } })).toBe("bad_doc");
  });
});

describe("planImport", () => {
  const local: Collections = {
    items: [doc("i1", "2026-11-10T10:00:00.000Z", { status: "pc" }), doc("i2", "2026-11-10T10:00:00.000Z", { status: "pc" })],
    attempts: [doc("a1", "2026-11-10T10:00:00.000Z")],
    meta: [],
  };

  it("adds missing, takes newer, keeps older, equal and local-only", () => {
    const file = roundTrip({
      items: [
        doc("i1", "2026-11-11T10:00:00.000Z", { status: "phone" }), // newer → replace
        doc("i2", "2026-11-09T10:00:00.000Z", { status: "phone" }), // older → keep
        doc("i3", "2026-11-09T10:00:00.000Z", { status: "phone" }), // new → add
      ],
      attempts: [doc("a1", "2026-11-10T10:00:00.000Z", { answers: [1] }), doc("a2", "2026-11-11T09:00:00.000Z")], // equal → keep; add
    });
    const plan = planImport(local, file);
    expect({ added: plan.added, updated: plan.updated, kept: plan.kept }).toEqual({ added: 2, updated: 1, kept: 2 });
    const out = applyPlan(local, plan);
    expect(out.items.find((d) => d.id === "i1")?.status).toBe("phone");
    expect(out.items.find((d) => d.id === "i1")?.updatedAt).toBe("2026-11-11T10:00:00.000Z");
    expect(out.items.find((d) => d.id === "i2")?.status).toBe("pc");
    expect(out.attempts.find((d) => d.id === "a1")?.answers).toBeUndefined();
    expect(out.attempts.map((d) => d.id).sort()).toEqual(["a1", "a2"]);
  });

  it("never deletes and is idempotent", () => {
    const file = roundTrip({ items: [doc("i3", "2026-11-11T10:00:00.000Z")] });
    const once = applyPlan(local, planImport(local, file));
    expect(once.items.map((d) => d.id).sort()).toEqual(["i1", "i2", "i3"]);
    expect(once.attempts).toHaveLength(1);
    const again = planImport(once, file);
    expect(again.writes).toEqual([]);
    expect(again.kept).toBe(1);
  });

  it("compares instants, not strings; a missing stamp is older than any real one", () => {
    const mine = {
      items: [doc("i1", "2026-11-10T10:00:00Z"), doc("i2", "garbage"), { id: "i3", status: "old" }, { id: "i4", status: "pc" }, doc("i5", "2026-11-10T10:00:00Z")],
    } as Partial<Collections>;
    const file = roundTrip({ items: [
      doc("i1", "2026-11-10T10:00:00.000Z"),          // same instant → ours
      doc("i2", "2026-11-12T00:00:00.000Z"),          // ours unparsable → theirs
      doc("i3", "2026-11-12T00:00:00.000Z", { status: "new" }), // ours unstamped → theirs
      { id: "i4", status: "phone" },                   // neither stamped → ours
      { id: "i5", status: "phone" },                   // theirs unstamped → ours
    ] as any });
    const plan = planImport(mine, file);
    expect(plan.writes.map((w) => w.doc.id)).toEqual(["i2", "i3"]);
    expect(plan.kept).toBe(3);
  });

  it("an old file does not roll anything back", () => {
    const old = roundTrip({ items: [doc("i1", "2026-11-01T00:00:00.000Z", { status: "old" })] });
    expect(planImport(local, old).writes).toEqual([]);
  });
});

describe("isExchangeCapable", () => {
  it("detects the optional capability", () => {
    expect(isExchangeCapable({ exportFile() {}, importFile() {} })).toBe(true);
    expect(isExchangeCapable({ update() {} })).toBe(false);
    expect(isExchangeCapable(null)).toBe(false);
  });
});
