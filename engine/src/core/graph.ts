// The topic graph of a pack (docs/architecture/14-graph-plan.md): order, relations, topic states.
import type { BuiltPack, BuiltTopic, Question } from "../content/schema.ts";
import { questionValue, type Attempt } from "./ready.ts";

export type Topic = BuiltTopic;

/**
 * Stable topological order (Р-82): repeatedly takes the topic that stands first in `topics` among those whose
 * `requires` are all placed. A `requires` that names no topic of the list is ignored.
 * `cycle` is empty for a DAG; otherwise it is one cycle `[a, b, …]` (a requires b, …, the last requires a)
 * and `order` holds only the topics that do not depend on a cycle.
 */
export function topoOrder<T extends { id: string; requires: readonly string[] }>(topics: readonly T[]): { order: T[]; cycle: string[] } {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const placed = new Set<string>();
  const order: T[] = [];
  const rest = [...topics];
  for (;;) {
    const at = rest.findIndex((topic) => topic.requires.every((id) => placed.has(id) || !byId.has(id)));
    if (at < 0) break;
    const [topic] = rest.splice(at, 1);
    placed.add(topic!.id);
    order.push(topic!);
  }
  if (!rest.length) return { order, cycle: [] };
  // every topic left requires another topic left: walking those links must come back to a visited topic
  const left = new Set(rest.map((topic) => topic.id));
  const path: string[] = [];
  let current = rest[0]!.id;
  while (!path.includes(current)) {
    path.push(current);
    current = byId.get(current)!.requires.find((id) => left.has(id))!;
  }
  return { order, cycle: path.slice(path.indexOf(current)) };
}

export interface TopicGraph {
  /** Every topic of the pack in the canonical order (Р-82). */
  topics: readonly Topic[];
  byId: ReadonlyMap<string, Topic>;
  /** Position of a topic in `topics`. */
  index: ReadonlyMap<string, number>;
  /** Ticket id → id of the topic that contains it. */
  topicOfTicket: ReadonlyMap<string, string>;
  /** Topic id → ids of the topics that require it directly, in the canonical order. */
  dependents: ReadonlyMap<string, readonly string[]>;
}

/** Indexes the topics; the result is in the canonical order whatever the input order was. Throws on a cycle (the pack build rejects it). */
export function buildGraph(source: readonly Topic[]): TopicGraph {
  const { order, cycle } = topoOrder(source);
  if (cycle.length) throw new Error(`topic graph has a cycle: ${[...cycle, cycle[0]].join(" → ")}`);
  const byId = new Map(order.map((topic) => [topic.id, topic]));
  const index = new Map(order.map((topic, position) => [topic.id, position]));
  const topicOfTicket = new Map(order.flatMap((topic) => topic.tickets.map((ticket) => [ticket, topic.id] as const)));
  const dependents = new Map<string, string[]>(order.map((topic) => [topic.id, []]));
  for (const topic of order) for (const id of new Set(topic.requires)) dependents.get(id)?.push(topic.id);
  return { topics: order, byId, index, topicOfTicket, dependents };
}

export function packGraph(pack: Pick<BuiltPack, "graph">): TopicGraph {
  return buildGraph(pack.graph ?? []);
}

function closure(graph: TopicGraph, id: string, step: (id: string) => readonly string[]): string[] {
  const seen = new Set<string>();
  const stack = [...step(id)];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next) || !graph.byId.has(next)) continue;
    seen.add(next);
    stack.push(...step(next));
  }
  seen.delete(id);
  return [...seen].sort((a, b) => graph.index.get(a)! - graph.index.get(b)!);
}

/** Everything the topic depends on, directly or not (any subject), in the canonical order; the topic itself is not included. */
export function ancestors(graph: TopicGraph, id: string): string[] {
  return closure(graph, id, (current) => graph.byId.get(current)?.requires ?? []);
}

/** Everything that depends on the topic, directly or not (any subject), in the canonical order; the topic itself is not included. */
export function descendants(graph: TopicGraph, id: string): string[] {
  return closure(graph, id, (current) => graph.dependents.get(current) ?? []);
}

/** Topics of one subject in the canonical order — the learning order of the subject. */
export function subjectTopics(graph: TopicGraph, subject: string): Topic[] {
  return graph.topics.filter((topic) => topic.subject === subject);
}

/** Whether the subject has a graph at all. */
export function hasGraph(graph: TopicGraph, subject: string): boolean {
  return graph.topics.some((topic) => topic.subject === subject);
}

/** The topic of a ticket; `remap` translates an old ticket id first. */
export function topicOfTicket(graph: TopicGraph, ticket: string, remap: Readonly<Record<string, string>> = {}): Topic | undefined {
  const id = graph.topicOfTicket.get(remap[ticket] ?? ticket);
  return id === undefined ? undefined : graph.byId.get(id);
}

/** 1-based number of the topic inside its subject (the `NN` of the Anki subdeck); 0 for an unknown topic. */
export function topicNumber(graph: TopicGraph, id: string): number {
  const topic = graph.byId.get(id);
  return topic ? subjectTopics(graph, topic.subject).findIndex((item) => item.id === id) + 1 : 0;
}

/** `03 Пределы`: the number padded to two digits (three when the subject has 100+ topics) and the title. */
export function topicLabel(graph: TopicGraph, id: string): string {
  const topic = graph.byId.get(id);
  if (!topic) return "";
  const width = Math.max(2, String(subjectTopics(graph, topic.subject).length).length);
  return `${String(topicNumber(graph, id)).padStart(width, "0")} ${topic.title}`;
}

/** Full name of the topic's Anki subdeck (Р-87): `zachetka::<subject name>::<NN> <topic title>`. */
export function topicDeck(pack: Pick<BuiltPack, "subjects">, graph: TopicGraph, id: string): string {
  const topic = graph.byId.get(id);
  if (!topic) return "";
  const subject = pack.subjects.find((item) => item.id === topic.subject)?.name ?? topic.subject;
  return `zachetka::${subject}::${topicLabel(graph, id)}`;
}

/** Minutes for reading a topic when the graph does not give `minutes`. */
export const TOPIC_MINUTES_PER_TICKET = 4;

/** Planned minutes of the «new topic» step. */
export function topicMinutes(topic: Topic): number {
  return topic.minutes ?? topic.tickets.length * TOPIC_MINUTES_PER_TICKET;
}

type PackQuestions = Pick<BuiltPack, "tests" | "remap">;

/**
 * L0 and L1 questions of the pack (any test, each id once) about the topic's tickets,
 * ordered by the ticket's place in the topic, then L0 before L1, then the order in the pack.
 */
export function topicQuestions(pack: PackQuestions, graph: TopicGraph, id: string): Question[] {
  const topic = graph.byId.get(id);
  if (!topic) return [];
  const place = new Map(topic.tickets.map((ticket, position) => [ticket, position]));
  const seen = new Set<string>();
  const found: { question: Question; ticket: number; order: number }[] = [];
  for (const test of pack.tests ?? []) for (const question of test.questions) {
    const ticket = place.get(pack.remap?.[question.ticket] ?? question.ticket);
    if (ticket === undefined || question.level === "L2" || seen.has(question.id)) continue;
    seen.add(question.id);
    found.push({ question, ticket, order: found.length });
  }
  return found.sort((a, b) => a.ticket - b.ticket || a.question.level.localeCompare(b.question.level) || a.order - b.order).map((item) => item.question);
}

/** A topic counts as learned by answers when this many of its questions are answered (or all of them, if it has fewer)… */
export const LEARNED_MIN_QUESTIONS = 3;
/** …and their mean value (Р-16: the last 3 answers of a question) is at least this. */
export const LEARNED_VALUE = 0.7;

export interface TopicEvidence {
  /** L0/L1 questions of the topic in the pack. */
  total: number;
  /** How many of them have at least one answer. */
  answered: number;
  /** Mean value of the answered questions; null when none is answered. */
  value: number | null;
  /** The answers alone show the topic is learned (Р-83). */
  learned: boolean;
}

export function topicEvidence(pack: PackQuestions, graph: TopicGraph, id: string, attempts: readonly Attempt[]): TopicEvidence {
  const questions = topicQuestions(pack, graph, id);
  const values = questions.map((question) => questionValue(question.id, attempts)).filter((value): value is number => value !== null);
  const value = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
  const learned = value !== null && value >= LEARNED_VALUE && values.length >= Math.min(LEARNED_MIN_QUESTIONS, questions.length);
  return { total: questions.length, answered: values.length, value, learned };
}

/** What the student said about a topic by hand or by finishing its mini-check (`meta/topics`, Р-83). */
export interface TopicMark {
  state: "learned" | "unknown";
  at: string;
}
export type TopicMarks = Readonly<Record<string, TopicMark>>;

export const TOPIC_MARKS_DOC = "topics";

/** Reads untrusted `meta/topics`; malformed marks are dropped one by one. */
export function parseTopicMarks(value: unknown): Record<string, TopicMark> {
  const marks = (value as { marks?: unknown } | null | undefined)?.marks;
  if (!marks || typeof marks !== "object" || Array.isArray(marks)) return {};
  const out: Record<string, TopicMark> = {};
  for (const [id, raw] of Object.entries(marks as Record<string, unknown>)) {
    const mark = raw as { state?: unknown; at?: unknown } | null;
    if (mark && (mark.state === "learned" || mark.state === "unknown") && typeof mark.at === "string") out[id] = { state: mark.state, at: mark.at };
  }
  return out;
}

/**
 * - `known` — the placement test showed it (answered well, or an ancestor of such a topic);
 * - `learned` — marked learned (the mini-check of the daily plan, or by hand), or the answers show it (`topicEvidence`);
 * - `open` — neither, and every topic in `requires` is known or learned: can be studied now;
 * - `locked` — neither, and something in `requires` is still not known or learned.
 * A mark `unknown` beats the placement and the answers.
 */
export type TopicState = "known" | "learned" | "open" | "locked";

export interface KnowledgeInput {
  /** Topic ids known by placement: `placementKnown` of core/placement.ts. */
  known?: ReadonlySet<string>;
  marks?: TopicMarks;
  attempts?: readonly Attempt[];
}

/** State of every topic of the pack. */
export function topicStates(pack: PackQuestions, graph: TopicGraph, input: KnowledgeInput = {}): Map<string, TopicState> {
  const attempts = input.attempts ?? [];
  const done = new Map<string, "known" | "learned">();
  for (const topic of graph.topics) {
    const mark = input.marks?.[topic.id]?.state;
    if (mark === "unknown") continue;
    if (input.known?.has(topic.id)) done.set(topic.id, "known");
    else if (mark === "learned" || topicEvidence(pack, graph, topic.id, attempts).learned) done.set(topic.id, "learned");
  }
  return new Map(graph.topics.map((topic) => [
    topic.id,
    done.get(topic.id) ?? (topic.requires.every((id) => done.has(id) || !graph.byId.has(id)) ? "open" : "locked"),
  ]));
}

/** Open topics of the subject in the canonical order; the first one is the «new topic» of the daily plan. */
export function nextTopics(graph: TopicGraph, states: ReadonlyMap<string, TopicState>, subject: string): Topic[] {
  return subjectTopics(graph, subject).filter((topic) => states.get(topic.id) === "open");
}

export interface SubjectTopicCounts { total: number; known: number; learned: number; open: number; locked: number }

export function subjectTopicCounts(graph: TopicGraph, states: ReadonlyMap<string, TopicState>, subject: string): SubjectTopicCounts {
  const counts: SubjectTopicCounts = { total: 0, known: 0, learned: 0, open: 0, locked: 0 };
  for (const topic of subjectTopics(graph, subject)) {
    counts.total++;
    counts[states.get(topic.id) ?? "locked"]++;
  }
  return counts;
}
