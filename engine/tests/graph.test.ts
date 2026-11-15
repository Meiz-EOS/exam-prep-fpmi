import { describe, expect, it } from "vitest";
import type { BuiltTest, BuiltTopic } from "../src/content/schema.ts";
import { ancestors, buildGraph, descendants, hasGraph, nextTopics, parseTopicMarks, subjectTopicCounts, subjectTopics, topicDeck, topicEvidence, topicLabel, topicMinutes, topicNumber, topicOfTicket, topicQuestions, topicStates, topoOrder } from "../src/core/graph.ts";
import type { Attempt } from "../src/core/ready.ts";

const topic = (id: string, requires: string[] = [], extra: Partial<BuiltTopic> = {}): BuiltTopic => ({ id, subject: "math", title: id.toUpperCase(), tickets: [`${id}-t1`, `${id}-t2`], requires, ...extra });
const ids = (topics: readonly { id: string }[]): string[] => topics.map((item) => item.id);

//   a → b → d → e        (x → y: y requires x)
//   a → c → d            p (physics) requires c; f requires p
const TOPICS = [topic("e", ["d"]), topic("d", ["b", "c"]), topic("a"), topic("c", ["a"]), topic("b", ["a"]), topic("p", ["c"], { subject: "phys" }), topic("f", ["p"])];
const graph = buildGraph(TOPICS);

const question = (id: string, ticket: string, level: "L0" | "L1" | "L2" = "L0") => ({ id, ticket, level, body: "?", points: ["one", "two"] });
const test = (id: string, kind: BuiltTest["kind"], questions: ReturnType<typeof question>[]): BuiltTest => ({ id, subject: "math", title: id, kind, minutes: 10, reuse: [], questions });
const pack = {
  subjects: [{ id: "math", name: "Матан" }, { id: "phys", name: "Физика" }],
  remap: { "old-a": "a-t1" },
  tests: [
    test("entry", "entry", [question("qa1", "a-t1"), question("qb1", "b-t1", "L1"), question("qa-l2", "a-t1", "L2")]),
    test("topic", "topic", [question("qa3", "a-t2", "L1"), question("qa2", "a-t2"), question("qa4", "old-a", "L1"), question("qc1", "c-t1")]),
  ],
};
const answers = (...list: [q: string, score: number, day?: number][]): Attempt[] => [{ test: "any", startedAt: "2026-11-01T10:00:00Z", answers: list.map(([q, score, day = 1]) => ({ q, at: `2026-11-0${day}T10:00:00Z`, text: "", hits: [], self: score })) }];

describe("topoOrder", () => {
  it("is topological and stable: the earliest topic in the file whose requires are placed goes next", () => {
    expect(ids(topoOrder(TOPICS).order)).toEqual(["a", "c", "b", "d", "e", "p", "f"]);
    expect(topoOrder(TOPICS).cycle).toEqual([]);
    expect(ids(topoOrder([topic("x"), topic("y"), topic("z")]).order)).toEqual(["x", "y", "z"]);
  });
  it("is idempotent and ignores requires that name no topic", () => {
    const once = topoOrder(TOPICS).order;
    expect(ids(topoOrder(once).order)).toEqual(ids(once));
    expect(ids(topoOrder([topic("x", ["ghost"])]).order)).toEqual(["x"]);
  });
  it("reports one cycle and orders what does not depend on it", () => {
    const result = topoOrder([topic("x", ["z"]), topic("free"), topic("y", ["x"]), topic("z", ["y"]), topic("after", ["z"])]);
    expect(result.cycle).toEqual(["x", "z", "y"]);
    expect(ids(result.order)).toEqual(["free"]);
    expect(topoOrder([topic("self", ["self"])]).cycle).toEqual(["self"]);
    expect(() => buildGraph([topic("x", ["y"]), topic("y", ["x"])])).toThrow(/cycle: x → y → x/);
  });
});

describe("graph relations", () => {
  it("lists ancestors and descendants transitively, across subjects, in the canonical order", () => {
    expect(ancestors(graph, "d")).toEqual(["a", "c", "b"]);
    expect(ancestors(graph, "a")).toEqual([]);
    expect(ancestors(graph, "f")).toEqual(["a", "c", "p"]);
    expect(descendants(graph, "a")).toEqual(["c", "b", "d", "e", "p", "f"]);
    expect(descendants(graph, "c")).toEqual(["d", "e", "p", "f"]);
    expect(descendants(graph, "e")).toEqual([]);
    expect(ancestors(graph, "nope")).toEqual([]);
  });
  it("gives the subject order, numbers, labels and Anki subdecks", () => {
    expect(ids(subjectTopics(graph, "math"))).toEqual(["a", "c", "b", "d", "e", "f"]);
    expect(hasGraph(graph, "phys")).toBe(true);
    expect(hasGraph(graph, "chem")).toBe(false);
    expect(topicNumber(graph, "c")).toBe(2);
    expect(topicNumber(graph, "p")).toBe(1);
    expect(topicNumber(graph, "nope")).toBe(0);
    expect(topicLabel(graph, "b")).toBe("03 B");
    expect(topicDeck(pack, graph, "b")).toBe("zachetka::Матан::03 B");
    expect(topicDeck(pack, graph, "p")).toBe("zachetka::Физика::01 P");
    const many = buildGraph(Array.from({ length: 100 }, (_, index) => topic(`t${index}`)));
    expect(topicLabel(many, "t0")).toBe("001 T0");
  });
  it("finds the topic of a ticket (also by an old id) and estimates minutes", () => {
    expect(topicOfTicket(graph, "c-t2")?.id).toBe("c");
    expect(topicOfTicket(graph, "old-a", pack.remap)?.id).toBe("a");
    expect(topicOfTicket(graph, "ghost")).toBeUndefined();
    expect(topicMinutes(topic("x"))).toBe(8);
    expect(topicMinutes(topic("x", [], { minutes: 25 }))).toBe(25);
  });
});

describe("topicQuestions and topicEvidence", () => {
  it("collects L0/L1 questions of the topic's tickets from every test: ticket order, then level, then pack order", () => {
    expect(ids(topicQuestions(pack, graph, "a"))).toEqual(["qa1", "qa4", "qa2", "qa3"]);
    expect(topicQuestions(pack, graph, "e")).toEqual([]);
  });
  it("needs three answered questions (or all, if fewer) with a mean of 0.7", () => {
    expect(topicEvidence(pack, graph, "a", [])).toEqual({ total: 4, answered: 0, value: null, learned: false });
    expect(topicEvidence(pack, graph, "a", answers(["qa1", 1], ["qa2", 1])).learned).toBe(false);
    expect(topicEvidence(pack, graph, "a", answers(["qa1", 1], ["qa2", 1], ["qa3", 0.5]))).toMatchObject({ answered: 3, learned: true });
    expect(topicEvidence(pack, graph, "a", answers(["qa1", 1], ["qa2", 0.5], ["qa3", 0.5])).learned).toBe(false);
    expect(topicEvidence(pack, graph, "c", answers(["qc1", 0.7]))).toMatchObject({ total: 1, answered: 1, learned: true });
    expect(topicEvidence(pack, graph, "e", []).learned).toBe(false); // no questions — only a mark can make it learned
    // the value of a question is the mean of its last answers (Р-16)
    expect(topicEvidence(pack, graph, "c", answers(["qc1", 0, 1], ["qc1", 1, 2])).value).toBe(0.5);
  });
});

describe("topicStates and nextTopics", () => {
  const states = (input: Parameters<typeof topicStates>[2]) => Object.fromEntries(topicStates(pack, graph, input));
  it("opens the roots when nothing is known", () => {
    expect(states({})).toEqual({ a: "open", c: "locked", b: "locked", d: "locked", e: "locked", p: "locked", f: "locked" });
    expect(ids(nextTopics(graph, topicStates(pack, graph), "math"))).toEqual(["a"]);
    expect(nextTopics(graph, topicStates(pack, graph), "phys")).toEqual([]);
  });
  it("combines placement, marks and answers; a topic opens when all its requires are known or learned", () => {
    const result = topicStates(pack, graph, { known: new Set(["a"]), marks: { b: { state: "learned", at: "2026-11-02T10:00:00Z" } }, attempts: answers(["qc1", 1]) });
    expect(Object.fromEntries(result)).toEqual({ a: "known", c: "learned", b: "learned", d: "open", e: "locked", p: "open", f: "locked" });
    expect(ids(nextTopics(graph, result, "math"))).toEqual(["d"]);
    expect(ids(nextTopics(graph, result, "phys"))).toEqual(["p"]);
    expect(subjectTopicCounts(graph, result, "math")).toEqual({ total: 6, known: 1, learned: 2, open: 1, locked: 2 });
  });
  it("several topics can be open at once, in the canonical order", () => {
    expect(ids(nextTopics(graph, topicStates(pack, graph, { known: new Set(["a"]) }), "math"))).toEqual(["c", "b"]);
  });
  it("a mark `unknown` beats placement and answers, and locks what requires the topic", () => {
    const result = states({ known: new Set(["a", "c", "b", "d"]), marks: { c: { state: "unknown", at: "2026-11-02T10:00:00Z" } }, attempts: answers(["qc1", 1]) });
    expect(result).toMatchObject({ a: "known", c: "open", b: "known", d: "known", e: "open", p: "locked" });
  });
  it("placement wins the name over a mark `learned`; unknown ids are ignored", () => {
    expect(states({ known: new Set(["a", "ghost"]), marks: { a: { state: "learned", at: "x" }, ghost: { state: "learned", at: "x" } } }).a).toBe("known");
  });
});

describe("parseTopicMarks", () => {
  it("keeps well-formed marks and drops the rest", () => {
    expect(parseTopicMarks({ marks: { a: { state: "learned", at: "2026-11-02T10:00:00Z", extra: 1 }, b: { state: "done", at: "x" }, c: { state: "unknown" }, d: null } }))
      .toEqual({ a: { state: "learned", at: "2026-11-02T10:00:00Z" } });
    for (const bad of [null, undefined, 5, {}, { marks: [] }, { marks: "x" }]) expect(parseTopicMarks(bad)).toEqual({});
  });
});
