// @vitest-environment happy-dom
// The daily plan, the entry test by the graph, the mini-check and the topic map against the memory store.
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import type { BuiltPack, BuiltTest } from "../src/content/schema";
import { moscowDate } from "../src/core/today";
import { MemoryStore } from "../src/store/memory";
import type { Doc } from "../src/store/types";
import { t } from "../src/ui/i18n";
import { TopicMap } from "../src/ui/modules/graph/map";
import { Tests } from "../src/ui/modules/tests";
import { Today } from "../src/ui/modules/today";
import { Root } from "../src/ui/root";

const question = (id: string, ticket: string) => ({ id, ticket, level: "L0" as const, body: `Вопрос ${id}`, points: ["один", "два"] });
const test = (id: string, kind: BuiltTest["kind"], questions: ReturnType<typeof question>[]): BuiltTest => ({ id, subject: "m", title: id, kind, minutes: 10, reuse: [], questions });
// m: a → b → c; h — a subject without a graph keeps the linear entry test
const pack: BuiltPack = {
  id: "g", title: "G", items: [], exams: [],
  subjects: [{ id: "m", name: "Матан" }, { id: "h", name: "История" }],
  tickets: ["a", "b", "c"].map((id) => ({ id: `${id}-t1`, subject: "m", title: `Билет ${id}`, src: `${id}.tex:1` })),
  theory: [{ ticket: "b-t1", subject: "m", formulation: "Формулировка b" }],
  graph: [
    { id: "a", subject: "m", title: "Тема A", tickets: ["a-t1"], requires: [] },
    { id: "b", subject: "m", title: "Тема B", tickets: ["b-t1"], requires: ["a"] },
    { id: "c", subject: "m", title: "Тема C", tickets: ["c-t1"], requires: ["b"] },
  ],
  tests: [
    test("m-entry", "entry", [question("qa", "a-t1"), question("qb", "b-t1"), question("qc", "c-t1")]),
    { ...test("m-topic", "topic", [question("qb2", "b-t1"), question("qc2", "c-t1")]), covers: ["b-t1", "c-t1"] },
    { ...test("h-entry", "entry", [question("qh", "h-t1")]), subject: "h" },
  ],
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let store: MemoryStore;
let root: HTMLElement;
const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const click = async (sel: string) => { await act(() => q<HTMLButtonElement>(sel).click()); await flush(); };
const docs = async (col: "meta" | "attempts"): Promise<Doc[]> => {
  let out: Doc[] = [];
  const off = store.subscribe(col, (snap) => { out = snap.docs; }, () => {});
  await flush();
  off();
  return out;
};
const meta = async (id: string) => (await docs("meta")).find((doc) => doc.id === id) as (Doc & Record<string, any>) | undefined;

async function mount(component: typeof Today, initial: Partial<Record<"meta" | "attempts", Doc[]>> = {}) {
  store = new MemoryStore({ items: [], ...initial });
  root = document.createElement("div");
  document.body.replaceChildren(root);
  await act(() => { render(<Root pack={pack} connect={async () => store} modules={[{ id: "x", title: "X", component }]} />, root); });
  await flush();
}

async function answer(good: boolean) {
  await act(() => q<HTMLButtonElement>("#show-ref").click());
  if (good) for (const box of root.querySelectorAll<HTMLInputElement>("input.pt")) await act(() => box.click());
  await act(() => q<HTMLButtonElement>("#next").click());
  await flush();
}

describe("daily plan with a graph", () => {
  it("goes placement → Anki → topic → mini-check → «all for today» → one more topic", async () => {
    await mount(Today);
    expect([...root.querySelectorAll(".plan-step")].map((el) => el.getAttribute("data-step"))).toEqual(["placement", "anki", "theory", "check"]);
    expect(q("#plan-go").textContent).toContain(t.planStart);
    expect((await meta("day"))?.topic ?? null).toBeNull(); // provisional until the test is taken

    // entry test: the first question bisects (topic b); answer it, leave, come back, finish
    await click("#plan-go");
    await click("#placement-start");
    expect(q(".qcard").textContent).toContain("Вопрос qb");
    expect(q(".qcard").textContent).toContain(t.placementQuestionOf(1, 3));
    await answer(true);
    expect((await meta("placement-m"))?.asked).toHaveLength(1);
    expect((await meta("placement-m"))?.finishedAt ?? null).toBeNull();
    await click(".runbar .ghost");
    expect(q('[data-step="placement"]').textContent).toContain(t.planPlacementResume(1));
    await click("#plan-go");
    expect(q("#placement-start").textContent).toBe(t.placementResume(1));
    await click("#placement-start");
    expect(q(".qcard").textContent).toContain("Вопрос qc");
    await answer(false);
    expect(q(".gresult").textContent).toContain("03 Тема C");
    const placement = await meta("placement-m");
    expect(placement).toMatchObject({ subject: "m", known: ["a", "b"], unknown: ["c"] });
    expect(typeof placement?.finishedAt).toBe("string");
    const attempts = await docs("attempts");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ test: "placement-m", id: placement?.attempt });
    expect((attempts[0] as Doc & { answers: unknown[] }).answers).toHaveLength(2);

    // a wrong verdict is corrected by hand and back
    await act(() => root.querySelector<HTMLButtonElement>(".grow-known .gfix")!.click());
    await flush();
    expect((await meta("topics"))?.marks).toMatchObject({ a: { state: "unknown" } });
    await act(() => root.querySelector<HTMLButtonElement>(".grow-open .gfix")!.click());
    await flush();
    expect((await meta("topics"))?.marks).toEqual({});

    // the plan: Anki, topic C, its check
    await click("#placement-plan");
    expect([...root.querySelectorAll(".plan-step")].map((el) => el.getAttribute("data-step"))).toEqual(["anki", "theory", "check"]);
    expect(await meta("day")).toMatchObject({ date: moscowDate(new Date()), subject: "m", topic: "c" });
    await click("#plan-go");
    await click("#plan-anki-done");
    expect(q('[data-step="theory"]').textContent).toContain("zachetka::Матан::03 Тема C");
    // topic C has no theory in the pack: the step says what to read instead of «tap for the theory»
    expect(q("#plan-topic-how").textContent).toBe(t.planTopicHowNone);
    expect(q('[data-step="theory"] .plan-step-sub').textContent).toBe(t.planTopicSubNone(1));
    await click(".gticket");
    expect(q(".sheet").textContent).toContain("Билет c");
    expect(q(".sheet .theory-missing-how").textContent).toBe(t.theoryMissingHow);
    await click(".sheet .x");
    await click("#plan-theory-done");
    expect((await meta("day"))?.done).toMatchObject({ anki: expect.any(String), theory: expect.any(String) });

    // mini-check: two questions of topic C, both good → learned
    await click("#plan-go");
    await answer(true);
    await answer(true);
    expect(q(".gresult").textContent).toContain(t.checkPassed);
    await click("#check-exit");
    expect(q("#plan-done").textContent).toContain(t.planAllDone);
    expect((await meta("topics"))?.marks).toMatchObject({ c: { state: "learned" } });
    const day = await meta("day");
    expect(day).toMatchObject({ topic: "c", done: { check: expect.any(String) } });
    const check = (await docs("attempts")).find((doc) => doc.test === "check-c");
    expect(check).toMatchObject({ id: day?.check, finishedAt: expect.any(String) });
    // nothing left to open in this subject
    expect(q("#plan-more")).toBeNull();
  });

  it("skipping the entry test starts with the first topic; «I know it» moves on; a failed check keeps the topic", async () => {
    await mount(Today);
    await click("#plan-go");
    await click("#placement-skip");
    expect(await meta("placement-m")).toMatchObject({ asked: [], finishedAt: expect.any(String) });
    await click("#placement-plan");
    expect((await meta("day"))?.topic).toBe("a");
    await click("#plan-anki-done");
    await click("#plan-know");
    expect((await meta("day"))?.topic).toBe("b");
    await click("#plan-theory-done");
    await click("#plan-go");
    await answer(false);
    await answer(false);
    expect(q(".gresult").textContent).toContain(t.checkFailed);
    await click("#check-exit");
    expect(q("#plan-done").textContent).toContain(t.planDoneNotLearned("02 Тема B"));
    expect((await meta("topics"))?.marks?.b).toBeUndefined();
    expect(q("#plan-retry")).not.toBeNull();
  });

  it("shows the agent's plan of today as a folded note and the due count in the Anki step", async () => {
    const date = moscowDate(new Date());
    await mount(Today, { meta: [{ id: "today", date, plan: [{ id: "p1", text: "Сделать лабу" }], anki: { at: new Date().toISOString(), due: 30, weak: [] } }, { id: "placement-m", subject: "m", startedAt: "x", finishedAt: "x", asked: [] }] });
    expect(q('[data-step="anki"]').textContent).toContain(t.planAnkiDue(30));
    expect(q("details.today-agent")).not.toBeNull();
    expect(q<HTMLDetailsElement>("details.today-agent").open).toBe(false);
    expect(q(".today-weak")).toBeNull();
  });
});

describe("#tests with a graph", () => {
  it("opens the entry test by the graph for a subject with a graph and ignores placement/check attempts in the list", async () => {
    await mount(Tests, { attempts: [
      { id: "s1", test: "placement-m", startedAt: "2026-11-15T10:00:00Z", answers: [{ q: "qb", at: "2026-11-15T10:00:00Z", text: "", hits: [0, 1], self: 1 }] },
      { id: "s2", test: "check-b", startedAt: "2026-11-15T10:00:00Z", answers: [] },
    ] });
    const rows = [...root.querySelectorAll<HTMLButtonElement>(".trow")];
    expect(rows.map((row) => row.querySelector(".ttitle")!.textContent)).toEqual(["m-entry", "m-topic", "h-entry"]);
    expect(rows[0]!.textContent).toContain(t.placementUpTo(3));
    expect(rows.map((row) => row.querySelector(".tact")!.textContent)).toEqual([t.testStart, t.testStart, t.testStart]);
    await act(() => rows[0]!.click());
    await flush();
    expect(q("#placement-start")).not.toBeNull();
    await click(".runbar .ghost");
    // no graph → the linear run as before
    await act(() => [...root.querySelectorAll<HTMLButtonElement>(".trow")][2]!.click());
    await flush();
    expect(q(".qcard").textContent).toContain(t.testQuestionOf(1, 1));
  });
});

describe("topic map", () => {
  it("lists topics in order with states and lets mark a topic and start its check", async () => {
    await mount(TopicMap, { meta: [{ id: "placement-m", subject: "m", startedAt: "x", finishedAt: "x", asked: [{ topic: "a", q: "qa", score: 1, ok: true }] }] });
    const rows = [...root.querySelectorAll(".gtopic")];
    expect(rows.map((row) => row.className.match(/gtopic-(known|learned|open|locked)/)![1])).toEqual(["known", "open", "locked"]);
    expect(rows[2]!.textContent).toContain(`${t.mapRequires} 02 Тема B`);
    await act(() => { const d = rows[1]!.querySelector("details")!; d.open = true; d.dispatchEvent(new Event("toggle")); });
    await flush();
    expect(q(".gbody").textContent).toContain("zachetka::Матан::02 Тема B");
    await act(() => root.querySelector<HTMLButtonElement>(".gacts .ghost")!.click());
    await flush();
    expect((await meta("topics"))?.marks).toMatchObject({ b: { state: "learned" } });
    expect(root.querySelectorAll(".gtopic")[2]!.className).toContain("gtopic-open");
    await act(() => root.querySelector<HTMLButtonElement>(".gacts .primary")!.click());
    await flush();
    expect(q(".qcard").textContent).toContain("Вопрос qb");
  });
});
