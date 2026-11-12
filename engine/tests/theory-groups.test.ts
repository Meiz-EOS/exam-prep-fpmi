import { describe, expect, it } from "vitest";
import type { BuiltExamTicket, BuiltTicket } from "../src/content/schema";
import { examCode, groupTheoryByExam } from "../src/ui/modules/theory";

const theorem = (id: string, key = false): BuiltTicket => ({ id, subject: "math", title: id, ...(key ? { key: true } : {}) });
const examTicket = (id: string, includes: string[]): BuiltExamTicket => ({ id, subject: "math", title: `Title ${id}`, confidence: "likely", includes });

describe("groupTheoryByExam", () => {
  it("uses exam includes order, keeps key theorems in place, omits exam tickets without theorems", () => {
    const result = groupTheoryByExam(
      [theorem("a"), theorem("b", true), theorem("c"), theorem("outside")],
      [examTicket("g01", ["c", "missing", "b"]), examTicket("g02", ["a"]), examTicket("g03", ["missing"])],
    );
    expect(result.map(({ exam, theorems }) => [exam?.id ?? null, theorems.map(({ id }) => id)])).toEqual([
      ["g01", ["c", "b"]], ["g02", ["a"]], [null, ["outside"]],
    ]);
  });

  it("shows the exam ticket code without the subject prefix", () => {
    expect(examCode({ ...examTicket("math-b-07", []) })).toBe("b-07");
    expect(examCode(examTicket("g01", []))).toBe("g01");
  });

  it("keeps the previous key-first order when there are no exam tickets", () => {
    const result = groupTheoryByExam([theorem("a"), theorem("b", true)], []);
    expect(result[0]?.theorems.map(({ id }) => id)).toEqual(["b", "a"]);
  });
});
