// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { MemoryStore } from "../src/store/memory";
import type { Snapshot } from "../src/store/types";
import { splitTests, Tests } from "../src/ui/modules/tests";
import { t } from "../src/ui/i18n";
import { Root } from "../src/ui/root";

const qs = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `m-q${i + 1}`, ticket: "m-t1", level: "L0" as const, body: `Вопрос $x_${i + 1}$`, points: ["один", "два", "три", "четыре"],
}));
const pack: BuiltPack = {
  id: "t", title: "T", subjects: [{ id: "m", name: "Матан" }], exams: [], items: [],
  tests: [{ id: "m-entry", subject: "m", title: "Входной", kind: "entry", minutes: 60, reuse: [], questions: qs(3) }],
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let store: MemoryStore;
let attempts: Snapshot["docs"] = [];
let root: HTMLElement;
const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;

async function mount(initial: Snapshot["docs"] = []) {
  store = new MemoryStore({ items: [], attempts: initial });
  store.subscribe("attempts", (s) => { attempts = s.docs; }, () => {});
  root = document.createElement("div");
  document.body.replaceChildren(root);
  await act(() => {
    render(<Root pack={pack} connect={async () => store} modules={[{ id: "tests", title: "T", component: Tests }]} />, root);
  });
  await flush();
}

async function answer(text: string, tick: number[], gross = false) {
  const ta = q<HTMLTextAreaElement>("textarea#answer");
  ta.value = text;
  await act(() => { ta.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(() => q<HTMLButtonElement>("#show-ref").click());
  const boxes = [...root.querySelectorAll<HTMLInputElement>("input.pt")];
  for (const i of tick) await act(() => boxes[i]!.click());
  if (gross) await act(() => q<HTMLInputElement>("#gross").click());
  await act(() => q<HTMLButtonElement>("#next").click());
  await flush();
}

describe("tests module (memory store)", () => {
  beforeEach(() => mount());

  it("lists the test; start creates the attempt, shows the first question", async () => {
    expect(q(".trow")!.textContent).toContain("Входной");
    await act(() => q<HTMLButtonElement>(".trow").click());
    await flush();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.test).toBe("m-entry");
    expect(q(".qcard")!.textContent).toMatch(/\b1\b\D+\b3\b/);
    expect(q(".qcard .katex")).not.toBeNull();
    expect(q("#show-ref")).not.toBeNull();
    expect(q(".ref")).toBeNull();
  });

  it("grading: ticks give the score, gross error zeroes it, answer is saved right away", async () => {
    await act(() => q<HTMLButtonElement>(".trow").click());
    await flush();
    await answer("мой ответ", [0, 2]);
    expect((attempts[0]!.answers as { q: string; hits: number[]; self: number }[])[0]).toMatchObject({ q: "m-q1", text: "мой ответ", hits: [0, 2], self: 0.5 });
    expect(q(".qcard")!.textContent).toMatch(/\b2\b\D+\b3\b/);
    await answer("x", [0, 1, 2, 3], true);
    const a = attempts[0]!.answers as { gross?: boolean; self: number }[];
    expect(a[1]).toMatchObject({ gross: true, self: 0 });
    expect(attempts[0]!.finishedAt).toBeUndefined();
  });

  it("finishing sets finishedAt and shows the result; the list then offers a retake", async () => {
    await act(() => q<HTMLButtonElement>(".trow").click());
    await flush();
    await answer("a", [0, 1, 2, 3]);
    await answer("b", [0, 1, 2, 3]);
    await answer("c", []);
    expect(typeof attempts[0]!.finishedAt).toBe("string");
    expect(q(".qcard.done")!.textContent).toContain("67%");
  });
});

describe("tests module: resume", () => {
  it("continues an unfinished attempt from the next unanswered question", async () => {
    await mount([{
      id: "a1", test: "m-entry", startedAt: new Date().toISOString(),
      answers: [{ q: "m-q1", text: "t", hits: [0], self: 0.25, at: new Date().toISOString() }],
    }]);
    expect(q(".trow")!.textContent).toContain("1/3");
    await act(() => q<HTMLButtonElement>(".trow").click());
    await flush();
    expect(q(".qcard")!.textContent).toMatch(/\b2\b\D+\b3\b/);
    await answer("b", [0]);
    expect(attempts).toHaveLength(1);
    expect((attempts[0]!.answers as unknown[]).length).toBe(2);
  });
});

describe("tests module: by exam ticket (Р-26)", () => {
  const exam = [
    { id: "m-a1", subject: "m", title: "Пределы", confidence: "sure" as const, includes: ["m-t1"] },
    { id: "m-a2", subject: "m", title: "Ряды", confidence: "doubtful" as const, includes: ["m-t1"] },
  ];
  const ticketTest = (id: string, ex: string) => ({ id, subject: "m", title: id, kind: "ticket" as const, exam: ex, minutes: 6, reuse: [], questions: qs(2) });
  const grouped: BuiltPack = {
    ...pack,
    subjects: [{ id: "m", name: "Матан" }, { id: "g", name: "АиГ" }],
    exam,
    tests: [
      ticketTest("m-b-a2", "m-a2"),
      { id: "m-mock", subject: "m", title: "Пробный", kind: "mock", minutes: 30, reuse: [], questions: qs(1) },
      ticketTest("m-b-a1", "m-a1"),
      { id: "m-entry", subject: "m", title: "Входной", kind: "entry", minutes: 60, reuse: [], questions: qs(3) },
      { id: "g-entry", subject: "g", title: "Входной АиГ", kind: "entry", minutes: 60, reuse: [], questions: qs(1) },
    ],
  };

  it("orders plain tests by kind and ticket tests by exam order", () => {
    const { plain, byTicket } = splitTests(grouped, "m");
    expect(plain.map((x) => x.id)).toEqual(["m-entry", "m-mock"]);
    expect(byTicket.map((x) => x.test.id)).toEqual(["m-b-a1", "m-b-a2"]);
    expect(splitTests(grouped, "g").byTicket).toEqual([]);
  });

  it("places L2 parts after the ordinary ticket test in id order (Р-44)", () => {
    const ordinary = ticketTest("m-b-a1", "m-a1");
    const l2 = (id: string) => ({ ...ticketTest(id, "m-a1"), level: "L2" as const });
    const synthetic: BuiltPack = { ...grouped, tests: [l2("m-b-a1-l2b"), ordinary, l2("m-b-a1-l2a")] };
    const { byTicket } = splitTests(synthetic, "m");
    expect(byTicket.map(({ test }) => test.id)).toEqual(["m-b-a1", "m-b-a1-l2a", "m-b-a1-l2b"]);
    expect(byTicket.slice(1).map(({ part }) => part)).toEqual([[1, 2], [2, 2]]);
  });

  it("places L2 topic tests (and parts) after their parent topic test (Р-52)", () => {
    const topic = (id: string, covers: string[], level?: "L2") => ({ id, subject: "m", title: id, kind: "topic" as const, covers, minutes: 8, reuse: [], questions: [], ...(level ? { level } : {}) });
    const synthetic: BuiltPack = {
      ...grouped,
      tickets: ["m-1", "m-2", "m-3", "m-4"].map((id) => ({ id, subject: "m", title: id })),
      tests: [topic("m-t2-l2", ["m-3"], "L2"), topic("m-t1-l2b", ["m-2"], "L2"), topic("m-t2", ["m-3", "m-4"]), topic("m-t1", ["m-1", "m-2"]), topic("m-t1-l2a", ["m-1"], "L2")],
    };
    const { byTopic } = splitTests(synthetic, "m");
    expect(byTopic.map(({ test }) => test.id)).toEqual(["m-t1", "m-t1-l2a", "m-t1-l2b", "m-t2", "m-t2-l2"]);
    expect(byTopic.map(({ part }) => part)).toEqual([undefined, [1, 2], [2, 2], undefined, undefined]);
  });

  it("shows a collapsed group with code, title and confidence; other subjects unchanged", async () => {
    store = new MemoryStore({ items: [], attempts: [] });
    root = document.createElement("div");
    document.body.replaceChildren(root);
    await act(() => {
      render(<Root pack={grouped} connect={async () => store} modules={[{ id: "tests", title: "T", component: Tests }]} />, root);
    });
    await flush();
    const [m, g] = [...root.querySelectorAll<HTMLElement>("section.subject")];
    const group = m!.querySelector<HTMLDetailsElement>("details.bytickets")!;
    expect(group.open).toBe(false);
    expect(group.querySelector("summary")!.textContent).toContain(t.testsByTicket(2));
    const rows = [...group.querySelectorAll(".trow")];
    expect(rows.map((r) => r.querySelector(".tcode")!.textContent)).toEqual(["a1", "a2"]);
    expect(rows[0]!.textContent).toContain("Пределы");
    expect(rows[0]!.querySelector(".tconf")!.textContent).toBe("✔");
    expect(rows[1]!.querySelector(".tconf")!.textContent).toBe("?");
    expect(rows[0]!.textContent).toContain(t.testMin(6));
    expect([...m!.querySelectorAll(":scope > div.list > .trow")].map((r) => r.querySelector(".ttitle")!.textContent)).toEqual(["Входной", "Пробный"]);
    expect(g!.querySelector("details")).toBeNull();
    expect(g!.querySelectorAll(".trow")).toHaveLength(1);
  });

  it("renders the L2 badge and numbered part label on a narrow ticket row (Р-44)", async () => {
    const l2 = (id: string) => ({ ...ticketTest(id, "m-a1"), level: "L2" as const });
    const synthetic: BuiltPack = { ...grouped, tests: [ticketTest("m-b-a1", "m-a1"), l2("m-b-a1-l2a"), l2("m-b-a1-l2b")] };
    store = new MemoryStore({ items: [], attempts: [] });
    root = document.createElement("div");
    document.body.replaceChildren(root);
    await act(() => render(<Root pack={synthetic} connect={async () => store} modules={[{ id: "tests", title: "T", component: Tests }]} />, root));
    await flush();
    const rows = [...root.querySelectorAll<HTMLButtonElement>("details.bytickets .trow")];
    expect(rows.map((row) => row.querySelector(".l2badge")?.textContent ?? "")).toEqual(["", "L2", "L2"]);
    expect(rows[1]!.textContent).toContain(t.testPart(1, 2));
    expect(rows[2]!.textContent).toContain(t.testPart(2, 2));
  });
});

describe("tests module: by topic (Р-39)", () => {
  const topicTest = (id: string, covers: string[]) => ({ id, subject: "m", title: id, kind: "topic" as const, covers, minutes: 6, reuse: [], questions: qs(2) });
  const grouped: BuiltPack = {
    ...pack,
    subjects: [...pack.subjects, { id: "g", name: "АиГ" }],
    tickets: [
      { id: "m-t2", subject: "m", title: "Второй" },
      { id: "m-t1", subject: "m", title: "Первый" },
    ],
    tests: [topicTest("m-topic-2", ["m-t2", "m-t1"]), topicTest("m-topic-1", ["m-t1"]),
      { id: "g-entry", subject: "g", title: "Входной", kind: "entry", minutes: 30, reuse: [], questions: qs(1) }],
  };

  it("shows the topic group in first covered ticket order and omits it for subjects without topic tests", async () => {
    store = new MemoryStore({ items: [], attempts: [] });
    root = document.createElement("div");
    document.body.replaceChildren(root);
    await act(() => {
      render(<Root pack={grouped} connect={async () => store} modules={[{ id: "tests", title: "T", component: Tests }]} />, root);
    });
    await flush();
    const [m, g] = [...root.querySelectorAll<HTMLElement>("section.subject")];
    const group = m!.querySelector<HTMLDetailsElement>("details.bytopics")!;
    expect(group.open).toBe(false);
    expect(group.querySelector("summary")!.textContent).toContain(t.testsByTopic(2));
    expect([...group.querySelectorAll(".ttitle")].map((x) => x.textContent)).toEqual(["m-topic-2", "m-topic-1"]);
    expect(g!.querySelector("details.bytopics")).toBeNull();
  });
});
