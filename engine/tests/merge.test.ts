import { describe, expect, it } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { mergeView } from "../src/core/merge";

const pack: BuiltPack = {
  id: "t", title: "T",
  subjects: [{ id: "aig", name: "АиГ" }, { id: "cpp", name: "C++" }],
  exams: [{ id: "ex-aig", subject: "aig", title: "АиГ", date: "2026-12-26" }],
  items: [
    { id: "aig2-submit", subject: "aig", group: "АиГ задание 2", kind: "дз", title: "Задание 2: сдать тетрадь", soft: "2026-11-10", hard: "2026-11-16", note: "бумага до 17:00" },
    { id: "cpp-string", subject: "cpp", group: "C++ задачи", kind: "задача-cpp", title: "String", soft: "2026-11-11" },
  ],
};

describe("mergeView", () => {
  it("item without a document is not started", () => {
    const v = mergeView(pack, []);
    expect(v.items.find((i) => i.id === "cpp-string")).toMatchObject({ status: "не начато", source: "pack" });
  });
  it("catalog comes from the pack, not from stale v0 fields", () => {
    const v = mergeView(pack, [{ id: "cpp-string", title: "old", soft: "2026-11-09", status: "в работе", order: 1 }]);
    expect(v.items.find((i) => i.id === "cpp-string")).toMatchObject({ title: "String", soft: "2026-11-11", status: "в работе" });
  });
  it("override applies and is reported", () => {
    const v = mergeView(pack, [{ id: "cpp-string", override: { soft: "2026-11-13", hard: "bad" } }]);
    const it = v.items.find((i) => i.id === "cpp-string")!;
    expect(it.soft).toBe("2026-11-13");
    expect(it.override).toEqual({ soft: "2026-11-13" });
  });
  it("author's v0 note is not shown as the student's note; a real note is", () => {
    const a = mergeView(pack, [{ id: "aig2-submit", note: "бумага до 17:00" }]).items[0]!;
    expect(a.note).toBeUndefined();
    const b = mergeView(pack, [{ id: "aig2-submit", note: "не понял 16.40" }]).items[0]!;
    expect(b).toMatchObject({ note: "не понял 16.40", packNote: "бумага до 17:00" });
  });
  it("custom items: explicit and v0-form ones (subject by name)", () => {
    const v = mergeView(pack, [
      { id: "c1", custom: true, subject: "cpp", title: "Защита String", kind: "устная", soft: "2026-11-12" },
      { id: "Xy9", subject: "АиГ", title: "Кр2", kind: "кр", group: "АиГ контрольные" },
    ]);
    const custom = v.items.filter((i) => i.source === "custom");
    expect(custom.map((i) => [i.id, i.subject])).toEqual([["c1", "cpp"], ["Xy9", "aig"]]);
  });
  it("orphans are kept, not dropped", () => {
    const v = mergeView(pack, [{ id: "aig2-w9-99", status: "сдано" }]);
    expect(v.orphans).toEqual([expect.objectContaining({ id: "aig2-w9-99", status: "сдано", source: "orphan" })]);
  });
  it("exam score and bad values", () => {
    const v = mergeView(pack, [{ id: "ex-aig", score: 8 }, { id: "aig2-submit", status: "done", score: {} }]);
    expect(v.exams[0]).toMatchObject({ id: "ex-aig", score: 8 });
    expect(v.items[0]).toMatchObject({ status: "не начато" });
    expect(v.items[0]!.score).toBeUndefined();
  });
});
