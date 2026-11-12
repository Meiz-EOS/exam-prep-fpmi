import type { BuiltPack, BuiltTest, Question } from "../content/schema.ts";

export interface Answer {
  q: string;
  at: string;
  text: string;
  hits: number[];
  self: number;
  agent?: number;
  gross?: boolean;
}

export interface Attempt {
  test: string;
  startedAt: string;
  finishedAt?: string;
  answers: Answer[];
}

export type Level = "L0" | "L1" | "L2";
export interface ReadyCell {
  ticket: string;
  level: Level;
  value: number | null;
  mastered: boolean;
}

export interface MissingReady {
  levels: Level[];
  tickets: string[];
}

export interface SubjectReady {
  subject: string;
  shares: Partial<Record<Level, number>>;
  toUd: boolean;
  toHor: boolean;
  missing: { ud: MissingReady; hor: MissingReady };
  cells: ReadyCell[];
}

const LEVELS: Level[] = ["L0", "L1", "L2"];
const recent = 3;

export function answerScore(answer: Pick<Answer, "agent" | "gross" | "self">): number {
  return answer.agent ?? (answer.gross ? 0 : answer.self);
}

function recentAnswers(questionId: string, attempts: readonly Attempt[]): Answer[] {
  return attempts.flatMap((attempt) => attempt.answers)
    .filter((answer) => answer.q === questionId)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-recent);
}

export function questionValue(questionId: string, attempts: readonly Attempt[]): number | null {
  const answers = recentAnswers(questionId, attempts);
  return answers.length ? answers.reduce((sum, answer) => sum + answerScore(answer), 0) / answers.length : null;
}

function moscowDay(at: string): string | null {
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function cellQuestions(tests: readonly BuiltTest[], ticketId: string, level: Level, remap: Readonly<Record<string, string>>): Question[] {
  return tests.flatMap((test) => test.questions)
    .filter((question) => (remap[question.ticket] ?? question.ticket) === ticketId && question.level === level);
}

export function cell(
  ticketId: string,
  level: Level,
  tests: readonly BuiltTest[],
  attempts: readonly Attempt[],
  remap: Readonly<Record<string, string>> = {},
): ReadyCell {
  const questions = cellQuestions(tests, ticketId, level, remap);
  const values = questions.map((question) => questionValue(question.id, attempts)).filter((value): value is number => value !== null);
  const value = values.length ? values.reduce((sum, current) => sum + current, 0) / values.length : null;
  const answers = questions.flatMap((question) => recentAnswers(question.id, attempts))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-recent);
  const days = answers.map((answer) => moscowDay(answer.at));
  const mastered = value !== null && value >= 0.8 && answers.length === recent
    && answers.every((answer) => answerScore(answer) >= 0.8)
    && days.every((day) => day !== null) && new Set(days).size === recent;
  return { ticket: ticketId, level, value, mastered };
}

function missingFor(cells: readonly ReadyCell[], levels: readonly Level[], thresholds: Partial<Record<Level, number>>, keyTickets: readonly string[] = []): MissingReady {
  const relevant = cells.filter((item) => levels.includes(item.level));
  const absent = relevant.filter((item) => !item.mastered);
  const keyAbsent = cells.filter((item) => item.level === "L2" && keyTickets.includes(item.ticket) && !item.mastered);
  return {
    levels: levels.filter((level) => {
      const atLevel = relevant.filter((item) => item.level === level);
      const threshold = thresholds[level];
      return threshold !== undefined && (atLevel.length === 0 || atLevel.filter((item) => item.mastered).length / atLevel.length < threshold);
    }),
    tickets: [...new Set([...absent.map((item) => item.ticket), ...keyAbsent.map((item) => item.ticket)])],
  };
}

export function subjectReady(
  subjectId: string,
  pack: Pick<BuiltPack, "tickets" | "exam" | "tests" | "thresholds">,
  attempts: readonly Attempt[],
  now: Date,
  remap: Readonly<Record<string, string>> = {},
): SubjectReady {
  // `now` is explicit so callers anchor a summary to a known instant; answer dates themselves determine mastery days.
  void now;
  const theoremTickets = (pack.tickets ?? []).filter((ticket) => ticket.subject === subjectId);
  const examTickets = (pack.exam ?? []).filter((ticket) => ticket.subject === subjectId);
  const tickets = examTickets.length ? examTickets : theoremTickets;
  const theoremCells = LEVELS.flatMap((level) => theoremTickets.filter((ticket) => !ticket.maxLevel || LEVELS.indexOf(level) <= LEVELS.indexOf(ticket.maxLevel)).map((ticket) => cell(ticket.id, level, pack.tests ?? [], attempts, remap)));
  const cells = examTickets.length ? LEVELS.flatMap((level) => examTickets.map((ticket) => {
    // Р-43/Р-46: aggregate an exam level only from included theorems that have that level.
    const included = ticket.includes.filter((id) => {
      const theorem = theoremTickets.find((item) => item.id === id);
      return theorem && (!theorem.maxLevel || LEVELS.indexOf(level) <= LEVELS.indexOf(theorem.maxLevel));
    });
    if (!included.length) return null;
    const eligible = included.map((id) => theoremCells.find((item) => item.ticket === id && item.level === level)).filter((item): item is ReadyCell => item !== undefined);
    const answered = eligible.filter((item) => item.value !== null);
    return { ticket: ticket.id, level, value: answered.length ? answered.reduce((sum, item) => sum + item.value!, 0) / answered.length : null,
      mastered: eligible.length > 0 && eligible.every((item) => item.mastered) };
  })).filter((item): item is ReadyCell => item !== null) : theoremCells;
  const shares: Partial<Record<Level, number>> = {};
  for (const level of LEVELS) {
    const levelCells = cells.filter((item) => item.level === level);
    if (levelCells.length) shares[level] = levelCells.filter((item) => item.mastered).length / levelCells.length;
  }
  const thresholds = pack.thresholds;
  const udLevels: Level[] = ["L0", "L1"];
  const horLevels: Level[] = ["L0", "L1", "L2"];
  const udMissing = missingFor(cells, udLevels, thresholds?.ud ?? {});
  // key tickets count as missing for «хор» only when the pack requires them at L2
  const keyTickets = examTickets.length ? examTickets.filter((ticket) => ticket.includes.some((id) => theoremTickets.find((theorem) => theorem.id === id)?.key)).map((ticket) => ticket.id) : theoremTickets.filter((ticket) => ticket.key).map((ticket) => ticket.id);
  const horMissing = missingFor(cells, horLevels, thresholds?.hor ?? {}, thresholds?.hor.keyL2 ? keyTickets : []);
  if (thresholds?.hor.keyL2) {
    for (const ticket of tickets.filter((item) => keyTickets.includes(item.id))) {
      if (!cells.find((item) => item.ticket === ticket.id && item.level === "L2")?.mastered && !horMissing.tickets.includes(ticket.id)) horMissing.tickets.push(ticket.id);
    }
  }
  const meets = (levels: readonly Level[], values: Partial<Record<Level, number>>) => levels.every((level) => {
    const threshold = values[level];
    const share = shares[level];
    return threshold === undefined || (share !== undefined && share >= threshold);
  });
  return {
    subject: subjectId, shares,
    toUd: meets(udLevels, thresholds?.ud ?? {}),
    toHor: meets(horLevels, thresholds?.hor ?? {}) && (!thresholds?.hor.keyL2 || keyTickets.every((id) => cells.find((item) => item.ticket === id && item.level === "L2")?.mastered)),
    missing: { ud: udMissing, hor: horMissing }, cells,
  };
}
