import { describe, expect, it } from "vitest";
import type { Due } from "../src/core/dates";
import { dueClass, rowMeta } from "../src/ui/modules/sdachi/format";

const t = { score: (s: string) => `балл ${s}` };
const due = (state: Due["state"]): Due => ({ date: "2026-11-10", days: 1, final: true, state });

describe("dueClass", () => {
  it("marks overdue and today as late, soon as soon, the rest plain", () => {
    expect([dueClass(null), dueClass(due("late")), dueClass(due("today")), dueClass(due("soon")), dueClass(due("later"))]).toEqual(["", "late", "late", "soon", ""]);
  });
});

describe("rowMeta", () => {
  it("shows the kind, but not for single problems", () => {
    expect(rowMeta({ kind: "дз" }, t)).toEqual(["дз"]);
    expect(rowMeta({ kind: "дз-задача" }, t)).toEqual([]);
  });
  it("context replaces the kind and hides the pack note", () => {
    expect(rowMeta({ kind: "дз", packNote: "стр. 5" }, t, "АиГ · Задание 2")).toEqual(["АиГ · Задание 2"]);
  });
  it("adds the score, including zero and text scores", () => {
    expect(rowMeta({ kind: "кр", score: 0 }, t)).toEqual(["кр", "балл 0"]);
    expect(rowMeta({ kind: "кр", score: "зачёт" }, t)).toEqual(["кр", "балл зачёт"]);
  });
  it("the student's note wins over the pack note", () => {
    expect(rowMeta({ kind: "дз", note: "сдал скан", packNote: "стр. 5" }, t)).toEqual(["дз", "✎ сдал скан"]);
    expect(rowMeta({ kind: "дз", packNote: "стр. 5" }, t)).toEqual(["дз", "стр. 5"]);
  });
  it("keeps the student's note with a context", () => {
    expect(rowMeta({ note: "n" }, t, "ctx")).toEqual(["ctx", "✎ n"]);
  });
});
