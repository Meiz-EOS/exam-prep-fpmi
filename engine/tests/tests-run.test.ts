import { describe, expect, it } from "vitest";
import type { BuiltPack, BuiltTest, Question } from "../src/content/schema";
import { MemoryStore } from "../src/store/memory";
import {
  testQuestions,
  selfScore,
  startRun,
  appendAnswer,
  toAttempt,
  nextIndex,
  attemptsOf,
  type Attempt,
  type Answer,
} from "../src/ui/modules/tests/run";

const tick = () => new Promise((r) => setTimeout(r, 0));

function makePack(): BuiltPack {
  const q0: Question = { id: "m-q0", ticket: "m-t1", level: "L0", body: "b", points: ["a", "b", "c"] };
  const q1: Question = { id: "m-q1", ticket: "m-t1", level: "L0", body: "b", points: ["a", "b", "c"] };
  const q2: Question = { id: "m-q2", ticket: "m-t1", level: "L0", body: "b", points: ["a", "b", "c"] };

  const testEntry: BuiltTest = {
    id: "m-entry",
    subject: "m",
    title: "Entry",
    kind: "entry",
    minutes: 10,
    reuse: ["m-q0"],
    questions: [q1, q2],
  };

  const testOther: BuiltTest = {
    id: "m-other",
    subject: "m",
    title: "Other",
    kind: "entry",
    minutes: 10,
    reuse: [],
    questions: [q0],
  };

  return {
    id: "m",
    title: "Pack",
    subjects: [{ id: "m", name: "Subject" }],
    exams: [],
    items: [],
    thresholds: { ud: { L0: 0.5, L1: 0.6 }, hor: { L0: 0.5, L1: 0.6, L2: 0.7, keyL2: false } },
    tests: [testEntry, testOther],
  };
}

describe("run module", () => {
  const pack = makePack();
  const testEntry = pack.tests!.find((t) => t.id === "m-entry")!;
  const questions = testQuestions(pack, testEntry);

  it("testQuestions returns reused first then own, drops duplicates", () => {
    expect(questions.map((q) => q.id)).toEqual(["m-q0", "m-q1", "m-q2"]);
  });

  it("selfScore computes ratio and zeroes on gross", () => {
    expect(selfScore(2, 3, false)).toBe(0.67);
    expect(selfScore(3, 3, true)).toBe(0);
  });

  it("startRun creates attempt with test, startedAt, empty answers", async () => {
    const store = new MemoryStore();
    let resolve: (attempt: Attempt) => void;
    const promise = new Promise<Attempt>((res) => { resolve = res; });
    store.subscribe("attempts", (snap) => {
      if (snap.docs.length) resolve(toAttempt(snap.docs[0]!));
    });
    const id = await startRun(store, "m-entry");
    await tick();
    const attempt = await promise;
    expect(attempt.id).toBe(id);
    expect(attempt.test).toBe("m-entry");
    expect(attempt.startedAt).toBeTruthy();
    expect(attempt.answers).toEqual([]);
    expect(attempt.finishedAt).toBeUndefined();
  });

  it("appendAnswer writes full answers array with hits and self, no finishedAt while not all answered", async () => {
    const store = new MemoryStore();
    const id = await startRun(store, "m-entry");
    await tick();

    const a1: Answer = { q: "m-q0", text: "ans", hits: [0, 1], self: 0.67, at: new Date().toISOString() };
    const answers1 = await appendAnswer(store, id, [], a1, questions.length);
    expect(answers1).toEqual([a1]);

    let attempt: Attempt | undefined;
    store.subscribe("attempts", (snap) => {
      const d = snap.docs.find((doc) => doc.id === id);
      if (d) attempt = toAttempt(d);
    });
    await tick();
    expect(attempt!.answers).toEqual([a1]);
    expect(attempt!.finishedAt).toBeUndefined();
  });

  it("after last answer finishedAt equals that answer's at", async () => {
    const store = new MemoryStore();
    const id = await startRun(store, "m-entry");
    await tick();

    const a1: Answer = { q: "m-q0", text: "ans", hits: [0], self: 0.33, at: new Date().toISOString() };
    await appendAnswer(store, id, [], a1, questions.length);
    await tick();

    const a2: Answer = { q: "m-q1", text: "ans", hits: [0, 1], self: 0.67, at: new Date().toISOString() };
    await appendAnswer(store, id, [a1], a2, questions.length);
    await tick();

    const a3: Answer = { q: "m-q2", text: "ans", hits: [0, 1, 2], self: 1, at: new Date().toISOString() };
    const finalAnswers = await appendAnswer(store, id, [a1, a2], a3, questions.length);
    expect(finalAnswers).toEqual([a1, a2, a3]);

    let attempt: Attempt | undefined;
    store.subscribe("attempts", (snap) => {
      const d = snap.docs.find((doc) => doc.id === id);
      if (d) attempt = toAttempt(d);
    });
    await tick();
    expect(attempt!.finishedAt).toBe(a3.at);
    expect(attempt!.answers).toEqual([a1, a2, a3]);
  });

  it("resume: toAttempt + nextIndex equals 1 after one answer, equals length when all answered", async () => {
    const store = new MemoryStore();
    const id = await startRun(store, "m-entry");
    await tick();

    const a1: Answer = { q: "m-q0", text: "ans", hits: [0], self: 0.33, at: new Date().toISOString() };
    await appendAnswer(store, id, [], a1, questions.length);
    await tick();

    let attempt: Attempt | undefined;
    store.subscribe("attempts", (snap) => {
      const d = snap.docs.find((doc) => doc.id === id);
      if (d) attempt = toAttempt(d);
    });
    await tick();

    const resumed = attempt!;
    expect(nextIndex(questions, resumed.answers)).toBe(1);

    const a2: Answer = { q: "m-q1", text: "ans", hits: [0, 1], self: 0.67, at: new Date().toISOString() };
    await appendAnswer(store, id, [a1], a2, questions.length);
    await tick();

    const a3: Answer = { q: "m-q2", text: "ans", hits: [0, 1, 2], self: 1, at: new Date().toISOString() };
    await appendAnswer(store, id, [a1, a2], a3, questions.length);
    await tick();

    store.subscribe("attempts", (snap) => {
      const d = snap.docs.find((doc) => doc.id === id);
      if (d) attempt = toAttempt(d);
    });
    await tick();

    const final = attempt!;
    expect(nextIndex(questions, final.answers)).toBe(questions.length);
  });

  it("attemptsOf picks the unfinished attempt as open", async () => {
    const store = new MemoryStore();
    const id1 = await startRun(store, "m-entry", new Date("2026-11-01T10:00:00Z"));
    await tick();

    const a1: Answer = { q: "m-q0", text: "ans", hits: [0], self: 0.33, at: new Date().toISOString() };
    await appendAnswer(store, id1, [], a1, questions.length);
    await tick();

    const id2 = await startRun(store, "m-entry", new Date("2026-11-02T10:00:00Z"));
    await tick();

    let allAttempts: Attempt[] = [];
    store.subscribe("attempts", (snap) => {
      allAttempts = snap.docs.map(toAttempt);
    });
    await tick();

    const { latest, open } = attemptsOf(allAttempts, "m-entry");
    expect(latest?.id).toBe(id2);
    expect(open?.id).toBe(id2);
    expect(open?.finishedAt).toBeUndefined();
  });
});