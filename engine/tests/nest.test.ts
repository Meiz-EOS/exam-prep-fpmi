import { describe, expect, it } from "vitest";
import { nestGroups } from "../src/core/nest";

describe("nestGroups", () => {
  it("weeks go under their assignment, order kept, orphans of a missing parent stay on top", () => {
    const out = nestGroups(["АиГ задание 2", "АиГ задание 2 · неделя 1", "АиГ задание 2 · неделя 2", "АиГ контрольные", "Матан задание 3 · неделя 1"]);
    expect(out.map((n) => [n.label, n.children.map((c) => c.label)])).toEqual([
      ["АиГ задание 2", ["неделя 1", "неделя 2"]],
      ["АиГ контрольные", []],
      ["Матан задание 3 · неделя 1", []],
    ]);
  });
  it("a part listed before its parent still nests", () => {
    expect(nestGroups(["A · w1", "A"]).map((n) => [n.name, n.children.length])).toEqual([["A", 1]]);
  });
});
