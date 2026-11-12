import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildPack } from "../../tools/pack/build-pack";
import { parseTestMd } from "../../tools/pack/parse-md";
import { parseCardsMd, parseTheoryMd } from "../../tools/pack/parse-md";
import { ticketTestGaps, ticketTestMinutes, topicTestGaps, topicTestMinutes } from "../src/content/coverage";
import { TestMetaSchema } from "../src/content/schema";

const fixture = (name: string) => resolve("engine/tests/fixtures", name);

describe("parseTestMd", () => {
  it("requires covers for topic tests and forbids it for other kinds", () => {
    const base = { id: "topic", title: "Topic", minutes: 20 };
    expect(TestMetaSchema.safeParse({ ...base, kind: "topic" }).success).toBe(false);
    expect(TestMetaSchema.safeParse({ ...base, kind: "entry", covers: ["math-t-1"] }).success).toBe(false);
    expect(TestMetaSchema.safeParse({ ...base, kind: "topic", covers: ["math-t-1"] }).success).toBe(true);
  });
  it("allows level only on ticket tests (Р-44)", () => {
    const base = { id: "test", title: "Test", minutes: 8, level: "L2" };
    expect(TestMetaSchema.safeParse({ ...base, kind: "ticket", exam: "exam-a" }).success).toBe(true);
    expect(TestMetaSchema.safeParse({ ...base, kind: "entry" }).success).toBe(false);
  });
  it("parses front-matter, questions and key points", () => {
    const { meta, questions } = parseTestMd("---\nid: t\n---\n## q-1\nticket: a-1 · level: L1\nBody\n\nmore\n### Эталон\n- one\n- two\n  tail\n");
    expect(meta).toEqual({ id: "t" });
    expect(questions).toEqual([{ id: "q-1", ticket: "a-1", level: "L1", body: "Body\n\nmore", points: ["one", "two tail"] }]);
  });

  it("rejects a question without ticket line or Эталон", () => {
    expect(() => parseTestMd("---\nid: t\n---\n## q-1\nBody\n")).toThrow(/q-1/);
    expect(() => parseTestMd("---\nid: t\n---\n## q-1\nticket: a · level: L0\nBody\n")).toThrow(/q-1.*Эталон/);
  });
});

describe("knowledge pack building", () => {
  it("parses and builds theory, validating ticket and dependency ownership", () => {
    expect(parseTheoryMd("## math-t-1\n### Формулировка\nLimit exists.\n### Скелет\n1. Start\n2. Bound\n3. Finish\n### Опирается на\nmath-t-2").entries[0]).toEqual({ ticket: "math-t-1", formulation: "Limit exists.", skeleton: ["Start", "Bound", "Finish"], reliesOn: ["math-t-2"] });
    const pack = buildPack(fixture("pack-theory"));
    expect(pack.theory).toEqual([{ ticket: "math-t-1", subject: "math", formulation: "Limit exists.", skeleton: ["Start", "Bound", "Finish"], reliesOn: ["math-t-2"] }]);
  });

  it("parses and builds cards with ticket sources", () => {
    expect(parseCardsMd("---\ndeck: Limits\ntickets: [math-t-1]\n---\n## math-c-1\nQuestion\n---\nAnswer\n")).toEqual({ meta: { deck: "Limits", tickets: ["math-t-1"] }, cards: [{ id: "math-c-1", question: "Question", answer: "Answer" }] });
    expect(parseCardsMd("---\ndeck: Limits\ntickets: [math-t-1]\n---\n## math-c-2 · math-t-1, math-t-2\nQ\n---\nA\n").cards[0]).toEqual({ id: "math-c-2", question: "Q", answer: "A", tickets: ["math-t-1", "math-t-2"] });
    const pack = buildPack(fixture("pack-cards"));
    expect(pack.cards).toEqual([{ id: "math-c-1", deck: "Пределы", subject: "math", tickets: ["math-t-1"], question: "Определите предел.", answer: "$$x < y & z$$", source: "math.tex:1-2" }]);
  });

  it("rejects card ticket references that are missing or belong to another subject", () => {
    expect(() => buildPack(fixture("pack-cards-bad-ticket"))).toThrow(/limits\.md:\d+: карточка "math-c-1" ссылается на неизвестный тикет "math-t-404"/);
    expect(() => buildPack(fixture("pack-cards-cross-ticket"))).toThrow(/limits\.md:\d+: карточка "math-c-1" ссылается на тикет .* другого предмета/);
  });

  it("builds tickets, tests and thresholds", () => {
    const pack = buildPack(fixture("pack-knowledge"));
    expect(pack.thresholds?.hor.keyL2).toBe(true);
    expect(pack.tickets).toHaveLength(2);
    expect(pack.tickets?.[1]).toMatchObject({ id: "math-t-0207", subject: "math", key: true, provisional: true, src: "math.tex:612-640" });
    expect(pack.remap).toEqual({ "math-old-1": "math-t-0201" });
    expect(pack.tests?.map((test) => test.id)).toEqual(["math-entry", "math-retest"]);
    const entry = pack.tests![0]!;
    expect(entry.questions).toHaveLength(2);
    expect(entry.questions[0]).toMatchObject({ id: "math-q-001", ticket: "math-t-0201", level: "L0" });
    expect(entry.questions[0]!.body).toContain("## not a heading");
    expect(entry.questions[0]!.points).toEqual(["$\\forall \\varepsilon>0$", "$\\exists N$ continued line", "negation"]);
    expect(pack.tests![1]!.reuse).toEqual(["math-q-001"]);
  });

  it("builds optional exam tickets", () => {
    expect(buildPack(fixture("pack-exam")).exam).toEqual([
      { id: "exam-a", title: "Exam A", confidence: "sure", includes: ["math-a"], subject: "math" },
      { id: "exam-b", title: "Exam B", confidence: "likely", includes: [], subject: "math" },
    ]);
  });

  it("rejects invalid exam references, ownership, duplicate ids and theorem reuse with path and id", () => {
    const cases: [string, string, RegExp][] = [
      ["unknown", "tickets:\n  - { id: ex-1, title: A, confidence: sure, includes: [missing] }\n", /exam[\\/]math\.yaml:2: билет "ex-1" включает неизвестный тикет "missing"/],
      ["other-subject", "tickets:\n  - { id: ex-1, title: A, confidence: sure, includes: [phys-t] }\n", /exam[\\/]math\.yaml:2: билет "ex-1" включает тикет "phys-t" другого предмета/],
      ["reuse", "tickets:\n  - { id: ex-1, title: A, confidence: sure, includes: [math-a] }\n  - { id: ex-2, title: B, confidence: sure, includes: [math-a] }\n", /exam[\\/]math\.yaml:3: билет "ex-2": тикет "math-a" уже входит в другой экзаменационный билет/],
      ["duplicate", "tickets:\n  - { id: exam-math, title: A, confidence: sure, includes: [math-a] }\n", /exam[\\/]math\.yaml:2: id "exam-math" повторяется/],
    ];
    for (const [name, content, pattern] of cases) {
      const dir = mkdtempSync(`${tmpdir()}/pack-exam-`);
      try {
        cpSync(fixture("pack-exam"), dir, { recursive: true });
        if (name === "other-subject") {
          const packPath = `${dir}/pack.yaml`;
          writeFileSync(packPath, readFileSync(packPath, "utf8").replace("  - id: math\n    name: Math\n", "  - id: math\n    name: Math\n  - id: phys\n    name: Physics\n"));
          writeFileSync(`${dir}/tickets/phys.yaml`, "tickets:\n  - { id: phys-t, title: Physics }\n");
        }
        writeFileSync(`${dir}/exam/math.yaml`, content);
        expect(() => buildPack(dir), name).toThrow(pattern);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    const dir = mkdtempSync(`${tmpdir()}/pack-exam-subject-`);
    try {
      cpSync(fixture("pack-exam"), dir, { recursive: true });
      writeFileSync(`${dir}/exam/ghost.yaml`, "tickets: []\n");
      expect(() => buildPack(dir)).toThrow(/exam[\\/]ghost\.yaml: предмет "ghost" не описан/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("builds a pack without tickets and tests as before", () => {
    const pack = buildPack(fixture("pack-valid"));
    expect(pack).not.toHaveProperty("tickets");
    expect(pack).not.toHaveProperty("tests");
    expect(pack).not.toHaveProperty("thresholds");
  });

  it.each([
    ["pack-kn-bad-ticket", /entry\.md.*math-q-002.*math-t-9999/],
    ["pack-kn-bad-level", /entry\.md.*math-q-002/],
    ["pack-kn-few-points", /entry\.md.*math-q-002/],
    ["pack-kn-dup-id", /retest\.md:\d+: id "math-q-001" повторяется/],
    ["pack-kn-bad-reuse", /retest\.md.*math-retest.*math-q-777/],
    ["pack-kn-bad-remap", /math\.remap\.yaml.*math-old-2.*math-t-4040/],
    ["pack-kn-current-remap", /math\.remap\.yaml:\d+: старый id "math-t-0201" — это текущий id тикета/],
    ["pack-kn-dup-ticket", /tickets[\\/]math\.yaml:\d+: id "math-t-0201" повторяется/],
    ["pack-kn-bad-ticket-file", /tickets[\\/]math\.yaml.*math-t-0207/],
    ["pack-kn-cross-reuse", /phys[\\/]entry\.md:\d+: тест "phys-entry": reuse ссылается на вопрос "math-q-001" другого предмета/],
    ["pack-theory-bad-ticket", /math[\\/]01\.md:1: запись теории про неизвестный тикет "math-t-404"/],
    ["pack-theory-cross-ticket", /math[\\/]01\.md:\d+: запись теории "math-t-1": «Опирается на» — тикет .* другого предмета/],
    ["pack-theory-few-steps", /math[\\/]01\.md:1: поле "skeleton" — не меньше 3 элементов, получено 2 \(тикет math-t-1\)/],
    ["pack-theory-bad-relation", /math[\\/]01\.md:\d+: запись теории "math-t-1": «Опирается на» — неизвестный тикет "math-t-404"/],
    ["pack-theory-cross-relation", /math[\\/]01\.md:\d+: запись теории "math-t-1": «Опирается на» — тикет .* другого предмета/],
    ["pack-theory-duplicate", /02\.md:\d+: теория для тикета "math-t-1" уже есть/],
  ])("rejects %s with path and id", (name, pattern) => {
    expect(() => buildPack(fixture(name))).toThrow(pattern);
  });
});

describe("ticket tests (Р-23, Р-24)", () => {
  const withFixture = (edit: (dir: string) => void, check: (dir: string) => void) => {
    const dir = mkdtempSync(`${tmpdir()}/pack-ticket-`);
    try { cpSync(fixture("pack-ticket-test"), dir, { recursive: true }); edit(dir); check(dir); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const replaceIn = (path: string, from: string, to: string) => writeFileSync(path, readFileSync(path, "utf8").replace(from, to));

  it("builds a ticket test bound to its exam ticket, complete at L0 and L1", () => {
    const pack = buildPack(fixture("pack-ticket-test"));
    const test = pack.tests!.find((item) => item.id === "exam-a-test")!;
    expect(test).toMatchObject({ kind: "ticket", exam: "exam-a", reuse: ["math-q-001"] });
    expect(pack.tests!.find((item) => item.id === "math-entry")!.exam).toBeUndefined();
    expect(ticketTestGaps(pack.tests!, pack.exam!)).toEqual([]);
  });

  it("reports theorems missing a level, but not exam tickets without a test", () => {
    withFixture((dir) => replaceIn(`${dir}/tests/math/a.md`, "ticket: math-b · level: L1", "ticket: math-b · level: L0"), (dir) => {
      const pack = buildPack(dir);
      expect(ticketTestGaps(pack.tests!, pack.exam!)).toEqual(["exam-a-test: math-b has no L1 question"]);
    });
  });
  it("finds L2 gaps, excludes maxLevel L1, and charges 8 minutes (Р-43, Р-44)", () => {
    const l2 = { id: "l2", subject: "math", title: "L2", kind: "ticket" as const, level: "L2" as const, exam: "exam-a", minutes: 8, reuse: [], questions: [
      { id: "l2q", ticket: "math-a", level: "L2" as const, body: "Proof", points: ["one", "two"] },
    ] };
    const exam = [{ id: "exam-a", subject: "math", title: "A", confidence: "sure" as const, includes: ["math-a", "math-b"] }];
    const tickets = [{ id: "math-a", subject: "math", title: "A" }, { id: "math-b", subject: "math", title: "B", maxLevel: "L1" as const }];
    expect(ticketTestGaps([l2], exam, tickets)).toEqual([]);
    expect(ticketTestGaps([{ ...l2, questions: [] }], exam, tickets)).toContain("l2: math-a has no L2 question");
    expect(ticketTestMinutes(l2, [l2])).toBe(8);
  });

  it("rejects bad ticket tests with path and id", () => {
    const a = (dir: string) => `${dir}/tests/math/a.md`;
    const cases: [string, (dir: string) => void, RegExp][] = [
      ["no exam", (dir) => replaceIn(a(dir), "exam: exam-a\n", ""), /a\.md:\d+: для kind: ticket нужно поле "exam" \(тест exam-a-test\)/],
      ["exam on entry", (dir) => replaceIn(`${dir}/tests/math/entry.md`, "kind: entry\n", "kind: entry\nexam: exam-a\n"), /entry\.md:\d+: поле "exam" допустимо только при kind: ticket.*\(тест math-entry\)/],
      ["unknown exam", (dir) => replaceIn(a(dir), "exam: exam-a", "exam: exam-z"), /a\.md:\d+: тест "exam-a-test" ссылается на неизвестный экзаменационный билет "exam-z"/],
      ["foreign theorem", (dir) => replaceIn(a(dir), "exam: exam-a", "exam: exam-b"), /a\.md:\d+: тест "exam-a-test": вопрос "math-q-001" спрашивает про тикет "math-a", которого нет в билете "exam-b"/],
      ["two tests", (dir) => writeFileSync(`${dir}/tests/math/a2.md`, "---\nid: exam-a-test2\ntitle: X\nkind: ticket\nexam: exam-a\nminutes: 2\n---\n"), /a2\.md:\d+: тест "exam-a-test2": у экзаменационного билета "exam-a" уже есть тест "exam-a-test"/],
    ];
    for (const [name, edit, pattern] of cases) withFixture(edit, (dir) => expect(() => buildPack(dir), name).toThrow(pattern));
  });

  it("rejects L1 questions in L2 tests and repeated tickets across L2 parts (Р-44)", () => {
    withFixture((dir) => {
      const file = `${dir}/tests/math/a.md`;
      replaceIn(file, "id: exam-a-test", "id: exam-a-test\nlevel: L2");
    }, (dir) => expect(() => buildPack(dir)).toThrow(/в L2-тесте вопрос "math-q-001" должен быть уровня L2/));
    withFixture((dir) => {
      writeFileSync(`${dir}/tests/math/a.md`, "---\nid: exam-a-l2a\ntitle: L2a\nkind: ticket\nlevel: L2\nexam: exam-a\nminutes: 8\n---\n## math-q-201\nticket: math-a · level: L2\nProof\n### Эталон\n- one\n- two\n");
      writeFileSync(`${dir}/tests/math/a2.md`, "---\nid: exam-a-l2b\ntitle: L2b\nkind: ticket\nlevel: L2\nexam: exam-a\nminutes: 8\n---\n## math-q-202\nticket: math-a · level: L2\nProof\n### Эталон\n- one\n- two\n");
    }, (dir) => expect(() => buildPack(dir)).toThrow(/тикет "math-a" повторяется в частях L2/));
  });

  it("rejects key tickets capped below L2 (Р-43)", () => {
    withFixture((dir) => replaceIn(`${dir}/tickets/math.yaml`, "key: true }", "key: true, maxLevel: L1 }"), (dir) => {
      expect(() => buildPack(dir)).toThrow(/тикет "math-a" помечен key: true, но maxLevel: L1/);
    });
  });

  it("rejects a ticket test bound to an exam ticket of another subject", () => {
    withFixture((dir) => {
      replaceIn(`${dir}/pack.yaml`, "  - id: math\n    name: Math\n", "  - id: math\n    name: Math\n  - id: phys\n    name: Physics\n");
      writeFileSync(`${dir}/tickets/phys.yaml`, "tickets:\n  - { id: phys-t, title: Physics }\n");
      writeFileSync(`${dir}/exam/phys.yaml`, "tickets:\n  - { id: exam-p, title: P, confidence: sure, includes: [phys-t] }\n");
      writeFileSync(`${dir}/tests/math/p.md`, "---\nid: math-p-test\ntitle: X\nkind: ticket\nexam: exam-p\nminutes: 2\n---\n");
    }, (dir) => expect(() => buildPack(dir)).toThrow(/p\.md:\d+: тест "math-p-test" ссылается на экзаменационный билет "exam-p" другого предмета \(phys\)/));
  });
});

describe("topic tests (Р-36)", () => {
  const replaceIn = (path: string, from: string, to: string) => writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
  const topic = (id: string, covers: string, body: string) => `---\nid: ${id}\ntitle: T\nkind: topic\ncovers: [${covers}]\nminutes: 6\nreuse: [math-q-001]\n---\n${body}`;
  const l1A = "## math-q-201\nticket: math-a · level: L1\nSketch A.\n### Эталон\n- one\n- two\n";
  const withTopic = (edit: (dir: string) => void, check: (dir: string) => void) => {
    const dir = mkdtempSync(`${tmpdir()}/pack-topic-`);
    try {
      cpSync(fixture("pack-ticket-test"), dir, { recursive: true });
      writeFileSync(`${dir}/tests/math/topic.md`, topic("math-topic-a", "math-a", l1A));
      edit(dir); check(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it("builds a complete topic test", () => {
    withTopic(() => {}, (dir) => {
      const pack = buildPack(dir);
      expect(pack.tests!.find((test) => test.id === "math-topic-a")).toMatchObject({ kind: "topic", covers: ["math-a"] });
      expect(topicTestGaps(pack.tests!, pack.tickets!)).toEqual([]);
    });
  });

  it("finds a missing L1, except for tickets with maxLevel L0", () => {
    const noL1 = (dir: string) => writeFileSync(`${dir}/tests/math/topic.md`, topic("math-topic-a", "math-a", ""));
    withTopic(noL1, (dir) => {
      const pack = buildPack(dir);
      expect(topicTestGaps(pack.tests!, pack.tickets!)).toEqual(["math-topic-a: math-a has no L1 question"]);
    });
    withTopic((dir) => { noL1(dir); replaceIn(`${dir}/tickets/math.yaml`, "key: true }", "key: false, maxLevel: L0 }"); }, (dir) => {
      const pack = buildPack(dir);
      expect(topicTestGaps(pack.tests!, pack.tickets!)).toEqual([]);
    });
  });

  it("rejects bad topic tests with path and id", () => {
    const cases: [string, (dir: string) => void, RegExp][] = [
      ["no covers", (dir) => replaceIn(`${dir}/tests/math/topic.md`, "covers: [math-a]\n", ""), /topic\.md:\d+: для kind: topic нужно поле "covers" \(тест math-topic-a\)/],
      ["covers on entry", (dir) => replaceIn(`${dir}/tests/math/entry.md`, "kind: entry\n", "kind: entry\ncovers: [math-a]\n"), /entry\.md:\d+: поле "covers" допустимо только при kind: topic.*\(тест math-entry\)/],
      ["unknown ticket", (dir) => replaceIn(`${dir}/tests/math/topic.md`, "covers: [math-a]", "covers: [math-a, math-z]"), /topic\.md:\d+: тест "math-topic-a": covers содержит неизвестный тикет "math-z"/],
      ["question outside covers", (dir) => replaceIn(`${dir}/tests/math/topic.md`, "covers: [math-a]", "covers: [math-b]"), /topic\.md:\d+: тест "math-topic-a": вопрос "math-q-001" спрашивает про тикет "math-a", которого нет в covers/],
      ["double coverage", (dir) => writeFileSync(`${dir}/tests/math/topic2.md`, "---\nid: math-topic-a2\ntitle: T\nkind: topic\ncovers: [math-a]\nminutes: 2\n---\n"), /тикет "math-a" уже входит в тему "math-topic-a"/],
    ];
    for (const [name, edit, pattern] of cases) withTopic(edit, (dir) => expect(() => buildPack(dir), name).toThrow(pattern));
  });

  const l2Topic = (id: string, covers: string, body: string, minutes = 8) => `---\nid: ${id}\ntitle: T L2\nkind: topic\nlevel: L2\ncovers: [${covers}]\nminutes: ${minutes}\n---\n${body}`;
  const l2A = "## math-q-301\nticket: math-a · level: L2\nProve A.\n### Эталон\n- one\n- two\n";
  const writeL2 = (dir: string, body = l2Topic("math-topic-a-l2", "math-a", l2A)) => writeFileSync(`${dir}/tests/math/topic-l2.md`, body);

  it("builds an L2 topic test next to its parent: L2 coverage and 8 minutes per question (Р-51)", () => {
    withTopic((dir) => writeL2(dir), (dir) => {
      const pack = buildPack(dir);
      const l2 = pack.tests!.find((test) => test.id === "math-topic-a-l2")!;
      expect(l2).toMatchObject({ kind: "topic", level: "L2", covers: ["math-a"] });
      expect(topicTestGaps(pack.tests!, pack.tickets!)).toEqual([]);
      expect(topicTestMinutes(l2, pack.tests!)).toBe(8);
    });
    withTopic((dir) => writeL2(dir, l2Topic("math-topic-a-l2", "math-a", "")), (dir) => {
      const pack = buildPack(dir);
      expect(topicTestGaps(pack.tests!, pack.tickets!)).toEqual(["math-topic-a-l2: math-a has no L2 question"]);
    });
  });

  it("rejects bad L2 topic tests (Р-51)", () => {
    const sixTickets = (dir: string) => {
      replaceIn(`${dir}/tickets/math.yaml`, "  - { id: math-b, title: B }\n", "  - { id: math-b, title: B }\n" + ["c", "d", "e", "f"].map((x) => `  - { id: math-${x}, title: ${x} }\n`).join(""));
      replaceIn(`${dir}/tests/math/topic.md`, "covers: [math-a]", "covers: [math-a, math-b, math-c, math-d, math-e, math-f]");
    };
    const cases: [string, (dir: string) => void, RegExp][] = [
      ["L1 question", (dir) => writeL2(dir, l2Topic("math-topic-a-l2", "math-a", l1A.replace("math-q-201", "math-q-301"))), /в L2-тесте вопрос "math-q-301" должен быть уровня L2/],
      ["no parent", (dir) => writeL2(dir, l2Topic("math-topic-a-l2", "math-b", l2A.replace("math-a", "math-b"))), /covers L2-темы должен целиком лежать ровно в одной обычной теме \(без level\), найдено таких тем: 0/],
      ["maxLevel L1", (dir) => { replaceIn(`${dir}/tickets/math.yaml`, "key: true }", "key: false, maxLevel: L1 }"); writeL2(dir); }, /у тикета "math-a" maxLevel L1, его нельзя включать в L2-тему/],
      ["double L2 coverage", (dir) => { writeL2(dir); writeFileSync(`${dir}/tests/math/topic-l2b.md`, l2Topic("math-topic-a-l2b", "math-a", "", 0 + 1)); }, /тикет "math-a" уже входит в L2-тему "math-topic-a-l2"/],
      ["more than 5", (dir) => { sixTickets(dir); writeL2(dir, l2Topic("math-topic-a-l2", "math-a, math-b, math-c, math-d, math-e, math-f", l2A)); }, /L2-тема покрывает 6 тикетов, допустимо не больше 5/],
    ];
    for (const [name, edit, pattern] of cases) withTopic(edit, (dir) => expect(() => buildPack(dir), name).toThrow(pattern));
  });

  it("allows level L2 on topic tests but not on entry tests", () => {
    const base = { id: "t", title: "T", minutes: 8, level: "L2" };
    expect(TestMetaSchema.safeParse({ ...base, kind: "topic", covers: ["math-a"] }).success).toBe(true);
    expect(TestMetaSchema.safeParse({ ...base, kind: "entry" }).success).toBe(false);
  });
});
