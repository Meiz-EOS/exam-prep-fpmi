// The adaptive entry test (docs/architecture/14-graph-plan.md#placement): a pure state machine over the topic graph.
// The UI shows `nextPlacementQuestion`, grades the answer (Р-17) and feeds the score to `answerPlacement`.
import type { BuiltPack, Question } from "../content/schema.ts";
import { ancestors, descendants, subjectTopics, type Topic, type TopicGraph } from "./graph.ts";

/** The test stops after this many questions (Р-85). */
export const PLACEMENT_MAX_QUESTIONS = 8;
/** An answer with at least this score (Р-17: ticked points / all points) means «knows the topic»: 2 of 3 points pass, 1 of 2 does not. */
export const PLACEMENT_PASS = 0.6;
/** Planned minutes per question of the entry pool. */
export const PLACEMENT_MINUTES_PER_QUESTION = 1.5;

export interface PlacementAnswer {
  topic: string;
  q: string;
  /** 0…1, the same number as the answer's score in `attempts`. */
  score: number;
  ok: boolean;
  at?: string;
}

/** Everything about a subject's test that does not change while it runs. */
export interface PlacementPlan {
  subject: string;
  /** The subject's topics in the canonical order. */
  topics: readonly Topic[];
  /** Topic → its ancestors / descendants inside the subject (paths through other subjects count). */
  above: ReadonlyMap<string, readonly string[]>;
  below: ReadonlyMap<string, readonly string[]>;
  /** Topic → its entry-pool questions, the ones to prefer first. Topics without questions are absent. */
  pool: ReadonlyMap<string, readonly Question[]>;
  maxQuestions: number;
}

export interface PlacementState {
  asked: readonly PlacementAnswer[];
  /** Topics shown to be known: answered well, or an ancestor of such a topic. Canonical order. */
  known: readonly string[];
  /** Topics shown to be unknown: answered badly, or a descendant of such a topic. Canonical order. */
  unknown: readonly string[];
  /** The student interrupted the test. */
  stopped: boolean;
}

type PoolPack = Pick<BuiltPack, "tests" | "remap">;

/**
 * The entry pool of a subject (Р-84): questions of its `kind: entry` tests (reused ones first, then own, each id once),
 * L0 and L1 only, grouped by the topic of the question's ticket. Questions of tickets outside the graph are left out.
 */
export function entryPool(pack: PoolPack, graph: TopicGraph, subject: string): Map<string, Question[]> {
  const byId = new Map((pack.tests ?? []).flatMap((test) => test.questions.map((question) => [question.id, question] as const)));
  const seen = new Set<string>();
  const pool = new Map<string, Question[]>();
  for (const test of pack.tests ?? []) {
    if (test.kind !== "entry" || test.subject !== subject) continue;
    for (const question of [...test.reuse.map((id) => byId.get(id)), ...test.questions]) {
      if (!question || question.level === "L2" || seen.has(question.id)) continue;
      seen.add(question.id);
      const topic = graph.topicOfTicket.get(pack.remap?.[question.ticket] ?? question.ticket);
      const owner = topic === undefined ? undefined : graph.byId.get(topic);
      if (!owner || owner.subject !== subject) continue;
      pool.set(owner.id, [...(pool.get(owner.id) ?? []), question]);
    }
  }
  return pool;
}

export interface PlacementOptions {
  maxQuestions?: number;
  /** Question ids to use only when a topic has nothing else: the ones asked in earlier runs, so that a retake differs. */
  avoid?: Iterable<string>;
}

export function placementPlan(pack: PoolPack, graph: TopicGraph, subject: string, options: PlacementOptions = {}): PlacementPlan {
  const topics = subjectTopics(graph, subject);
  const own = new Set(topics.map((topic) => topic.id));
  const inside = (ids: string[]): string[] => ids.filter((id) => own.has(id));
  const avoid = new Set(options.avoid ?? []);
  const pool = new Map([...entryPool(pack, graph, subject)].map(([topic, questions]) =>
    [topic, [...questions.filter((question) => !avoid.has(question.id)), ...questions.filter((question) => avoid.has(question.id))]] as const));
  return {
    subject, topics, pool,
    above: new Map(topics.map((topic) => [topic.id, inside(ancestors(graph, topic.id))])),
    below: new Map(topics.map((topic) => [topic.id, inside(descendants(graph, topic.id))])),
    maxQuestions: options.maxQuestions ?? PLACEMENT_MAX_QUESTIONS,
  };
}

/**
 * What the answers show (Р-85), whatever their order: a bad answer makes the topic and its descendants unknown,
 * a good one makes the topic and its ancestors known; where the two disagree, unknown wins.
 * Answers about topics that are not in the plan are ignored.
 */
function derive(plan: PlacementPlan, asked: readonly PlacementAnswer[], stopped: boolean): PlacementState {
  const unknown = new Set<string>();
  const known = new Set<string>();
  for (const answer of asked) if (!answer.ok && plan.below.has(answer.topic)) for (const id of [answer.topic, ...plan.below.get(answer.topic)!]) unknown.add(id);
  for (const answer of asked) if (answer.ok && plan.above.has(answer.topic)) for (const id of [answer.topic, ...plan.above.get(answer.topic)!]) if (!unknown.has(id)) known.add(id);
  const ordered = (ids: Set<string>): string[] => plan.topics.filter((topic) => ids.has(topic.id)).map((topic) => topic.id);
  return { asked, known: ordered(known), unknown: ordered(unknown), stopped };
}

export function startPlacement(plan: PlacementPlan): PlacementState {
  return derive(plan, [], false);
}

/** The state after the answers of a saved run (`meta/placement-<subject>` → `asked`), to continue it. */
export function resumePlacement(plan: PlacementPlan, asked: readonly PlacementAnswer[], stopped = false): PlacementState {
  return derive(plan, asked, stopped);
}

/** Topics the test has said nothing about yet, in the canonical order. When the test ends they count as unknown. */
export function undetermined(plan: PlacementPlan, state: PlacementState): string[] {
  const settled = new Set([...state.known, ...state.unknown]);
  return plan.topics.filter((topic) => !settled.has(topic.id)).map((topic) => topic.id);
}

/**
 * The next question, or null when the test is over. The topic is the undetermined one (with a question left) that
 * bisects best: it maximises the number of topics settled by the worse of the two outcomes — min(itself + undetermined
 * ancestors, itself + undetermined descendants); ties go to the larger sum of the two, then to the earlier topic.
 * The question is the topic's first pool question that was not asked in this run.
 */
export function nextPlacementQuestion(plan: PlacementPlan, state: PlacementState): { topic: Topic; question: Question } | null {
  if (state.stopped || state.asked.length >= plan.maxQuestions) return null;
  const open = new Set(undetermined(plan, state));
  const used = new Set(state.asked.map((answer) => answer.q));
  let best: { topic: Topic; question: Question; worst: number; sum: number } | null = null;
  for (const topic of plan.topics) {
    if (!open.has(topic.id)) continue;
    const question = plan.pool.get(topic.id)?.find((item) => !used.has(item.id));
    if (!question) continue;
    const up = 1 + plan.above.get(topic.id)!.filter((id) => open.has(id)).length;
    const down = 1 + plan.below.get(topic.id)!.filter((id) => open.has(id)).length;
    const worst = Math.min(up, down);
    if (!best || worst > best.worst || (worst === best.worst && up + down > best.sum)) best = { topic, question, worst, sum: up + down };
  }
  return best && { topic: best.topic, question: best.question };
}

/** Records the graded answer to the question `nextPlacementQuestion` gave. */
export function answerPlacement(plan: PlacementPlan, state: PlacementState, answer: { topic: string; q: string; score: number; at?: string }): PlacementState {
  const entry: PlacementAnswer = { topic: answer.topic, q: answer.q, score: answer.score, ok: answer.score >= PLACEMENT_PASS, ...(answer.at !== undefined ? { at: answer.at } : {}) };
  return derive(plan, [...state.asked, entry], state.stopped);
}

/** The student interrupts: what is known so far is the result. */
export function stopPlacement(state: PlacementState): PlacementState {
  return { ...state, stopped: true };
}

/** Over: interrupted, the question limit is reached, or no undetermined topic has a question left. */
export function placementDone(plan: PlacementPlan, state: PlacementState): boolean {
  return nextPlacementQuestion(plan, state) === null;
}

/** Planned minutes of the whole test, for the screen before it starts. */
export function placementMinutes(plan: PlacementPlan): number {
  return Math.ceil(Math.min(plan.maxQuestions, plan.pool.size) * PLACEMENT_MINUTES_PER_QUESTION);
}

/** Document `meta/placement-<subject>` (Р-86). */
export interface PlacementDoc {
  subject: string;
  startedAt: string;
  /** Set when the test is over (also when interrupted); absent while it can be continued. */
  finishedAt?: string;
  asked: PlacementAnswer[];
  /** Copies of the derived lists for whoever reads the data by hand; the app recomputes them from `asked`. */
  known: string[];
  unknown: string[];
  /** Id of the `attempts` document with the answer texts. */
  attempt?: string;
}

export const placementDocId = (subject: string): string => `placement-${subject}`;
/** `test` of the `attempts` document that keeps the answers of a subject's placement runs. */
export const placementAttemptTest = (subject: string): string => `placement-${subject}`;

/** The document body for the current state; `finishedAt` is written only when the test is over. */
export function placementDoc(plan: PlacementPlan, state: PlacementState, run: { startedAt: string; now: string; attempt?: string }): PlacementDoc {
  return {
    subject: plan.subject, startedAt: run.startedAt,
    ...(placementDone(plan, state) ? { finishedAt: run.now } : {}),
    asked: [...state.asked], known: [...state.known], unknown: [...state.unknown],
    ...(run.attempt !== undefined ? { attempt: run.attempt } : {}),
  };
}

/** Reads an untrusted placement document; malformed answers are dropped one by one. */
export function parsePlacementDoc(value: unknown): PlacementDoc | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.subject !== "string" || typeof raw.startedAt !== "string" || !Array.isArray(raw.asked)) return null;
  const asked = raw.asked.flatMap((entry): PlacementAnswer[] => {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item.topic !== "string" || typeof item.q !== "string" || typeof item.score !== "number" || !Number.isFinite(item.score)) return [];
    return [{ topic: item.topic, q: item.q, score: item.score, ok: typeof item.ok === "boolean" ? item.ok : item.score >= PLACEMENT_PASS, ...(typeof item.at === "string" ? { at: item.at } : {}) }];
  });
  const ids = (list: unknown): string[] => (Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
  return {
    subject: raw.subject, startedAt: raw.startedAt,
    ...(typeof raw.finishedAt === "string" ? { finishedAt: raw.finishedAt } : {}),
    asked, known: ids(raw.known), unknown: ids(raw.unknown),
    ...(typeof raw.attempt === "string" ? { attempt: raw.attempt } : {}),
  };
}

/**
 * Topic ids known by placement, for `topicStates`: every subject's document replayed on the current graph,
 * so that a later edit of the graph cannot leave a stale list. An unfinished run counts with what it has.
 */
export function placementKnown(pack: PoolPack, graph: TopicGraph, docs: Iterable<PlacementDoc | null | undefined>): Set<string> {
  const known = new Set<string>();
  for (const doc of docs) {
    if (!doc) continue;
    for (const id of resumePlacement(placementPlan(pack, graph, doc.subject), doc.asked).known) known.add(id);
  }
  return known;
}
