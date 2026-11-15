import { describe, expect, it } from "vitest";
import type { BuiltPack, BuiltTest, BuiltTopic } from "../src/content/schema.ts";
import { buildGraph, markTopic, topicStates, type TopicMarks } from "../src/core/graph.ts";
import { placementKnown, type PlacementDoc } from "../src/core/placement.ts";
import { ankiMinutes, attemptSubject, checkAttemptTest, checkMinutes, checkQuestions, checkResult, chooseSubject, dayFor, dayPatch, dayPlan, isSyntheticTest, oneMoreTopic, parseDayDoc, planSubject, theoryCover, type DayDoc, type PlanStep } from "../src/core/plan.ts";
import { subjectReady, type Attempt } from "../src/core/ready.ts";

const topic = (id: string, subject: string, requires: string[] = [], extra: Partial<BuiltTopic> = {}): BuiltTopic => ({ id, subject, title: `T ${id}`, tickets: [`${id}-t1`, `${id}-t2`], requires, ...extra });
// math: a → b → c;  phys: p (requires math b) → r;  hist — no graph
const TOPICS = [topic("a", "math"), topic("b", "math", ["a"], { minutes: 30 }), topic("c", "math", ["b"]), topic("p", "phys", ["b"]), topic("r", "phys", ["p"])];
const graph = buildGraph(TOPICS);
const question = (id: string, ticket: string, level: "L0" | "L1" | "L2" = "L0") => ({ id, ticket, level, body: "?", points: ["one", "two", "three"] });
const test = (id: string, subject: string, kind: BuiltTest["kind"], questions: ReturnType<typeof question>[]): BuiltTest => ({ id, subject, title: id, kind, minutes: 10, reuse: [], questions });
const pack: BuiltPack = {
  id: "p", title: "P", items: [],
  subjects: [{ id: "math", name: "Матан" }, { id: "phys", name: "Физика" }, { id: "hist", name: "История" }],
  exams: [{ id: "e-math", subject: "math", title: "Экзамен", date: "2026-12-20" }, { id: "e-phys", subject: "phys", title: "Экзамен", date: "2026-12-10" }, { id: "e-old", subject: "math", title: "Коллоквиум", date: "2026-11-01" }],
  tickets: [...TOPICS.flatMap((item) => item.tickets.map((id) => ({ id, subject: item.subject, title: `Билет ${id}`, src: `${id}.tex:1` }))), { id: "h-t1", subject: "hist", title: "h" }],
  theory: [{ ticket: "a-t1", subject: "math", formulation: "f" }],
  graph: [...graph.topics],
  tests: [
    test("math-entry", "math", "entry", [question("qa0", "a-t1"), question("qb0", "b-t1"), question("qc0", "c-t1")]),
    test("math-topic", "math", "topic", [question("qa1", "a-t1", "L1"), question("qa2", "a-t2"), question("qa3", "a-t2", "L1"), question("qa4", "a-t1", "L2"), question("qb1", "b-t2")]),
  ],
};
const NOW = new Date("2026-11-15T09:00:00Z");
const TODAY = "2026-11-15";
const answers = (testId: string, list: [q: string, score: number][], extra: Partial<Attempt> & { id?: string } = {}): Attempt & { id?: string } =>
  ({ test: testId, startedAt: "2026-11-14T10:00:00Z", answers: list.map(([q, self]) => ({ q, at: "2026-11-14T10:00:00Z", text: "", hits: [], self })), ...extra });
const placement = (subject: string, asked: [topic: string, q: string, score: number][] = [], finished = true): PlacementDoc =>
  ({ subject, startedAt: "2026-11-15T08:00:00Z", ...(finished ? { finishedAt: "2026-11-15T08:05:00Z" } : {}), asked: asked.map(([t, q, score]) => ({ topic: t, q, score, ok: score >= 0.6 })), known: [], unknown: [] });

function build(opts: { day?: unknown; placements?: PlacementDoc[]; marks?: TopicMarks; attempts?: (Attempt & { id?: string })[]; agent?: Parameters<typeof dayPlan>[0]["agent"]; now?: Date } = {}) {
  const placements = opts.placements ?? [placement("math")];
  const attempts = opts.attempts ?? [];
  const states = topicStates(pack, graph, { known: placementKnown(pack, graph, placements), marks: opts.marks ?? {}, attempts });
  return dayPlan({ pack, graph, states, day: opts.day ?? null, agent: opts.agent ?? null, placements, attempts, now: opts.now ?? NOW });
}
const step = <K extends PlanStep["id"]>(plan: ReturnType<typeof build>, id: K) => plan.steps.find((item) => item.id === id) as Extract<PlanStep, { id: K }> | undefined;
const ids = (plan: ReturnType<typeof build>) => plan.steps.map((item) => item.id);
const mark = (id: string, state: "learned" | "unknown" = "learned"): TopicMarks => ({ [id]: { state, at: "2026-11-14T00:00:00Z" } });

describe("meta/day", () => {
  it("parses untrusted documents and treats null fields as absent", () => {
    expect(parseDayDoc(null)).toBeNull();
    expect(parseDayDoc({ date: "15.11" })).toBeNull();
    expect(parseDayDoc({ date: TODAY, subject: "math", topic: null, done: { anki: "x", theory: null, junk: 1 }, check: null, finished: ["a", 3] }))
      .toEqual({ date: TODAY, subject: "math", done: { anki: "x" }, finished: ["a"] });
    expect(parseDayDoc({ date: TODAY, done: [] })).toEqual({ date: TODAY, done: {}, finished: [] });
  });
  it("a document of another date starts a new day and keeps only the subject", () => {
    const old: DayDoc = { date: "2026-11-14", subject: "phys", topic: "p", done: { anki: "x", check: "y" }, check: "m1", finished: ["a"] };
    expect(dayFor(old, TODAY)).toEqual({ date: TODAY, subject: "phys", done: {}, finished: [] });
    expect(dayFor(old, "2026-11-14")).toBe(old);
    expect(dayFor(null, TODAY)).toEqual({ date: TODAY, done: {}, finished: [] });
  });
  it("writes absent fields as null so that a merge-patch clears them", () => {
    expect(dayPatch({ date: TODAY, done: {}, finished: [] })).toEqual({ date: TODAY, subject: null, topic: null, done: {}, check: null, finished: [] });
  });
});

describe("planSubject", () => {
  const states = (marks: TopicMarks = {}) => topicStates(pack, graph, { marks });
  const day = (extra: Partial<DayDoc> = {}): DayDoc => ({ date: TODAY, done: {}, finished: [], ...extra });
  it("keeps the stored subject while it has an open topic", () => {
    expect(planSubject(pack, graph, states(), day({ subject: "math" }))).toBe("math");
  });
  it("otherwise takes the subject with the nearest coming exam that has an open topic", () => {
    // phys has the nearer exam but nothing open until math b is learned
    expect(planSubject(pack, graph, states(), day())).toBe("math");
    expect(planSubject(pack, graph, states({ ...mark("a"), ...mark("b") }), day())).toBe("phys");
    expect(planSubject(pack, graph, states(), day({ subject: "phys" }))).toBe("math");
    expect(planSubject(pack, graph, states(), day({ subject: "hist" }))).toBe("math");
  });
  it("stays on a subject without open topics while today's topic steps are under way", () => {
    const all = { ...mark("a"), ...mark("b"), ...mark("c") };
    expect(planSubject(pack, graph, states(all), day({ subject: "math", topic: "c", done: { check: "x" } }))).toBe("math");
    expect(planSubject(pack, graph, states(all), day({ subject: "math" }))).toBe("phys");
  });
  it("is null without any graph", () => {
    expect(planSubject(pack, buildGraph([]), new Map(), day())).toBeNull();
    const plan = dayPlan({ pack, graph: buildGraph([]), states: new Map(), day: null, now: NOW });
    expect(plan.subject).toBeNull();
    expect(plan.steps).toEqual([]);
  });
});

describe("dayPlan", () => {
  it("starts with the entry test while the subject has a pool and no finished placement", () => {
    const plan = build({ placements: [] });
    expect(ids(plan)).toEqual(["placement", "anki", "theory", "check"]);
    expect(step(plan, "placement")).toMatchObject({ minutes: 5, asked: 0, done: false });
    expect(plan.next?.id).toBe("placement");
    // the topic is provisional until the test is taken: it is not stored
    expect(plan.day.topic).toBeUndefined();
    expect(build({ day: { date: TODAY, subject: "math" }, placements: [placement("math", [["b", "qb0", 1]], false)] }).steps[0]).toMatchObject({ id: "placement", asked: 1 });
    // skipped (empty finished document) or taken → no step; a subject without a pool never has it
    expect(ids(build())).toEqual(["anki", "theory", "check"]);
    expect(ids(build({ placements: [], day: { date: TODAY, subject: "phys" }, marks: { ...mark("a"), ...mark("b") } }))).toEqual(["anki", "theory", "check"]);
  });

  it("queues reviews, the first open topic and its mini-check with minutes", () => {
    const plan = build({ placements: [placement("math", [["a", "qa0", 1]])] });
    expect(plan).toMatchObject({ date: TODAY, subject: "math", dirty: true, allDone: false, noTopic: null });
    expect(plan.topic?.id).toBe("b");
    expect(plan.day).toEqual({ date: TODAY, subject: "math", topic: "b", done: {}, finished: [] });
    expect(step(plan, "anki")).toEqual({ id: "anki", minutes: 10, done: false, due: null });
    const theory = step(plan, "theory")!;
    expect(theory).toMatchObject({ minutes: 30, done: false, deck: "zachetka::Матан::02 T b" });
    expect(theory.tickets).toEqual([{ id: "b-t1", title: "Билет b-t1", src: "b-t1.tex:1", theory: false }, { id: "b-t2", title: "Билет b-t2", src: "b-t2.tex:1", theory: false }]);
    expect(step(plan, "check")!.questions.map((q) => q.id)).toEqual(["qb0", "qb1"]);
    expect(step(plan, "check")!.minutes).toBe(4);
    expect(plan.minutes).toBe(44);
    expect(plan.left).toBe(44);
    expect(plan.subjects).toEqual([{ id: "math", name: "Матан", open: 1 }, { id: "phys", name: "Физика", open: 0 }]);
    expect(build().steps.find((item) => item.id === "theory")).toMatchObject({ minutes: 8, tickets: [{ id: "a-t1", theory: true }, { id: "a-t2", theory: false }] });
    expect(theoryCover(theory.tickets)).toBe("none");
    expect(theoryCover(step(build(), "theory")!.tickets)).toBe("some");
    expect(theoryCover([{ theory: true }, { theory: true }])).toBe("all");
  });

  it("takes the number of due cards from the agent's summary of today only", () => {
    const anki = (at: string) => ({ date: TODAY, plan: [], anki: { at, due: 40, weak: [] } });
    expect(step(build({ agent: anki("2026-11-15T03:00:00+03:00") }), "anki")).toMatchObject({ due: 40, minutes: 6 });
    expect(step(build({ agent: anki("2026-11-14T20:00:00Z") }), "anki")).toMatchObject({ due: null, minutes: 10 });
    expect(ankiMinutes(0)).toBe(0);
    expect(ankiMinutes(1)).toBe(1);
  });

  it("keeps today's topic and ticks; is not dirty when nothing changes", () => {
    const day = { date: TODAY, subject: "math", topic: "a", done: { anki: "t1", theory: "t2" }, finished: [] };
    const plan = build({ day });
    expect(plan.dirty).toBe(false);
    expect(plan.steps.map((item) => item.done)).toEqual([true, true, false]);
    expect(plan.next?.id).toBe("check");
    expect(plan.left).toBe(step(plan, "check")!.minutes);
  });

  it("does not change the topic after its mini-check, passed or not", () => {
    const day = { date: TODAY, subject: "math", topic: "a", done: { anki: "x", theory: "x", check: "x" }, check: "m1", finished: [] };
    const passed = build({ day, marks: mark("a") });
    expect(passed).toMatchObject({ allDone: true, topicLearned: true, next: null, left: 0 });
    expect(passed.topic?.id).toBe("a");
    const failed = build({ day });
    expect(failed).toMatchObject({ allDone: true, topicLearned: false });
    expect(failed.topic?.id).toBe("a");
    // the next day the failed topic is the topic again, the passed one gives way to the next
    const tomorrow = new Date("2026-11-16T09:00:00Z");
    expect(build({ day, now: tomorrow }).day).toEqual({ date: "2026-11-16", subject: "math", topic: "a", done: {}, finished: [] });
    expect(build({ day, now: tomorrow, marks: mark("a") }).topic?.id).toBe("b");
  });

  it("re-picks the topic when the stored one became known, learned without a check, locked, or is of another subject", () => {
    const day = (topicId: string, done = {}) => ({ date: TODAY, subject: "math", topic: topicId, done, finished: [] });
    expect(build({ day: day("a", { theory: "x" }), placements: [placement("math", [["a", "qa0", 1]])] }).day).toMatchObject({ topic: "b", done: {} });
    expect(build({ day: day("a", { anki: "x", theory: "x" }), marks: mark("a") }).day).toMatchObject({ topic: "b", done: { anki: "x" } });
    expect(build({ day: day("c") }).topic?.id).toBe("a");
    expect(build({ day: day("p") }).topic?.id).toBe("a");
    expect(build({ day: day("ghost") }).topic?.id).toBe("a");
  });

  it("«one more topic» moves on and skips what was finished today", () => {
    const day = parseDayDoc({ date: TODAY, subject: "math", topic: "a", done: { anki: "x", theory: "x", check: "x" }, check: "m1" })!;
    const more = oneMoreTopic(day);
    expect(more).toEqual({ date: TODAY, subject: "math", done: { anki: "x" }, finished: ["a"] });
    const passed = build({ day: dayPatch(more), marks: mark("a") });
    expect(passed.topic?.id).toBe("b");
    expect(passed.steps.map((item) => item.done)).toEqual([true, false, false]);
    // failed and it is the only open topic → the same topic again
    expect(build({ day: dayPatch(more) }).topic?.id).toBe("a");
  });

  it("says why there is no topic", () => {
    const all = build({ day: { date: TODAY, subject: "math", topic: "c", done: { theory: "x", check: "x" } }, marks: { ...mark("a"), ...mark("b"), ...mark("c") } });
    expect(all.topic?.id).toBe("c");
    const done = build({ day: { date: "2026-11-14", subject: "math" }, marks: { ...mark("a"), ...mark("b"), ...mark("c"), ...mark("p"), ...mark("r") } });
    expect(done).toMatchObject({ subject: "math", topic: null, noTopic: { reason: "all" } });
    expect(ids(done)).toEqual(["anki"]);
    expect(build({ day: { date: TODAY, subject: "math", done: { anki: "x" } }, marks: { ...mark("a"), ...mark("b"), ...mark("c"), ...mark("p"), ...mark("r") } }).allDone).toBe(true);
    // phys waits for math b: only when nothing else is open anywhere does the plan stay on it
    const onlyPhys = { ...pack, subjects: [pack.subjects[1]!] };
    const states = topicStates(onlyPhys, graph, {});
    const blocked = dayPlan({ pack: onlyPhys, graph, states, day: null, now: NOW });
    expect(blocked.noTopic).toEqual({ reason: "blocked", by: [graph.byId.get("b")] });
  });

  it("changing the subject drops the untouched topic, closes a started one", () => {
    const fresh = parseDayDoc({ date: TODAY, subject: "math", topic: "a", done: { anki: "x" } })!;
    expect(chooseSubject(fresh, "phys")).toEqual({ date: TODAY, subject: "phys", done: { anki: "x" }, finished: [] });
    expect(chooseSubject(fresh, "math")).toBe(fresh);
    const started = parseDayDoc({ date: TODAY, subject: "math", topic: "a", done: { anki: "x", theory: "y" }, check: "m1" })!;
    expect(chooseSubject(started, "phys")).toEqual({ date: TODAY, subject: "phys", done: { anki: "x" }, finished: ["a"] });
    const plan = build({ day: dayPatch(chooseSubject(fresh, "phys")), marks: { ...mark("a"), ...mark("b") } });
    expect(plan).toMatchObject({ subject: "phys" });
    expect(plan.topic?.id).toBe("p");
  });
});

describe("mini-check", () => {
  it("prefers unanswered, then the weakest, one question per ticket; L2 never; order of topicQuestions", () => {
    expect(checkQuestions(pack, graph, "a", []).map((q) => q.id)).toEqual(["qa0", "qa1", "qa2"]);
    // qa0 answered well → the unanswered qa1 (ticket 1) and qa2 (ticket 2) first, the third is the next unanswered
    expect(checkQuestions(pack, graph, "a", [answers("math-entry", [["qa0", 1]])]).map((q) => q.id)).toEqual(["qa1", "qa2", "qa3"]);
    // all answered: weakest first — qa3 (0.1, ticket 2), qa0 (0.2, ticket 1), then the next weakest qa2
    const all = [answers("x", [["qa0", 0.2], ["qa1", 0.9], ["qa2", 0.5], ["qa3", 0.1]])];
    expect(checkQuestions(pack, graph, "a", all).map((q) => q.id)).toEqual(["qa0", "qa2", "qa3"]);
    expect(checkQuestions(pack, graph, "a", all, ["qa1"]).map((q) => q.id)).toEqual(["qa0", "qa1", "qa3"]);
    expect(checkQuestions(pack, graph, "c", []).map((q) => q.id)).toEqual(["qc0"]);
    expect(checkQuestions(pack, graph, "r", [])).toEqual([]);
    expect(checkMinutes(checkQuestions(pack, graph, "a", []))).toBe(8);
  });
  it("passes at a mean of 0.7; the agent's grade and a gross error count", () => {
    expect(checkResult([])).toBeNull();
    expect(checkResult([{ self: 1 }, { self: 0.67 }, { self: 0.67 }])).toMatchObject({ passed: true });
    expect(checkResult([{ self: 1 }, { self: 1, gross: true }, { self: 1 }])).toMatchObject({ passed: false });
    expect(checkResult([{ self: 0.3, agent: 1 }])).toEqual({ value: 1, passed: true });
  });
  it("an unfinished run of today keeps its questions", () => {
    const run = answers(checkAttemptTest("a"), [["qa0", 1]], { id: "m7" });
    const plan = build({ day: { date: TODAY, subject: "math", topic: "a", done: {}, check: "m7" }, attempts: [run] });
    expect(step(plan, "check")).toMatchObject({ attempt: "m7" });
    expect(step(plan, "check")!.questions.map((q) => q.id)).toEqual(["qa0", "qa1", "qa2"]);
    const finished = build({ day: { date: TODAY, subject: "math", topic: "a", done: {}, check: "m7" }, attempts: [{ ...run, finishedAt: "x" }] });
    expect(step(finished, "check")!.attempt).toBeUndefined();
  });
});

describe("markTopic", () => {
  const known = new Set(["a"]);
  it("writes a mark only when it changes something and removes the opposite one", () => {
    expect(markTopic(pack, graph, { known }, "a", "unknown", "T")).toEqual({ a: { state: "unknown", at: "T" } });
    expect(markTopic(pack, graph, { known, marks: mark("a", "unknown") }, "a", "learned", "T")).toEqual({});
    expect(markTopic(pack, graph, { known }, "b", "learned", "T")).toEqual({ b: { state: "learned", at: "T" } });
    expect(markTopic(pack, graph, { known, marks: mark("b") }, "b", "unknown", "T")).toEqual({});
    expect(markTopic(pack, graph, { known, marks: mark("c") }, "ghost", "learned", "T")).toEqual(mark("c"));
  });
});

describe("synthetic attempts (placement-<subject>, check-<topic>)", () => {
  it("are told from tests of the pack and attributed to a subject", () => {
    expect(isSyntheticTest(pack, "placement-math")).toBe(true);
    expect(isSyntheticTest(pack, "check-a")).toBe(true);
    expect(isSyntheticTest(pack, "math-entry")).toBe(false);
    expect(attemptSubject(pack, "math-topic")).toBe("math");
    expect(attemptSubject(pack, "placement-phys")).toBe("phys");
    expect(attemptSubject(pack, "check-p")).toBe("phys");
    expect(attemptSubject(pack, "check-ghost")).toBeUndefined();
    expect(attemptSubject(pack, "placement-ghost")).toBeUndefined();
  });
  it("count in readiness by question id", () => {
    const attempts = [answers("placement-math", [["qa0", 1]]), answers("check-a", [["qa2", 0.5]])];
    const ready = subjectReady("math", pack, attempts, NOW);
    expect(ready.cells.find((item) => item.ticket === "a-t1" && item.level === "L0")?.value).toBe(1);
    expect(ready.cells.find((item) => item.ticket === "a-t2" && item.level === "L0")?.value).toBe(0.5);
  });
});
