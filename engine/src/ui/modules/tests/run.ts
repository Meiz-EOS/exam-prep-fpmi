import type { BuiltPack, BuiltTest, Question } from "../../../content/schema";
import type { Doc, ProgressStore } from "../../../store/types";

/** One graded answer in an attempt (04-knowledge.md#tests). */
export interface Answer {
  q: string;
  text: string;
  /** Indexes of the reference points the student ticked. */
  hits: number[];
  gross?: true;
  /** 0…1: ticked / all points, 0 on a gross error. */
  self: number;
  agent?: number;
  agentNote?: string;
  at: string;
}

export interface Attempt {
  id: string;
  test: string;
  startedAt: string;
  finishedAt?: string;
  answers: Answer[];
}

/** Test questions: reused ones first (from any test of the pack), then the test's own; duplicates dropped. */
export function testQuestions(pack: BuiltPack, test: BuiltTest): Question[] {
  const byId = new Map<string, Question>();
  for (const t of pack.tests ?? []) for (const q of t.questions) if (!byId.has(q.id)) byId.set(q.id, q);
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const q of [...test.reuse.map((id) => byId.get(id)), ...test.questions]) {
    if (q && !seen.has(q.id)) { seen.add(q.id); out.push(q); }
  }
  return out;
}

/** Self score: ticked points / all points; a gross error zeroes it (Р-17). */
export function selfScore(hits: number, points: number, gross: boolean): number {
  if (gross || points <= 0) return 0;
  return Math.round((hits / points) * 100) / 100;
}

export function toAttempt(d: Doc): Attempt {
  return {
    id: d.id,
    test: String(d.test ?? ""),
    startedAt: String(d.startedAt ?? ""),
    finishedAt: typeof d.finishedAt === "string" ? d.finishedAt : undefined,
    answers: Array.isArray(d.answers) ? (d.answers as Answer[]) : [],
  };
}

/** Index of the first question without an answer; questions.length when all are answered. */
export function nextIndex(questions: readonly Question[], answers: readonly Answer[]): number {
  const done = new Set(answers.map((a) => a.q));
  const i = questions.findIndex((q) => !done.has(q.id));
  return i < 0 ? questions.length : i;
}

/** The latest attempt of the test, and the latest unfinished one. */
export function attemptsOf(all: readonly Attempt[], test: string): { latest?: Attempt; open?: Attempt } {
  const mine = all.filter((a) => a.test === test).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { latest: mine[0], open: mine.find((a) => !a.finishedAt) };
}

/** Creates the attempt document at the start of a run. */
export function startRun(store: ProgressStore, test: string, now = new Date()): Promise<string> {
  return store.create("attempts", { test, startedAt: now.toISOString(), answers: [] });
}

/**
 * Appends a graded answer right after grading: writes the full answers array;
 * the last answer also sets finishedAt. Returns the new answers.
 */
export async function appendAnswer(
  store: ProgressStore, id: string, prior: readonly Answer[], answer: Answer, totalQuestions: number,
): Promise<Answer[]> {
  const answers = [...prior, answer];
  const patch: Record<string, unknown> = { answers };
  if (answers.length >= totalQuestions) patch.finishedAt = answer.at;
  await store.update("attempts", id, patch);
  return answers;
}

export function minutesBetween(from: string, to: Date): number {
  const ms = to.getTime() - new Date(from).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}
