import { describe, expect, it } from "vitest";
import type { BuiltTest, BuiltTopic } from "../src/content/schema.ts";
import { buildGraph, topicStates } from "../src/core/graph.ts";
import {
  PLACEMENT_MAX_QUESTIONS, answerPlacement, entryPool, nextPlacementQuestion, parsePlacementDoc, placementDoc, placementDocId, placementDone,
  placementKnown, placementMinutes, placementPlan, resumePlacement, startPlacement, stopPlacement, undetermined, type PlacementPlan, type PlacementState,
} from "../src/core/placement.ts";

const topic = (id: string, requires: string[] = [], subject = "math"): BuiltTopic => ({ id, subject, title: id, tickets: [`${id}-t`], requires });
const question = (id: string, ticket: string, level: "L0" | "L1" | "L2" = "L0") => ({ id, ticket, level, body: "?", points: ["one", "two", "three"] });
const entry = (questions: ReturnType<typeof question>[], extra: Partial<BuiltTest> = {}): BuiltTest => ({ id: "math-entry", subject: "math", title: "Entry", kind: "entry", minutes: 12, reuse: [], questions, ...extra });
/** One pool question `q-<topic>` per topic. */
const poolFor = (topics: readonly BuiltTopic[]) => ({ tests: [entry(topics.map((item) => question(`q-${item.id}`, `${item.id}-t`)))] });

/** Runs the test to the end; `knows` says whether the student knows the asked topic. Returns the asked topics and the final state. */
function run(plan: PlacementPlan, knows: (topic: string) => boolean, from: PlacementState = startPlacement(plan)): { asked: string[]; state: PlacementState } {
  let state = from;
  const asked: string[] = [];
  for (let next = nextPlacementQuestion(plan, state); next; next = nextPlacementQuestion(plan, state)) {
    asked.push(next.topic.id);
    state = answerPlacement(plan, state, { topic: next.topic.id, q: next.question.id, score: knows(next.topic.id) ? 1 : 0 });
  }
  return { asked, state };
}

const chain = Array.from({ length: 7 }, (_, index) => topic(`c${index + 1}`, index ? [`c${index}`] : []));

describe("placement on a chain", () => {
  const graph = buildGraph(chain);
  const plan = placementPlan(poolFor(chain), graph, "math");

  it("bisects: the middle topic first, then the middle of what is left", () => {
    expect(nextPlacementQuestion(plan, startPlacement(plan))).toMatchObject({ topic: { id: "c4" }, question: { id: "q-c4" } });
    const { asked, state } = run(plan, (id) => ["c1", "c2", "c3", "c4", "c5"].includes(id));
    expect(asked).toEqual(["c4", "c6", "c5"]);
    expect(state.known).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(state.unknown).toEqual(["c6", "c7"]);
    expect(undetermined(plan, state)).toEqual([]);
    expect(placementDone(plan, state)).toBe(true);
  });
  it("a good answer settles the ancestors, a bad one the descendants", () => {
    const ok = answerPlacement(plan, startPlacement(plan), { topic: "c4", q: "q-c4", score: 0.67 });
    expect(ok).toMatchObject({ known: ["c1", "c2", "c3", "c4"], unknown: [] });
    expect(ok.asked[0]).toEqual({ topic: "c4", q: "q-c4", score: 0.67, ok: true });
    const bad = answerPlacement(plan, startPlacement(plan), { topic: "c4", q: "q-c4", score: 0.5, at: "2026-11-15T10:00:00Z" });
    expect(bad).toMatchObject({ known: [], unknown: ["c4", "c5", "c6", "c7"] });
    expect(bad.asked[0]).toMatchObject({ ok: false, at: "2026-11-15T10:00:00Z" });
    expect(nextPlacementQuestion(plan, bad)?.topic.id).toBe("c2");
  });
  it("knows nothing → 3 questions, knows everything → 3 questions", () => {
    expect(run(plan, () => false)).toMatchObject({ asked: ["c4", "c2", "c1"], state: { known: [], unknown: chain.map((item) => item.id) } });
    expect(run(plan, () => true)).toMatchObject({ asked: ["c4", "c6", "c7"], state: { known: chain.map((item) => item.id), unknown: [] } });
  });
  it("is deterministic and can be resumed from the saved answers", () => {
    const first = run(plan, (id) => id < "c4");
    expect(run(plan, (id) => id < "c4")).toEqual(first);
    const half = resumePlacement(plan, first.state.asked.slice(0, 1));
    expect(run(plan, (id) => id < "c4", half).state).toEqual(first.state);
  });
  it("stops when the student interrupts: what is settled stays, the rest is undetermined", () => {
    const state = stopPlacement(answerPlacement(plan, startPlacement(plan), { topic: "c4", q: "q-c4", score: 1 }));
    expect(nextPlacementQuestion(plan, state)).toBeNull();
    expect(placementDone(plan, state)).toBe(true);
    expect(state.known).toEqual(["c1", "c2", "c3", "c4"]);
    expect(undetermined(plan, state)).toEqual(["c5", "c6", "c7"]);
  });
});

describe("placement on other shapes", () => {
  it("asks at most 8 questions; independent topics are settled one by one, in the canonical order", () => {
    const topics = Array.from({ length: 11 }, (_, index) => topic(`i${String(index).padStart(2, "0")}`));
    const plan = placementPlan(poolFor(topics), buildGraph(topics), "math");
    const { asked, state } = run(plan, () => true);
    expect(asked).toEqual(topics.slice(0, PLACEMENT_MAX_QUESTIONS).map((item) => item.id));
    expect(undetermined(plan, state)).toEqual(["i08", "i09", "i10"]);
    expect(placementMinutes(plan)).toBe(12);
    expect(run(placementPlan(poolFor(topics), buildGraph(topics), "math", { maxQuestions: 2 }), () => true).asked).toHaveLength(2);
  });
  it("in a diamond prefers the topic whose worse outcome settles more, then the larger sum, then the earlier topic", () => {
    //  r → a → m → z,  r → b → m ; plus a leaf l requiring r
    const topics = [topic("r"), topic("a", ["r"]), topic("b", ["r"]), topic("m", ["a", "b"]), topic("z", ["m"]), topic("l", ["r"])];
    const plan = placementPlan(poolFor(topics), buildGraph(topics), "math");
    // a: up 2, down 3 → 2;  b: the same, later;  m: up 4, down 2 → 2 with the larger sum
    expect(nextPlacementQuestion(plan, startPlacement(plan))?.topic.id).toBe("m");
    expect(run(plan, (id) => ["r", "a", "l"].includes(id))).toMatchObject({ asked: ["m", "r", "a", "b", "l"], state: { known: ["r", "a", "l"], unknown: ["b", "m", "z"] } });
  });
  it("never asks a topic without pool questions, but settles it through its neighbours", () => {
    const pack = { tests: [entry([question("q-c2", "c2-t"), question("q-c6", "c6-t"), question("l2", "c4-t", "L2")])] };
    const plan = placementPlan(pack, buildGraph(chain), "math");
    expect([...plan.pool.keys()]).toEqual(["c2", "c6"]);
    const { asked, state } = run(plan, (id) => id === "c2");
    expect(asked).toEqual(["c2", "c6"]);
    expect(state).toMatchObject({ known: ["c1", "c2"], unknown: ["c6", "c7"] });
    expect(undetermined(plan, state)).toEqual(["c3", "c4", "c5"]);
    const empty = placementPlan({ tests: [] }, buildGraph(chain), "math");
    expect(placementDone(empty, startPlacement(empty))).toBe(true);
    expect(placementMinutes(empty)).toBe(0);
  });
  it("counts paths through another subject, but settles only the subject's own topics", () => {
    const topics = [topic("a"), topic("p", ["a"], "phys"), topic("f", ["p"])];
    const graph = buildGraph(topics);
    const plan = placementPlan(poolFor(topics), graph, "math");
    expect(plan.topics.map((item) => item.id)).toEqual(["a", "f"]);
    const state = answerPlacement(plan, startPlacement(plan), { topic: "f", q: "q-f", score: 1 });
    expect(state.known).toEqual(["a", "f"]);
  });
});

describe("entry pool", () => {
  const topics = [topic("a"), topic("b", ["a"]), topic("p", [], "phys")];
  const graph = buildGraph(topics);
  const pack = {
    remap: { "old-b": "b-t" },
    tests: [
      entry([question("a1", "a-t"), question("a2", "a-t", "L1"), question("a3", "a-t", "L2"), question("b1", "old-b"), question("stray", "ghost-t")], { reuse: ["r1", "missing"] }),
      { ...entry([question("r1", "b-t"), question("r2", "a-t")]), id: "topic", kind: "topic" as const, covers: ["a-t", "b-t"] },
      { ...entry([question("p1", "p-t")]), id: "phys-entry", subject: "phys" },
    ],
  };
  it("takes L0/L1 questions of the subject's entry tests (reused first), grouped by topic", () => {
    const pool = entryPool(pack, graph, "math");
    expect(Object.fromEntries([...pool].map(([id, questions]) => [id, questions.map((item) => item.id)]))).toEqual({ b: ["r1", "b1"], a: ["a1", "a2"] });
    expect([...entryPool(pack, graph, "phys").keys()]).toEqual(["p"]);
  });
  it("on a retake prefers questions that were not asked before", () => {
    const plan = placementPlan(pack, graph, "math", { avoid: ["a1", "r1", "b1"] });
    expect(plan.pool.get("a")?.map((item) => item.id)).toEqual(["a2", "a1"]);
    expect(plan.pool.get("b")?.map((item) => item.id)).toEqual(["r1", "b1"]); // nothing else: the old ones are used
    expect(nextPlacementQuestion(plan, startPlacement(plan))?.question.id).toBe("a2");
  });
});

describe("placement document", () => {
  const graph = buildGraph(chain);
  const pack = poolFor(chain);
  const plan = placementPlan(pack, graph, "math");

  it("has finishedAt only when the test is over and survives a round trip", () => {
    expect(placementDocId("math")).toBe("placement-math");
    const one = answerPlacement(plan, startPlacement(plan), { topic: "c4", q: "q-c4", score: 1, at: "2026-11-15T10:01:00Z" });
    const open = placementDoc(plan, one, { startedAt: "2026-11-15T10:00:00Z", now: "2026-11-15T10:01:00Z", attempt: "att-1" });
    expect(open).toEqual({ subject: "math", startedAt: "2026-11-15T10:00:00Z", asked: one.asked, known: ["c1", "c2", "c3", "c4"], unknown: [], attempt: "att-1" });
    expect(placementDoc(plan, stopPlacement(one), { startedAt: "2026-11-15T10:00:00Z", now: "2026-11-15T10:02:00Z" }).finishedAt).toBe("2026-11-15T10:02:00Z");
    expect(parsePlacementDoc({ ...open, updatedAt: "x" })).toEqual(open);
    expect(resumePlacement(plan, parsePlacementDoc(open)!.asked)).toEqual(one);
  });
  it("drops malformed answers and rejects a document without the basics", () => {
    const doc = parsePlacementDoc({ subject: "math", startedAt: "s", asked: [{ topic: "c4", q: "q-c4", score: 0.7 }, { topic: "c2" }, null, { topic: "c1", q: "q", score: "1" }], known: "x" });
    expect(doc).toEqual({ subject: "math", startedAt: "s", asked: [{ topic: "c4", q: "q-c4", score: 0.7, ok: true }], known: [], unknown: [] });
    for (const bad of [null, [], "x", { subject: "math" }, { subject: "math", startedAt: "s" }]) expect(parsePlacementDoc(bad)).toBeNull();
  });
  it("placementKnown replays the answers on the current graph: stale lists and unknown topics do not matter, unknown beats known", () => {
    const doc = parsePlacementDoc({ subject: "math", startedAt: "s", known: ["c7"], asked: [
      { topic: "c3", q: "q-c3", score: 1 }, { topic: "gone", q: "q", score: 1 }, { topic: "c2", q: "q-c2", score: 0 }, { topic: "c6", q: "q-c6", score: 0 },
    ] });
    expect([...placementKnown(pack, graph, [doc, null, undefined])]).toEqual(["c1"]);
    const states = topicStates(pack, graph, { known: placementKnown(pack, graph, [doc]) });
    expect(Object.fromEntries(states)).toMatchObject({ c1: "known", c2: "open", c3: "locked" });
  });
});
