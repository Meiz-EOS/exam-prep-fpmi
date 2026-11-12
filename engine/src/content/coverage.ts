import type { BuiltExamTicket, BuiltTest, BuiltTicket } from "./schema.ts";

/** Levels every theorem of an exam ticket must have in its ticket test (Р-24, W4: L0 and L1 only). */
const TICKET_TEST_LEVELS = ["L0", "L1"] as const;

function coverageGaps(tests: readonly BuiltTest[], targets: readonly { id: string; includes: readonly string[]; levels: (item: string) => readonly string[] }[], select: (test: BuiltTest) => string | undefined): string[] {
  const questionById = new Map(tests.flatMap((test) => test.questions.map((question) => [question.id, question] as const)));
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const gaps: string[] = [];
  for (const test of tests) {
    const targetId = select(test);
    const target = targetId === undefined ? undefined : targetById.get(targetId);
    if (!target) continue;
    const asked = new Set([...test.reuse.map((id) => questionById.get(id)), ...test.questions]
      .filter((question) => question !== undefined)
      .map((question) => `${question.ticket} ${question.level}`));
    for (const item of target.includes) for (const level of target.levels(item)) {
      if (!asked.has(`${item} ${level}`)) gaps.push(`${test.id}: ${item} has no ${level} question`);
    }
  }
  return gaps;
}

/**
 * Р-24: for each exam ticket that has a `kind: ticket` test, every theorem in `includes`
 * must have at least one question per required level (own questions or `reuse`).
 * Returns human-readable gaps; exam tickets without a test are not checked.
 */
export function ticketTestGaps(tests: readonly BuiltTest[], exam: readonly BuiltExamTicket[], tickets: readonly BuiltTicket[] = []): string[] {
  const gaps = coverageGaps(tests.filter((test) => test.level === undefined), exam.map((ticket) => ({ ...ticket, levels: () => TICKET_TEST_LEVELS })), (test) => test.exam);
  const questionById = new Map(tests.flatMap((test) => test.questions.map((question) => [question.id, question] as const)));
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  for (const ticket of exam) {
    const parts = tests.filter((test) => test.kind === "ticket" && test.level === "L2" && test.exam === ticket.id);
    if (parts.length === 0) continue;
    const asked = new Set(parts.flatMap((test) => [...test.reuse.map((id) => questionById.get(id)), ...test.questions]
      .filter((question): question is NonNullable<typeof question> => question !== undefined && question.level === "L2").map((question) => question.ticket)));
    for (const item of ticket.includes) if ((ticketById.get(item)?.maxLevel ?? "L2") === "L2" && !asked.has(item)) gaps.push(`${parts[0]?.id ?? ticket.id}: ${item} has no L2 question`);
  }
  return gaps;
}

/** Returns missing required levels for tickets covered by topic tests. */
export function topicTestGaps(tests: readonly BuiltTest[], tickets: readonly BuiltTicket[]): string[] {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const targets = tests.flatMap((test) => test.kind === "topic" ? [{
    id: test.id,
    includes: test.covers ?? [],
    // Р-46: topic tests retain the L0/L1 syllabus and cap it by each ticket's maxLevel.
    // Р-51: an L2 topic test needs an L2 question for each covered ticket (build-pack admits only L2-capable tickets).
    levels: test.level === "L2" ? () => ["L2"] : (id: string) => byId.get(id)?.maxLevel === "L0" ? ["L0"] : ["L0", "L1"],
  }] : []);
  return coverageGaps(tests, targets, (test) => test.kind === "topic" ? test.id : undefined);
}

/** Р-23, Р-44: planned minutes = 2 per L0, 4 per L1 and 8 per L2 question. */
export function ticketTestMinutes(test: BuiltTest, tests: readonly BuiltTest[]): number {
  const questionById = new Map(tests.flatMap((item) => item.questions.map((question) => [question.id, question] as const)));
  const all = [...test.reuse.map((id) => questionById.get(id)), ...test.questions].filter((question) => question !== undefined);
  return all.reduce((sum, question) => sum + (question.level === "L0" ? 2 : question.level === "L1" ? 4 : 8), 0);
}

/** Р-23, Р-51: topic tests use the same durations as ticket tests (2 / 4 / 8). */
export function topicTestMinutes(test: BuiltTest, tests: readonly BuiltTest[]): number {
  return ticketTestMinutes(test, tests);
}

/** Р-51: ordinary topic tests whose covers contain all covers of the given L2 topic test. */
export function l2TopicParents(test: BuiltTest, tests: readonly BuiltTest[]): BuiltTest[] {
  return tests.filter((other) => other.kind === "topic" && other.level === undefined && other.subject === test.subject && (test.covers ?? []).every((id) => other.covers?.includes(id)));
}
