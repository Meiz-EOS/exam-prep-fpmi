import { describe, expect, it } from "vitest";
import type { BuiltTest } from "../src/content/schema.ts";
import { answerScore, cell, questionValue, subjectReady, type Attempt } from "../src/core/ready.ts";

const question = (id: string, ticket = "t-1", level: "L0" | "L1" | "L2" = "L0") => ({ id, ticket, level, body: "Question", points: ["one", "two"] });
const test = (...questions: ReturnType<typeof question>[]): BuiltTest => ({ id: "test", subject: "math", title: "Test", kind: "entry", minutes: 10, reuse: [], questions });
const attempt = (answers: Attempt["answers"]): Attempt => ({ test: "test", startedAt: "2026-11-01T10:00:00Z", answers });
const answer = (q: string, at: string, score: number, extra: Partial<Attempt["answers"][number]> = {}) => ({ q, at, text: "", hits: [], self: score, ...extra });

describe("answerScore", () => {
  it("prefers agent score and otherwise maps gross errors to zero", () => {
    expect(answerScore({ agent: 0.7, self: 1, gross: true })).toBe(0.7);
    expect(answerScore({ self: 0.8, gross: true })).toBe(0);
    expect(answerScore({ self: 0.5 })).toBe(0.5);
  });
});

describe("questionValue and cell", () => {
  it("averages the latest three answers, evicting the oldest", () => {
    const attempts = [attempt([answer("q", "2026-11-01T10:00:00Z", 0)]), attempt([answer("q", "2026-11-02T10:00:00Z", 0.6)]), attempt([answer("q", "2026-11-03T10:00:00Z", 0.9)]), attempt([answer("q", "2026-11-04T10:00:00Z", 1)])];
    expect(questionValue("q", attempts)).toBeCloseTo(0.8333333333);
  });
  it("returns empty for no answers and averages available question values in a cell", () => {
    expect(questionValue("missing", [])).toBeNull();
    const result = cell("t-1", "L0", [test(question("q1"), question("q2"))], [attempt([answer("q1", "2026-11-01T10:00:00Z", 0.8)])]);
    expect(result.value).toBe(0.8);
    expect(result.mastered).toBe(false);
  });
  it("does not master three answers on one Moscow day", () => {
    const data = ["10:00", "12:00", "14:00"].map((time) => attempt([answer("q", `2026-11-01T${time}:00Z`, 0.9)]));
    expect(cell("t-1", "L0", [test(question("q"))], data).mastered).toBe(false);
  });
  it("uses Moscow calendar days at UTC day boundaries and requires each score >= 0.8", () => {
    const questions = [question("q")];
    const data = [
      attempt([answer("q", "2026-11-01T20:30:00Z", 0.9)]),
      attempt([answer("q", "2026-11-02T20:30:00Z", 0.9)]),
      attempt([answer("q", "2026-11-03T20:30:00Z", 0.8)]),
    ];
    expect(cell("t-1", "L0", [test(...questions)], data).mastered).toBe(true);
    data[2]!.answers[0]!.self = 0.79;
    expect(cell("t-1", "L0", [test(...questions)], data).mastered).toBe(false);
  });
});

describe("subjectReady", () => {
  const pack = {
    tickets: [
      { id: "t-1", subject: "math", title: "One" },
      { id: "t-2", subject: "math", title: "Two", key: true },
    ],
    tests: [test(question("q1", "t-1"), question("q2", "t-2"), question("q3", "t-2", "L1"), question("q4", "t-2", "L2"))],
    thresholds: { ud: { L0: 0.5, L1: 0 }, hor: { L0: 0.5, L1: 0.5, L2: 0.75, keyL2: true } },
  };
  it("reports threshold boundaries and requires every key ticket at L2", () => {
    const attempts = ["01", "02", "03"].flatMap((day) => [
      attempt([answer("q1", `2026-11-${day}T10:00:00Z`, 1)]),
      attempt([answer("q2", `2026-11-${day}T10:00:00Z`, 0)]),
      attempt([answer("q3", `2026-11-${day}T10:00:00Z`, 1)]),
      attempt([answer("q4", `2026-11-${day}T10:00:00Z`, 0.8)]),
    ]);
    const summary = subjectReady("math", pack, attempts, new Date("2026-11-04T00:00:00Z"));
    expect(summary.shares.L0).toBe(0.5);
    expect(summary.toUd).toBe(true);
    expect(summary.toHor).toBe(false);
    expect(summary.missing.hor.tickets).toContain("t-2");
    expect(summary.cells.find((item) => item.ticket === "t-2" && item.level === "L2")?.mastered).toBe(true);
  });
  it("applies an old ticket id remap when aggregating answers", () => {
    const remappedPack = { ...pack, tickets: [{ id: "t-new", subject: "math", title: "New" }], tests: [test(question("q-old", "t-old"))] };
    const attempts = ["01", "02", "03"].map((day) => attempt([answer("q-old", `2026-11-${day}T10:00:00Z`, 0.9)]));
    expect(subjectReady("math", remappedPack, attempts, new Date(), { "t-old": "t-new" }).cells[0]).toMatchObject({ ticket: "t-new", mastered: true });
  });
  it("excludes L1 and L2 for tickets capped at L0", () => {
    const cappedPack = {
      tickets: [
        { id: "t-1", subject: "math", title: "One" },
        { id: "t-2", subject: "math", title: "Two" },
        { id: "t-3", subject: "math", title: "Only L0", maxLevel: "L0" as const },
      ],
      tests: [test(
        question("q1", "t-1"), question("q1-l1", "t-1", "L1"),
        question("q2", "t-2"), question("q2-l1", "t-2", "L1"),
        question("q3", "t-3"), question("q3-l1", "t-3", "L1"),
      )],
      thresholds: { ud: { L0: 1, L1: 1 }, hor: { L0: 1, L1: 1, L2: 0, keyL2: false } },
    };
    const attempts = ["01", "02", "03"].flatMap((day) => ["q1", "q1-l1", "q2", "q2-l1", "q3"].map((id) =>
      attempt([answer(id, `2026-11-${day}T10:00:00Z`, 0.9)])));
    const result = subjectReady("math", cappedPack, attempts, new Date());
    expect(result.shares.L0).toBe(1);
    expect(result.shares.L1).toBe(1);
    expect(result.cells.some((item) => item.ticket === "t-3" && item.level === "L1")).toBe(false);
    expect(result.toUd).toBe(true);
  });
  it("aggregates exam cells across included theorems, including mastery and key status", () => {
    const examPack = { ...pack, tickets: [{ id: "a", subject: "math", title: "A", key: true }, { id: "b", subject: "math", title: "B" }],
      exam: [{ id: "exam-a", subject: "math", title: "Exam A", confidence: "sure" as const, includes: ["a", "b"] }],
      tests: [test(question("qa", "a"), question("qb", "b"))] };
    const attempts = ["01", "02", "03"].flatMap((day) => [attempt([answer("qa", `2026-11-${day}T10:00:00Z`, 0.9)])]);
    const result = subjectReady("math", examPack, attempts, new Date());
    expect(result.cells.find((item) => item.ticket === "exam-a" && item.level === "L0")).toMatchObject({ value: 0.9, mastered: false });
    expect(result.cells.find((item) => item.ticket === "exam-a" && item.level === "L2")?.mastered).toBe(false);
  });
  it("keeps exam L2 for uncapped included theorems and omits it when all are maxLevel L1", () => {
    const cappedPack = {
      tickets: [
        { id: "capped", subject: "math", title: "Definition", maxLevel: "L1" as const },
        { id: "ordinary", subject: "math", title: "Theorem" },
      ],
      exam: [
        { id: "mixed", subject: "math", title: "Mixed", confidence: "sure" as const, includes: ["capped", "ordinary"] },
        { id: "definitions", subject: "math", title: "Definitions", confidence: "sure" as const, includes: ["capped"] },
      ],
      tests: [test(question("q-capped", "capped", "L2"), question("q-ordinary", "ordinary", "L2"))],
      thresholds: { ud: { L0: 0, L1: 0 }, hor: { L0: 0, L1: 0, L2: 1, keyL2: false } },
    };
    const attempts = ["01", "02", "03"].flatMap((day) => ["q-capped", "q-ordinary"].map((id) => attempt([answer(id, `2026-11-${day}T10:00:00Z`, 0.9)])));
    const result = subjectReady("math", cappedPack, attempts, new Date());
    expect(result.cells.find((item) => item.ticket === "mixed" && item.level === "L2")).toMatchObject({ value: 0.9 });
    expect(result.cells.some((item) => item.ticket === "definitions" && item.level === "L2")).toBe(false);
    expect(result.shares.L2).toBe(1);
  });
  it("does not let a key theorem capped at L1 satisfy the L2 requirement", () => {
    const keyPack = {
      tickets: [{ id: "key", subject: "math", title: "Key definition", key: true, maxLevel: "L1" as const }],
      exam: [{ id: "exam-key", subject: "math", title: "Key exam", confidence: "sure" as const, includes: ["key"] }],
      tests: [test(question("q-key", "key", "L0"))],
      thresholds: { ud: { L0: 0, L1: 0 }, hor: { L0: 0, L1: 0, L2: 0, keyL2: true } },
    };
    const result = subjectReady("math", keyPack, [], new Date());
    expect(result.cells.some((item) => item.ticket === "exam-key" && item.level === "L2")).toBe(false);
    expect(result.toHor).toBe(false);
  });
});
