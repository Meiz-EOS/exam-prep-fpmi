import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuiltPack, BuiltTest } from "../src/content/schema";
import { readDocs, readAttempts, report } from "../../tools/agent/diff";

const pack: BuiltPack = {
  id: "t", title: "T", subjects: [{ id: "cpp", name: "C++" }], exams: [],
  items: Array.from({ length: 100 }, (_, i) => ({ id: `cpp-${i}`, subject: "cpp", group: "g", kind: "задача-cpp" as const, title: `T${i}` })),
  tests: [
    {
      id: "cpp-entry",
      subject: "cpp",
      title: "C++ Entry",
      kind: "entry",
      minutes: 60,
      reuse: [],
      questions: [
        { id: "cpp-q-1", ticket: "cpp-t1", level: "L1", body: "Q1", points: ["p1", "p2"] },
        { id: "cpp-q-2", ticket: "cpp-t1", level: "L2", body: "Q2", points: ["p1", "p2"] },
      ],
    },
  ],
  tickets: [
    { id: "cpp-t1", subject: "cpp", title: "Ticket 1", key: false },
  ],
  thresholds: {
    ud: { L0: 0.8, L1: 0.7 },
    hor: { L0: 0.8, L1: 0.7, L2: 0.6, keyL2: false },
  },
};

describe("agent diff", () => {
  it("nothing changed", () => {
    const first = report(pack, [], {}, [], {});
    expect(report(pack, [], first.next, [], first.nextAttempts).lines).toEqual(["Изменений нет."]);
  });
  it("reports every kind of change", () => {
    const { next } = report(pack, [{ id: "cpp-1", status: "в работе" }], {}, [], {});
    const r = report(pack, [
      { id: "cpp-1", status: "сдано", note: "защита в пн", score: 5 },
      { id: "cpp-2", override: { soft: "2026-11-20" } },
      { id: "c1", custom: true, subject: "cpp", title: "Устная String" },
      { id: "gone-1", status: "принято" },
    ], next, [], {}).lines.join("\n");
    expect(r).toContain("cpp-1 «T1»: в работе → сдано");
    expect(r).toContain("защита в пн");
    expect(r).toContain("Баллы (1)");
    expect(r).toContain("cpp-2 «T2»");
    expect(r).toContain("(новое)");
    expect(r).toContain("c1 «Устная String»");
    expect(r).toContain("gone-1: принято");
  });
  it("stays short on 100 items with some changes", () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({ id: `cpp-${i}`, status: "сдано" }));
    expect(report(pack, docs, {}, [], {}).lines.length).toBeLessThanOrEqual(40);
  });
  it("reads both saved document shapes", () => {
    const dir = mkdtempSync(join(tmpdir(), "zd-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ status: "сдано" }));
    writeFileSync(join(dir, "b.json"), JSON.stringify({ id: "b", data: { status: "принято" }, version: 3 }));
    expect(readDocs(dir).sort((x, y) => x.id.localeCompare(y.id))).toEqual([{ id: "a", status: "сдано" }, { id: "b", status: "принято" }]);
  });

  describe("attempts", () => {
    const attempt1: ReturnType<typeof readAttempts>[0] = {
      test: "cpp-entry",
      startedAt: "2026-11-01T10:00:00Z",
      finishedAt: "2026-11-01T11:00:00Z",
      answers: [
        { q: "cpp-q-1", at: "2026-11-01T10:10:00Z", text: "Answer one", hits: [0], self: 0.8, gross: false },
        { q: "cpp-q-2", at: "2026-11-01T10:20:00Z", text: "Answer two", hits: [1], self: 0.6, gross: false },
      ],
    };

    it("reports new answers on first run", () => {
      const r = report(pack, [], {}, [attempt1], {});
      const out = r.lines.join("\n");
      expect(out).toContain("Новые ответы (2)");
      expect(out).toContain("cpp-q-1 (cpp-entry): 0.80");
      expect(out).toContain("cpp-q-2 (cpp-entry): 0.60");
      expect(out).toContain("Answer one");
      expect(out).toContain("Answer two");
    });

    it("reports only new answers on second run", () => {
      const { nextAttempts } = report(pack, [], {}, [attempt1], {});
      const attempt2 = {
        ...attempt1,
        answers: [
          ...attempt1.answers,
          { q: "cpp-q-1", at: "2026-11-02T10:10:00Z", text: "Different answer", hits: [0], self: 0.9, gross: false },
        ],
      };
      const r = report(pack, [], {}, [attempt2], nextAttempts);
      const out = r.lines.join("\n");
      expect(out).toContain("Новые ответы (1)");
      expect(out).toContain("Different answer");
      expect(out).not.toContain("Answer one"); // first answer not reported again
    });

    it("reports answers without agent grade", () => {
      const attemptWithAgent = {
        ...attempt1,
        answers: [
          { q: "cpp-q-1", at: "2026-11-01T10:10:00Z", text: "Answer one", hits: [0], self: 0.8, agent: 0.7, gross: false },
          { q: "cpp-q-2", at: "2026-11-01T10:20:00Z", text: "Answer two", hits: [1], self: 0.6, gross: false },
        ],
      };
      const r = report(pack, [], {}, [attemptWithAgent], {});
      const out = r.lines.join("\n");
      expect(out).toContain("Ответы без оценки агента (1)");
      expect(out).toContain("cpp-q-2 (cpp-entry): self=0.60");
      expect(out).not.toContain("cpp-q-1 (cpp-entry): self=");
    });

    it("reports subject readiness line", () => {
      const r = report(pack, [], {}, [attempt1], {});
      const out = r.lines.join("\n");
      expect(out).toContain("Готовность по предметам");
      expect(out).toContain("C++:");
      expect(out).toContain("L0");
      expect(out).toContain("L1");
      expect(out).toContain("L2");
      expect(out).toContain("toUd=");
      expect(out).toContain("toHor=");
    });

    it("output stays under 40 lines for 50 answers across two attempts", () => {
      const manyAnswers = Array.from({ length: 25 }, (_, i) => ({
        q: `cpp-q-${i}`,
        at: `2026-11-01T${String(10 + i).padStart(2, "0")}:00:00Z`,
        text: `Answer ${i}`,
        hits: [0],
        self: 0.5,
        gross: false,
      }));
      const attemptA = { test: "cpp-entry", startedAt: "2026-11-01T10:00:00Z", answers: manyAnswers };
      const attemptB = {
        test: "cpp-entry",
        startedAt: "2026-11-02T10:00:00Z",
        answers: [...manyAnswers, { q: "cpp-q-new", at: "2026-11-02T11:00:00Z", text: "New", hits: [0], self: 0.8, gross: false }],
      };
      const { nextAttempts } = report(pack, [], {}, [attemptA], {});
      const r = report(pack, [], {}, [attemptB], nextAttempts);
      expect(r.lines.length).toBeLessThanOrEqual(40);
    });

    it("reads attempt documents from directory", () => {
      const dir = mkdtempSync(join(tmpdir(), "za-"));
      writeFileSync(join(dir, "att1.json"), JSON.stringify(attempt1));
      writeFileSync(join(dir, "att2.json"), JSON.stringify({ id: "att2", data: attempt1 }));
      const attempts = readAttempts(dir);
      expect(attempts.length).toBe(2);
      expect(attempts[0]!.test).toBe("cpp-entry");
      expect(attempts[1]!.test).toBe("cpp-entry");
    });
  });
});