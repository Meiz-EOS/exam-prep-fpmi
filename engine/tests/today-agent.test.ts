import { describe, expect, it } from "vitest";
import { TodayDocSchema, type BuiltPack } from "../src/content/schema.ts";
import { buildTodayDoc } from "../../tools/agent/today.ts";

describe("today agent document", () => {
  it("builds a schema-valid document from pack, report and plan fixtures", () => {
    const pack = {
      tickets: [{ id: "math-t-0001" }, { id: "math-t-0002" }],
    } as BuiltPack;
    const report = {
      due: [{ cid: 1 }, { cid: 2 }],
      lapses_by_tag: { "math-t-0001": 3, "unknown-t-0001": 8 },
    };
    const plan = [{ id: "p1", text: "Повторить билет", href: "#theory" }];
    const doc = buildTodayDoc(pack, report, plan, "2026-11-09", "2026-11-09T10:00:00.000Z");

    expect(TodayDocSchema.parse(doc)).toEqual({
      date: "2026-11-09",
      plan,
      anki: { at: "2026-11-09T10:00:00.000Z", due: 2, weak: [{ ticket: "math-t-0001", lapses: 3 }] },
    });
  });
});
