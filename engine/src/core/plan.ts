// The daily plan (docs/architecture/14-graph-plan.md#today): a pure function from the pack and the progress
// to the queue of steps «placement → Anki reviews → new topic → mini-check». The screen only draws it.
import type { BuiltPack, Question, TodayDoc } from "../content/schema.ts";
import { hasGraph, LEARNED_VALUE, nextTopics, subjectTopics, topicDeck, topicMinutes, topicQuestions, type Topic, type TopicGraph, type TopicState } from "./graph.ts";
import { placementMinutes, placementPlan, type PlacementDoc } from "./placement.ts";
import { answerScore, questionValue, type Answer, type Attempt } from "./ready.ts";
import { moscowDate } from "./today.ts";

/** Id of the `meta` document with the state of the day. */
export const DAY_DOC = "day";
/** Questions of a mini-check. */
export const CHECK_QUESTIONS = 3;
/** A mini-check with at least this mean score marks the topic learned (the same bar as `topicEvidence`). */
export const CHECK_PASS = LEARNED_VALUE;
/** Planned seconds per Anki review. */
export const ANKI_SECONDS_PER_CARD = 8;
/** Minutes of the Anki step when the number of due cards is unknown. */
export const ANKI_DEFAULT_MINUTES = 10;
/** Planned minutes per question of a mini-check (Р-23). */
export const CHECK_MINUTES: Readonly<Record<Question["level"], number>> = { L0: 2, L1: 4, L2: 8 };

/** `test` of the `attempts` document that keeps the answers of a topic's mini-checks. */
export const checkAttemptTest = (topic: string): string => `check-${topic}`;

/** Whether an `attempts` document belongs to a placement run or a mini-check, not to a test of the pack. */
export function isSyntheticTest(pack: Pick<BuiltPack, "tests">, test: string): boolean {
  return (test.startsWith("placement-") || test.startsWith("check-")) && !(pack.tests ?? []).some((item) => item.id === test);
}

/**
 * Subject of an `attempts` document: the subject of its test, or — for `placement-<subject>` and `check-<topic>`,
 * which name no test of the pack — the subject they are about. Undefined when nothing matches.
 */
export function attemptSubject(pack: Pick<BuiltPack, "tests" | "subjects" | "graph">, test: string): string | undefined {
  const own = (pack.tests ?? []).find((item) => item.id === test)?.subject;
  if (own !== undefined) return own;
  if (test.startsWith("placement-")) return pack.subjects.find((subject) => subject.id === test.slice("placement-".length))?.id;
  if (test.startsWith("check-")) return (pack.graph ?? []).find((topic) => topic.id === test.slice("check-".length))?.subject;
  return undefined;
}

export interface DayDone { anki?: string; theory?: string; check?: string }

/** Document `meta/day` (Р-86). */
export interface DayDoc {
  /** Moscow date the document is about. */
  date: string;
  subject?: string;
  topic?: string;
  done: DayDone;
  /** Id of the `attempts` document of today's mini-check. */
  check?: string;
  /** Topics finished earlier today, before «one more topic» was asked. */
  finished: string[];
}

/** Reads untrusted `meta/day`; fields set to null (cleared by a merge-patch) count as absent. */
export function parseDayDoc(value: unknown): DayDoc | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
  const rawDone = raw.done && typeof raw.done === "object" && !Array.isArray(raw.done) ? raw.done as Record<string, unknown> : {};
  const done: DayDone = {};
  for (const key of ["anki", "theory", "check"] as const) if (typeof rawDone[key] === "string") done[key] = rawDone[key];
  return {
    date: raw.date,
    ...(typeof raw.subject === "string" ? { subject: raw.subject } : {}),
    ...(typeof raw.topic === "string" ? { topic: raw.topic } : {}),
    done,
    ...(typeof raw.check === "string" ? { check: raw.check } : {}),
    finished: Array.isArray(raw.finished) ? raw.finished.filter((id): id is string => typeof id === "string") : [],
  };
}

/** The day state for `date`: a document of another date starts a new day and keeps only the subject. */
export function dayFor(doc: DayDoc | null, date: string): DayDoc {
  if (doc && doc.date === date) return doc;
  return { date, ...(doc?.subject !== undefined ? { subject: doc.subject } : {}), done: {}, finished: [] };
}

/** The body to write to `meta/day`: absent fields are written as null so that a merge-patch clears them. */
export function dayPatch(day: DayDoc): Record<string, unknown> {
  return { date: day.date, subject: day.subject ?? null, topic: day.topic ?? null, done: { ...day.done }, check: day.check ?? null, finished: [...day.finished] };
}

const sameDay = (a: DayDoc, b: DayDoc): boolean => JSON.stringify(dayPatch(a)) === JSON.stringify(dayPatch(b));

type PlanPack = Pick<BuiltPack, "subjects" | "exams" | "tests" | "remap" | "tickets" | "theory">;

/**
 * The subject of the plan (Р-88) among subjects with a graph: the stored one while it has an open topic (or today's
 * steps are already under way); else the one with the nearest coming exam that has an open topic; else the first with
 * an open topic; else the stored one or the first with a graph. Null when no subject has a graph.
 */
export function planSubject(pack: PlanPack, graph: TopicGraph, states: ReadonlyMap<string, TopicState>, day: DayDoc): string | null {
  const subjects = pack.subjects.filter((subject) => hasGraph(graph, subject.id)).map((subject) => subject.id);
  if (!subjects.length) return null;
  const hasOpen = (subject: string): boolean => nextTopics(graph, states, subject).length > 0;
  const stored = day.subject !== undefined && subjects.includes(day.subject) ? day.subject : undefined;
  const underWay = day.topic !== undefined && (day.done.theory !== undefined || day.done.check !== undefined);
  if (stored !== undefined && (hasOpen(stored) || underWay)) return stored;
  const open = subjects.filter(hasOpen);
  const examOf = (subject: string): string | undefined => pack.exams.filter((exam) => exam.subject === subject && exam.date >= day.date).map((exam) => exam.date).sort()[0];
  const byExam = open.filter((subject) => examOf(subject) !== undefined).sort((a, b) => examOf(a)!.localeCompare(examOf(b)!));
  return byExam[0] ?? open[0] ?? stored ?? subjects[0]!;
}

/**
 * Questions of a topic's mini-check (Р-88): candidates are `topicQuestions`; never answered first, then by rising
 * value; one per ticket until there are `count`, then the next ones in that order. `keep` — questions already asked in
 * the run being continued — are always in. The result is in the order of `topicQuestions`.
 */
export function checkQuestions(pack: Pick<BuiltPack, "tests" | "remap">, graph: TopicGraph, topic: string, attempts: readonly Attempt[], keep: readonly string[] = [], count = CHECK_QUESTIONS): Question[] {
  const all = topicQuestions(pack, graph, topic);
  const value = new Map(all.map((question) => [question.id, questionValue(question.id, attempts)]));
  const ranked = all.map((question, order) => ({ question, order })).sort((a, b) => {
    const [va, vb] = [value.get(a.question.id) ?? null, value.get(b.question.id) ?? null];
    if (va === null || vb === null) return va === vb ? a.order - b.order : va === null ? -1 : 1;
    return va - vb || a.order - b.order;
  }).map((item) => item.question);
  const ticketOf = (question: Question): string => pack.remap?.[question.ticket] ?? question.ticket;
  const picked = new Set(all.filter((question) => keep.includes(question.id)).map((question) => question.id));
  const tickets = new Set(all.filter((question) => picked.has(question.id)).map(ticketOf));
  for (const question of ranked) {
    if (picked.size >= count) break;
    if (picked.has(question.id) || tickets.has(ticketOf(question))) continue;
    picked.add(question.id);
    tickets.add(ticketOf(question));
  }
  for (const question of ranked) {
    if (picked.size >= count) break;
    picked.add(question.id);
  }
  return all.filter((question) => picked.has(question.id));
}

/** Planned minutes of a mini-check. */
export function checkMinutes(questions: readonly Question[]): number {
  return questions.reduce((sum, question) => sum + CHECK_MINUTES[question.level], 0);
}

/** Mean score of the answers (Р-17, the agent's grade wins) and whether the mini-check is passed; null without answers. */
export function checkResult(answers: readonly Pick<Answer, "agent" | "gross" | "self">[]): { value: number; passed: boolean } | null {
  if (!answers.length) return null;
  const value = answers.reduce((sum, answer) => sum + answerScore(answer), 0) / answers.length;
  return { value, passed: value >= CHECK_PASS };
}

/** Planned minutes of the Anki step: 8 seconds per due card; 10 minutes when the number is unknown. */
export function ankiMinutes(due: number | null): number {
  return due === null ? ANKI_DEFAULT_MINUTES : Math.ceil((due * ANKI_SECONDS_PER_CARD) / 60);
}

export interface PlanTicket { id: string; title: string; src?: string; theory: boolean }
/** How much of a topic has theory in the pack: the «new topic» step tells what to read accordingly. */
export type TheoryCover = "all" | "some" | "none";
export function theoryCover(tickets: readonly Pick<PlanTicket, "theory">[]): TheoryCover {
  const n = tickets.filter((ticket) => ticket.theory).length;
  return n === 0 ? "none" : n === tickets.length ? "all" : "some";
}

export type PlanStep =
  /** The entry test of the subject is not taken yet; `asked` > 0 — a run can be continued. */
  | { id: "placement"; minutes: number; done: false; asked: number }
  /** `due` — cards to review by the agent's summary of today, or null. */
  | { id: "anki"; minutes: number; done: boolean; due: number | null }
  | { id: "theory"; minutes: number; done: boolean; topic: Topic; deck: string; tickets: PlanTicket[] }
  /** No `questions` — the topic can only be marked learned by hand. `attempt` — today's run to continue. */
  | { id: "check"; minutes: number; done: boolean; topic: Topic; questions: Question[]; attempt?: string };

export interface PlanInput {
  pack: PlanPack;
  graph: TopicGraph;
  states: ReadonlyMap<string, TopicState>;
  /** Raw `meta/day`. */
  day: unknown;
  /** `meta/today` of the agent, parsed (any date). */
  agent?: TodayDoc | null;
  /** Parsed `meta/placement-*` documents. */
  placements?: readonly (PlacementDoc | null | undefined)[];
  /** Attempt documents; `id` is needed to find today's unfinished mini-check. */
  attempts?: readonly (Attempt & { id?: string })[];
  now: Date;
}

export interface DayPlan {
  date: string;
  /** Null: no subject of the pack has a graph — there is nothing to plan. */
  subject: string | null;
  /** Subjects that can be chosen, in the order of `pack.yaml`. */
  subjects: { id: string; name: string; open: number }[];
  /** The day state the plan was built for; write it (`dayPatch`) when `dirty`. */
  day: DayDoc;
  /** `day` differs from the stored document: a new day, a chosen subject or topic. */
  dirty: boolean;
  topic: Topic | null;
  /** Why there is no topic: every topic of the subject is passed, or the open ones wait for topics of other subjects. */
  noTopic: null | { reason: "all" } | { reason: "blocked"; by: Topic[] };
  steps: PlanStep[];
  /** Minutes of all steps and of the ones still to do. */
  minutes: number;
  left: number;
  /** The first step that is not done. */
  next: PlanStep | null;
  /** Every step of today is done (and the placement is not pending). */
  allDone: boolean;
  /** Today's topic became learned (by the mini-check or a mark). */
  topicLearned: boolean;
}

const isDone = (state: TopicState | undefined): boolean => state === "known" || state === "learned";

/** The plan of the day. Pure: same input — same plan. */
export function dayPlan(input: PlanInput): DayPlan {
  const { pack, graph, states } = input;
  const attempts = input.attempts ?? [];
  const date = moscowDate(input.now);
  const stored = parseDayDoc(input.day);
  let day = dayFor(stored, date);
  const subjects = pack.subjects.filter((subject) => hasGraph(graph, subject.id))
    .map((subject) => ({ id: subject.id, name: subject.name, open: nextTopics(graph, states, subject.id).length }));
  const subject = planSubject(pack, graph, states, day);
  const empty = { date, subjects, minutes: 0, left: 0, next: null, allDone: false, topicLearned: false };
  if (subject === null) return { ...empty, subject, day, dirty: false, topic: null, noTopic: null, steps: [] };
  if (day.subject !== subject) day = { ...day, subject };

  // Step 0: the entry test, while the subject has a pool and no finished placement document.
  const placement = (input.placements ?? []).find((doc) => doc?.subject === subject) ?? null;
  const pool = placementPlan(pack, graph, subject);
  const steps: PlanStep[] = [];
  const placementPending = pool.pool.size > 0 && placement?.finishedAt === undefined;
  if (placementPending) steps.push({ id: "placement", minutes: placementMinutes(pool), done: false, asked: placement?.asked.length ?? 0 });

  // Step 1: reviews in Anki.
  const agentToday = input.agent?.anki && moscowDate(new Date(input.agent.anki.at)) === date ? input.agent.anki.due : null;
  steps.push({ id: "anki", minutes: ankiMinutes(agentToday), done: day.done.anki !== undefined, due: agentToday });

  // The topic of the day: the stored one while it still makes sense, else the first open topic.
  const open = nextTopics(graph, states, subject);
  const kept = day.topic === undefined ? undefined : graph.byId.get(day.topic);
  const keptState = kept && states.get(kept.id);
  const keep = kept !== undefined && kept.subject === subject && keptState !== "known" && keptState !== "locked"
    && (keptState !== "learned" || day.done.check !== undefined);
  const topic = keep ? kept : open.find((item) => !day.finished.includes(item.id)) ?? open[0] ?? null;
  if (!keep) {
    // a new topic starts with its own steps; while the placement is pending the choice is not final and is not stored
    const { theory: _theory, check: _check, ...rest } = day.done;
    const { topic: _topic, check: _attempt, ...base } = day;
    day = { ...base, done: rest, ...(topic && !placementPending ? { topic: topic.id } : {}) };
  }

  let noTopic: DayPlan["noTopic"] = null;
  if (topic) {
    const tickets = topic.tickets.map((id): PlanTicket => {
      const ticket = pack.tickets?.find((item) => item.id === id);
      return { id, title: ticket?.title ?? id, ...(ticket?.src !== undefined ? { src: ticket.src } : {}), theory: (pack.theory ?? []).some((entry) => entry.ticket === id) };
    });
    steps.push({ id: "theory", minutes: topicMinutes(topic), done: day.done.theory !== undefined, topic, deck: topicDeck(pack, graph, topic.id), tickets });
    // today's unfinished run of the check keeps its questions; its answers do not reorder the choice
    const run = day.check === undefined ? undefined : attempts.find((attempt) => attempt.id === day.check && attempt.finishedAt === undefined);
    const asked = run?.answers.map((answer) => answer.q) ?? [];
    const questions = checkQuestions(pack, graph, topic.id, run ? attempts.filter((attempt) => attempt !== run) : attempts, asked);
    steps.push({ id: "check", minutes: checkMinutes(questions), done: day.done.check !== undefined, topic, questions, ...(run && day.check !== undefined ? { attempt: day.check } : {}) });
  } else {
    const waiting = subjectTopics(graph, subject).filter((item) => states.get(item.id) === "locked");
    const by = [...new Set(waiting.flatMap((item) => item.requires))].map((id) => graph.byId.get(id))
      .filter((item): item is Topic => item !== undefined && item.subject !== subject && !isDone(states.get(item.id)));
    noTopic = waiting.length ? { reason: "blocked", by } : { reason: "all" };
  }

  const next = steps.find((step) => !step.done) ?? null;
  return {
    date, subject, subjects, day, dirty: stored === null || !sameDay(stored, day), topic, noTopic, steps,
    minutes: steps.reduce((sum, step) => sum + step.minutes, 0),
    left: steps.reduce((sum, step) => sum + (step.done ? 0 : step.minutes), 0),
    next, allDone: next === null,
    topicLearned: topic !== null && states.get(topic.id) === "learned",
  };
}

/** `meta/day` after the student picks another subject: today's topic steps are dropped unless one is already ticked. */
export function chooseSubject(day: DayDoc, subject: string): DayDoc {
  if (day.subject === subject) return day;
  if (day.done.theory !== undefined || day.done.check !== undefined) {
    // the started topic is closed as it is; the new subject starts with a fresh one
    const { theory: _theory, check: _check, ...done } = day.done;
    const { topic, check: _attempt, ...base } = day;
    return { ...base, subject, done, finished: topic !== undefined ? [...day.finished, topic] : day.finished };
  }
  const { topic: _topic, check: _attempt, ...base } = day;
  return { ...base, subject };
}

/** `meta/day` after «one more topic»: today's topic goes to `finished`, its steps are cleared, the Anki tick stays. */
export function oneMoreTopic(day: DayDoc): DayDoc {
  const { topic, check: _attempt, ...base } = day;
  const { theory: _theory, check: _check, ...done } = day.done;
  return { ...base, done, finished: topic !== undefined && !day.finished.includes(topic) ? [...day.finished, topic] : day.finished };
}
