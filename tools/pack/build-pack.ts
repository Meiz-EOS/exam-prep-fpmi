import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { z } from "zod";
import type { Plugin } from "vite";
import { CardMetaSchema, CardSchema, ExamTicketsFileSchema, ItemsFileSchema, PackSchema, QuestionSchema, RemapFileSchema, TestMetaSchema, TicketsFileSchema, TheoryEntrySchema, type BuiltExamTicket, type BuiltPack, type BuiltTest, type BuiltTicket, type Item, type Question } from "../../engine/src/content/schema.ts";
import { loadPack } from "../../engine/src/content/load.ts";
import { MdError, mdLayout, parseCardsMd, parseTestMd, parseTheoryMd, type MdLayout } from "./parse-md.ts";
import { l2TopicParents } from "../../engine/src/content/coverage.ts";
import { PackError, Problems, YamlSource, addIssues, loadYaml, valueAt, type PackProblem, type Path } from "./problems.ts";

const virtualId = "virtual:pack";
const resolvedVirtualId = `\0${virtualId}`;
const EMPTY_PACK: BuiltPack = { id: "empty", title: "", subjects: [], exams: [], items: [] };

// One check for the whole pack (`collectPack`): every problem goes to a list instead of stopping at the first one.
// `buildPack` (the build, the tests) throws them all at once; `npm run check:pack` prints them (check-pack.ts).

interface Loc { file: string; line?: number | undefined }

interface Ctx {
  p: Problems;
  root: string;
  /** Every id of the pack (exams, items, tickets, exam tickets, tests, questions, cards) and where it is declared first. */
  ids: Map<string, Loc>;
}

const place = (c: Ctx, loc: Loc | undefined): string => (loc ? `${relative(c.root, loc.file) || loc.file}${loc.line !== undefined ? `:${loc.line}` : ""}` : "?");

function fail(c: Ctx, loc: Loc | undefined, text: string): void {
  c.p.add(loc?.file ?? c.root, text, loc?.line);
}

function claim(c: Ctx, file: string, id: string, line?: number): boolean {
  const first = c.ids.get(id);
  if (first) {
    c.p.add(file, `id "${id}" повторяется — он уже занят (${place(c, first)}); id должны быть уникальны во всём пакете`, line);
    return false;
  }
  c.ids.set(id, { file, line });
  return true;
}

/**
 * A YAML file parsed and checked against `schema`; the problems are reported.
 * `undefined` when the YAML itself is broken; `data` is missing when the schema failed (the source is still there to salvage ids from).
 */
function readSchema<S extends z.ZodType>(c: Ctx, file: string, schema: S, context?: (path: Path, source: YamlSource) => string | undefined): { data?: z.output<S>; src: YamlSource } | undefined {
  const src = loadYaml(c.p, file);
  if (!src) return undefined;
  const result = schema.safeParse(src.doc.toJS());
  if (result.success) return { data: result.data, src };
  addIssues(c.p, file, result.error.issues, src, context ? (path) => context(path, src) : undefined);
  return { src };
}

/** The raw entries (objects with a string `id`) of the list at `path` in a file that failed its schema, with their line. */
function rawEntries(src: YamlSource, path: Path): { raw: Record<string, unknown>; id: string; index: number }[] {
  const list = src.value(path);
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw, index) => (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? [{ raw: raw as Record<string, unknown>, id: (raw as { id: string }).id, index }] : []));
}

/** `what id` for an issue inside the entry whose path is the first `entryLength` segments (not for the `id` field itself). */
function entryHint(src: YamlSource, path: Path, entryLength: number, what: string): string | undefined {
  if (path.length <= entryLength || path[entryLength] === "id") return undefined;
  const id = src.value([...path.slice(0, entryLength), "id"]);
  return typeof id === "string" ? `${what} ${id}` : undefined;
}

function yamlFiles(dir: string, suffix: string, skip?: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(suffix) && !(skip && file.endsWith(skip))).sort() : [];
}

const unknownSubject = (subject: string): string => `предмет "${subject}" не описан в pack.yaml (имя файла или папки должно совпадать с id предмета)`;

/** Markdown files of `<root>/<section>/<subject>/*.md`, subject folders in name order; an unknown subject is reported and skipped. */
function* subjectMdFiles(c: Ctx, section: string, subjectIds: Set<string>): Generator<{ subject: string; path: string }> {
  const dir = join(c.root, section);
  const subjects = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : [];
  for (const subject of subjects) {
    if (!subjectIds.has(subject)) { c.p.add(join(dir, subject), unknownSubject(subject)); continue; }
    for (const file of yamlFiles(join(dir, subject), ".md")) yield { subject, path: join(dir, subject, file) };
  }
}

function mdFailure(c: Ctx, path: string, error: unknown): void {
  if (error instanceof MdError) c.p.add(path, error.message, error.line);
  else c.p.add(path, error instanceof Error ? error.message : String(error));
}

/** Line of the last `## <id>` heading with this id (the later one wins when it is repeated). */
function headingLine(layout: MdLayout, id: string): number | undefined {
  return layout.headings.findLast((heading) => heading.id === id)?.line;
}

function buildItems(c: Ctx, subjectIds: Set<string>): Item[] {
  const items: Item[] = [];
  const dir = join(c.root, "items");
  for (const file of yamlFiles(dir, ".yaml")) {
    const subject = basename(file, ".yaml");
    const path = join(dir, file);
    if (!subjectIds.has(subject)) { c.p.add(path, unknownSubject(subject)); continue; }
    const read = readSchema(c, path, ItemsFileSchema, (issuePath, src) => issuePath[1] === "items" ? entryHint(src, issuePath, 3, "задача") : undefined);
    if (!read) continue;
    if (!read.data) {
      // the file has a mistake: still take its ids, so that duplicates are found and nothing else is blamed on them
      const groups = read.src.value([]);
      for (const groupIndex of Array.isArray(groups) ? groups.keys() : []) {
        for (const entry of rawEntries(read.src, [groupIndex, "items"])) claim(c, path, entry.id, read.src.line([groupIndex, "items", entry.index, "id"]));
      }
      continue;
    }
    for (const [groupIndex, group] of read.data.entries()) {
      for (const [itemIndex, entry] of group.items.entries()) {
        const entryPath: Path = [groupIndex, "items", itemIndex];
        claim(c, path, entry.id, read.src.line([...entryPath, "id"]));
        const line = read.src.line(entryPath);
        const kind = entry.kind ?? group.kind;
        if (!kind) { c.p.add(path, `у "${entry.id}" не указан kind — задайте его у задачи или у её группы`, line); continue; }
        if (entry.soft && entry.hard && entry.soft > entry.hard) { c.p.add(path, `у "${entry.id}" мягкий срок soft (${entry.soft}) позже жёсткого hard (${entry.hard})`, read.src.line([...entryPath, "soft"])); continue; }
        items.push({ id: entry.id, subject, group: group.group, kind, title: entry.title,
          ...(entry.soft !== undefined ? { soft: entry.soft } : {}),
          ...(entry.hard !== undefined ? { hard: entry.hard } : {}),
          ...(entry.note !== undefined ? { note: entry.note } : {}),
          ...(entry.star !== undefined ? { star: entry.star } : {}),
        });
      }
    }
  }
  return items;
}

function buildTickets(c: Ctx, subjectIds: Set<string>): { tickets: BuiltTicket[]; remap: Record<string, string> } {
  const tickets: BuiltTicket[] = [];
  const remap: Record<string, string> = {};
  const dir = join(c.root, "tickets");
  for (const file of yamlFiles(dir, ".yaml", ".remap.yaml")) {
    const subject = basename(file, ".yaml");
    const path = join(dir, file);
    if (!subjectIds.has(subject)) { c.p.add(path, unknownSubject(subject)); continue; }
    const read = readSchema(c, path, TicketsFileSchema, (issuePath, src) => issuePath[0] === "tickets" ? entryHint(src, issuePath, 2, "тикет") : undefined);
    if (!read) continue;
    if (!read.data) {
      // keep the ids of a broken file, so that the references to them are not reported as unknown
      for (const entry of rawEntries(read.src, ["tickets"])) {
        claim(c, path, entry.id, read.src.line(["tickets", entry.index, "id"]));
        tickets.push({ id: entry.id, subject, title: "" });
      }
      continue;
    }
    for (const [index, ticket] of read.data.tickets.entries()) {
      claim(c, path, ticket.id, read.src.line(["tickets", index, "id"]));
      tickets.push({ ...ticket, subject, ...(read.data.provisional !== undefined ? { provisional: read.data.provisional } : {}) });
    }
  }
  for (const file of yamlFiles(dir, ".remap.yaml")) {
    const subject = basename(file, ".remap.yaml");
    const path = join(dir, file);
    if (!subjectIds.has(subject)) { c.p.add(path, unknownSubject(subject)); continue; }
    const read = readSchema(c, path, RemapFileSchema);
    if (!read?.data) continue;
    for (const [from, to] of Object.entries(read.data)) {
      const line = read.src.line([from]);
      if (tickets.some((ticket) => ticket.id === from)) { c.p.add(path, `старый id "${from}" — это текущий id тикета; в remap нужны только id, которых в пакете больше нет`, line); continue; }
      if (!tickets.some((ticket) => ticket.id === to && ticket.subject === subject)) { c.p.add(path, `старый id "${from}" ведёт на неизвестный тикет "${to}" (предмет ${subject})`, line); continue; }
      if (remap[from] !== undefined) { c.p.add(path, `старый id "${from}" повторяется в remap`, line); continue; }
      remap[from] = to;
    }
  }
  return { tickets, remap };
}

function buildExam(c: Ctx, subjectIds: Set<string>, tickets: BuiltTicket[]): BuiltExamTicket[] {
  const out: BuiltExamTicket[] = [];
  const usedTheorems = new Set<string>();
  const dir = join(c.root, "exam");
  for (const file of yamlFiles(dir, ".yaml")) {
    const subject = basename(file, ".yaml");
    const path = join(dir, file);
    if (!subjectIds.has(subject)) { c.p.add(path, unknownSubject(subject)); continue; }
    const read = readSchema(c, path, ExamTicketsFileSchema, (issuePath, src) => issuePath[0] === "tickets" ? entryHint(src, issuePath, 2, "билет") : undefined);
    if (!read) continue;
    if (!read.data) {
      for (const entry of rawEntries(read.src, ["tickets"])) {
        claim(c, path, entry.id, read.src.line(["tickets", entry.index, "id"]));
        const includes = Array.isArray(entry.raw.includes) ? entry.raw.includes.filter((item): item is string => typeof item === "string") : [];
        out.push({ id: entry.id, subject, title: "", confidence: "doubtful", includes });
      }
      continue;
    }
    for (const [index, item] of read.data.tickets.entries()) {
      claim(c, path, item.id, read.src.line(["tickets", index, "id"]));
      for (const [includeIndex, theorem] of item.includes.entries()) {
        const line = read.src.line(["tickets", index, "includes", includeIndex]);
        const owner = tickets.find((ticket) => ticket.id === theorem);
        if (!owner) { c.p.add(path, `билет "${item.id}" включает неизвестный тикет "${theorem}"`, line); continue; }
        if (owner.subject !== subject) { c.p.add(path, `билет "${item.id}" включает тикет "${theorem}" другого предмета (${owner.subject})`, line); continue; }
        if (usedTheorems.has(theorem)) { c.p.add(path, `билет "${item.id}": тикет "${theorem}" уже входит в другой экзаменационный билет`, line); continue; }
        usedTheorems.add(theorem);
      }
      out.push({ ...item, subject });
    }
  }
  return out;
}

const questionHint = (path: Path, question: { id?: unknown }): string | undefined => (path[0] !== "id" && typeof question.id === "string" ? `вопрос ${question.id}` : undefined);

function buildTests(c: Ctx, subjectIds: Set<string>, ticketSubject: Map<string, string>, exam: readonly BuiltExamTicket[], tickets: readonly BuiltTicket[]): BuiltTest[] {
  const tests: BuiltTest[] = [];
  for (const { subject, path } of subjectMdFiles(c, "tests", subjectIds)) {
    const text = readFileSync(path, "utf8");
    let raw;
    try { raw = parseTestMd(text); } catch (error) { mdFailure(c, path, error); continue; }
    const layout = mdLayout(text);
    const front = new YamlSource(layout.front, layout.frontOffset);
    const metaResult = TestMetaSchema.safeParse(raw.meta);
    if (!metaResult.success) {
      const metaId = (raw.meta as { id?: unknown } | null)?.id;
      addIssues(c.p, path, metaResult.error.issues, { line: (issuePath, key) => front.line(issuePath, key) ?? 1, value: (issuePath) => valueAt(raw.meta, issuePath) },
        (issuePath) => issuePath[0] !== "id" && typeof metaId === "string" ? `тест ${metaId}` : undefined);
      continue;
    }
    const meta = metaResult.data;
    claim(c, path, meta.id, front.line(["id"]));
    const questions: Question[] = [];
    for (const question of raw.questions) {
      const result = QuestionSchema.safeParse(question);
      if (!result.success) {
        addIssues(c.p, path, result.error.issues, { line: () => headingLine(layout, question.id), value: (issuePath) => valueAt(question, issuePath) }, (issuePath) => questionHint(issuePath, question));
        continue;
      }
      questions.push(result.data);
    }
    for (const question of questions) {
      const line = headingLine(layout, question.id);
      claim(c, path, question.id, line);
      const owner = ticketSubject.get(question.ticket);
      if (owner === undefined) c.p.add(path, `вопрос "${question.id}" ссылается на неизвестный тикет "${question.ticket}"`, line);
      else if (owner !== subject) c.p.add(path, `вопрос "${question.id}" ссылается на тикет "${question.ticket}" другого предмета (${owner})`, line);
    }
    tests.push({ ...meta, subject, questions });
  }
  // reuse may only pull questions of the same subject
  const questionSubject = new Map(tests.flatMap((test) => test.questions.map((question) => [question.id, test.subject] as const)));
  for (const test of tests) {
    for (const ref of test.reuse) {
      const owner = questionSubject.get(ref);
      if (owner === undefined) fail(c, c.ids.get(test.id), `тест "${test.id}": reuse ссылается на неизвестный вопрос "${ref}"`);
      else if (owner !== test.subject) fail(c, c.ids.get(test.id), `тест "${test.id}": reuse ссылается на вопрос "${ref}" другого предмета (${owner})`);
    }
  }
  // the cross-checks below need every reuse to resolve
  const reuseOk = tests.every((test) => test.reuse.every((ref) => questionSubject.get(ref) === test.subject));
  checkTicketTests(c, tests, exam, tickets, reuseOk);
  checkTopicTests(c, tests, ticketSubject, tickets, reuseOk);
  return tests;
}

/** Р-51: an L2 topic test covers at most this many tickets; larger topics are split into parts. */
const L2_TOPIC_MAX_COVERS = 5;

type BuiltQuestion = BuiltTest["questions"][number];

/** A test's questions: reused ones (resolved by id), then its own; reused ones that do not resolve are left out (the reuse check reports them). */
function testQuestions(test: BuiltTest, questionById: Map<string, BuiltQuestion>): BuiltQuestion[] {
  return [...test.reuse.flatMap((id) => questionById.get(id) ?? []), ...test.questions];
}

/** Every question of `test` asks about a ticket in `allowed` (named `scope` in errors); an L2 test asks only L2 questions. */
function checkQuestions(c: Ctx, test: BuiltTest, questionById: Map<string, BuiltQuestion>, allowed: Set<string>, scope: string): void {
  for (const question of testQuestions(test, questionById)) {
    const loc = test.questions.includes(question) ? c.ids.get(question.id) : c.ids.get(test.id);
    if (!allowed.has(question.ticket)) fail(c, loc, `тест "${test.id}": вопрос "${question.id}" спрашивает про тикет "${question.ticket}", которого нет в ${scope}`);
    if (test.level === "L2" && question.level !== "L2") fail(c, loc, `тест "${test.id}": в L2-тесте вопрос "${question.id}" должен быть уровня L2 (level: L2)`);
  }
}

/**
 * Validates topic test covers and keeps each ticket in at most one topic test per level (Р-38, Р-51).
 * An L2 topic test asks only L2 questions, covers only L2-capable tickets and lies inside exactly one ordinary topic test.
 */
function checkTopicTests(c: Ctx, tests: readonly BuiltTest[], ticketSubject: Map<string, string>, tickets: readonly BuiltTicket[], reuseOk: boolean): void {
  const questionById = new Map(tests.flatMap((test) => test.questions.map((question) => [question.id, question] as const)));
  const maxLevel = new Map(tickets.map((ticket) => [ticket.id, ticket.maxLevel ?? "L2"]));
  const covered = { ordinary: new Map<string, string>(), L2: new Map<string, string>() };
  const topics = tests.filter((test) => test.kind === "topic");
  for (const test of topics) {
    const loc = c.ids.get(test.id);
    const label = `тест "${test.id}"`;
    const isL2 = test.level === "L2";
    const owners = isL2 ? covered.L2 : covered.ordinary;
    const covers = new Set(test.covers ?? []);
    for (const ticket of covers) {
      const owner = ticketSubject.get(ticket);
      if (owner === undefined) { fail(c, loc, `${label}: covers содержит неизвестный тикет "${ticket}"`); continue; }
      if (owner !== test.subject) { fail(c, loc, `${label}: covers содержит тикет "${ticket}" другого предмета (${owner})`); continue; }
      const other = owners.get(ticket);
      if (other !== undefined) { fail(c, loc, `${label}: тикет "${ticket}" уже входит в ${isL2 ? "L2-" : ""}тему "${other}" (один тикет — в одну тему на уровень)`); continue; }
      owners.set(ticket, test.id);
      if (isL2 && maxLevel.get(ticket) !== "L2") fail(c, loc, `${label}: у тикета "${ticket}" maxLevel ${maxLevel.get(ticket)}, его нельзя включать в L2-тему`);
    }
    if (isL2 && covers.size > L2_TOPIC_MAX_COVERS) fail(c, loc, `${label}: L2-тема покрывает ${covers.size} тикетов, допустимо не больше ${L2_TOPIC_MAX_COVERS} (разбейте на части)`);
    if (reuseOk) checkQuestions(c, test, questionById, covers, "covers");
  }
  for (const test of topics) {
    if (test.level !== "L2") continue;
    const parents = l2TopicParents(test, topics);
    if (parents.length !== 1) fail(c, c.ids.get(test.id), `тест "${test.id}": covers L2-темы должен целиком лежать ровно в одной обычной теме (без level), найдено таких тем: ${parents.length}`);
  }
}

/** Р-23: a `kind: ticket` test belongs to one exam ticket of its subject and asks only about that ticket's theorems. */
function checkTicketTests(c: Ctx, tests: readonly BuiltTest[], exam: readonly BuiltExamTicket[], tickets: readonly BuiltTicket[], reuseOk: boolean): void {
  const examById = new Map(exam.map((ticket) => [ticket.id, ticket]));
  const questionById = new Map(tests.flatMap((test) => test.questions.map((question) => [question.id, question] as const)));
  const testByExam = new Map<string, string>();
  const l2ByExam = new Map<string, BuiltTest[]>();
  for (const test of tests) {
    if (test.exam === undefined) continue;
    const loc = c.ids.get(test.id);
    const label = `тест "${test.id}"`;
    const target = examById.get(test.exam);
    if (!target) { fail(c, loc, `${label} ссылается на неизвестный экзаменационный билет "${test.exam}"`); continue; }
    if (target.subject !== test.subject) { fail(c, loc, `${label} ссылается на экзаменационный билет "${test.exam}" другого предмета (${target.subject})`); continue; }
    if (test.level === "L2") {
      const parts = l2ByExam.get(test.exam) ?? [];
      parts.push(test);
      l2ByExam.set(test.exam, parts);
    } else {
      const other = testByExam.get(test.exam);
      if (other !== undefined) fail(c, loc, `${label}: у экзаменационного билета "${test.exam}" уже есть тест "${other}"`);
      else testByExam.set(test.exam, test.id);
    }
    if (reuseOk) checkQuestions(c, test, questionById, new Set(target.includes), `билете "${test.exam}"`);
  }
  if (!reuseOk) return;
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  for (const [examId, parts] of l2ByExam) {
    const target = examById.get(examId)!;
    const assigned = new Map<string, string>();
    const covered = new Set<string>();
    for (const part of parts) {
      for (const question of testQuestions(part, questionById)) {
        if (assigned.has(question.ticket)) fail(c, c.ids.get(part.id), `тест "${part.id}": тикет "${question.ticket}" повторяется в частях L2`);
        assigned.set(question.ticket, part.id);
        covered.add(question.ticket);
      }
    }
    for (const item of target.includes) if ((ticketById.get(item)?.maxLevel ?? "L2") === "L2" && !covered.has(item)) {
      fail(c, c.ids.get(parts[0]!.id), `L2-тесты билета "${examId}" не содержат вопроса про тикет "${item}"`);
    }
  }
}

function buildCards(c: Ctx, subjectIds: Set<string>, tickets: BuiltTicket[]): NonNullable<BuiltPack["cards"]> {
  const cards: NonNullable<BuiltPack["cards"]> = [];
  for (const { subject, path } of subjectMdFiles(c, "cards", subjectIds)) {
    const text = readFileSync(path, "utf8");
    let raw;
    try { raw = parseCardsMd(text); } catch (error) { mdFailure(c, path, error); continue; }
    const layout = mdLayout(text);
    const front = new YamlSource(layout.front, layout.frontOffset);
    const metaResult = CardMetaSchema.safeParse(raw.meta);
    if (!metaResult.success) {
      addIssues(c.p, path, metaResult.error.issues, { line: (issuePath, key) => front.line(issuePath, key) ?? 1, value: (issuePath) => valueAt(raw.meta, issuePath) });
      continue;
    }
    const meta = metaResult.data;
    for (const card of raw.cards) {
      const line = headingLine(layout, card.id);
      claim(c, path, card.id, line);
      // a card's own tickets (`## <id> · <ticket>`) override the file default
      const cardTickets = card.tickets ?? meta.tickets;
      let refsOk = true;
      for (const ticketId of cardTickets) {
        const ticket = tickets.find((entry) => entry.id === ticketId);
        if (!ticket) { c.p.add(path, `карточка "${card.id}" ссылается на неизвестный тикет "${ticketId}"`, line); refsOk = false; }
        else if (ticket.subject !== subject) { c.p.add(path, `карточка "${card.id}" ссылается на тикет "${ticketId}" другого предмета (${ticket.subject})`, line); refsOk = false; }
      }
      if (!refsOk) continue;
      const source = cardTickets.map((id) => tickets.find((ticket) => ticket.id === id)?.src).filter((src): src is string => !!src).join(", ");
      const result = CardSchema.safeParse({ ...card, deck: meta.deck, subject, tickets: cardTickets, source });
      if (!result.success) addIssues(c.p, path, result.error.issues, { line: () => line, value: (issuePath) => valueAt(card, issuePath) }, () => `карточка ${card.id}`);
      else cards.push(result.data);
    }
  }
  return cards;
}

function buildTheory(c: Ctx, subjectIds: Set<string>, tickets: BuiltTicket[]): NonNullable<BuiltPack["theory"]> {
  const theory: NonNullable<BuiltPack["theory"]> = [];
  for (const { subject, path } of subjectMdFiles(c, "theory", subjectIds)) {
    const text = readFileSync(path, "utf8");
    let raw;
    try { raw = parseTheoryMd(text); } catch (error) { mdFailure(c, path, error); continue; }
    const layout = mdLayout(text);
    for (const entry of raw.entries) {
      const line = headingLine(layout, entry.ticket);
      const result = TheoryEntrySchema.safeParse({ ...entry, subject });
      if (!result.success) { addIssues(c.p, path, result.error.issues, { line: () => line, value: (issuePath) => valueAt(entry, issuePath) }, () => `тикет ${entry.ticket}`); continue; }
      const parsed = result.data;
      if (theory.some((item) => item.ticket === parsed.ticket)) { c.p.add(path, `теория для тикета "${parsed.ticket}" уже есть — запись повторяется`, line); continue; }
      const owner = tickets.find((ticket) => ticket.id === parsed.ticket);
      if (!owner) { c.p.add(path, `запись теории про неизвестный тикет "${parsed.ticket}" (его нет в tickets/)`, line); continue; }
      if (owner.subject !== subject) { c.p.add(path, `запись теории "${parsed.ticket}": тикет относится к другому предмету (${owner.subject})`, line); continue; }
      for (const ref of parsed.reliesOn ?? []) {
        const refTicket = tickets.find((ticket) => ticket.id === ref);
        if (!refTicket) c.p.add(path, `запись теории "${parsed.ticket}": «Опирается на» — неизвестный тикет "${ref}"`, line);
        else if (refTicket.subject !== subject) c.p.add(path, `запись теории "${parsed.ticket}": «Опирается на» — тикет "${ref}" другого предмета (${refTicket.subject})`, line);
      }
      theory.push(parsed);
    }
  }
  return theory;
}

function collect(c: Ctx): BuiltPack | undefined {
  const root = c.root;
  const packPath = join(root, "pack.yaml");
  if (!existsSync(packPath)) { c.p.add(root, "нет файла pack.yaml — это не папка пакета"); return undefined; }
  const read = readSchema(c, packPath, PackSchema);
  if (!read?.data) return undefined; // subjects are unknown without it
  const pack = read.data;
  const subjectIds = new Set(pack.subjects.map((subject) => subject.id));
  for (const [index, exam] of pack.exams.entries()) {
    if (!subjectIds.has(exam.subject)) c.p.add(packPath, `экзамен "${exam.id}" ссылается на неизвестный предмет "${exam.subject}"`, read.src.line(["exams", index, "subject"]));
    claim(c, packPath, exam.id, read.src.line(["exams", index, "id"]));
  }

  const items = buildItems(c, subjectIds);
  const hasTickets = existsSync(join(root, "tickets"));
  const hasTests = existsSync(join(root, "tests"));
  const builtTickets = hasTickets ? buildTickets(c, subjectIds) : { tickets: [], remap: {} };
  const tickets = builtTickets.tickets;
  const exam = existsSync(join(root, "exam")) ? buildExam(c, subjectIds, tickets) : [];
  for (const ticket of tickets) {
    if (ticket.key && ticket.maxLevel !== undefined && ticket.maxLevel !== "L2") fail(c, c.ids.get(ticket.id), `тикет "${ticket.id}" помечен key: true, но maxLevel: ${ticket.maxLevel} — ключевой тикет должен доходить до L2`);
  }
  const tests = hasTests ? buildTests(c, subjectIds, new Map(tickets.map((ticket) => [ticket.id, ticket.subject])), exam, tickets) : [];
  const hasCards = existsSync(join(root, "cards"));
  const cards = hasCards ? buildCards(c, subjectIds, tickets) : [];
  const hasTheory = existsSync(join(root, "theory"));
  const theory = hasTheory ? buildTheory(c, subjectIds, tickets) : [];
  if (c.p.list.length) return undefined;
  try {
    return loadPack({ ...pack, items, ...(hasTickets ? { tickets, ...(Object.keys(builtTickets.remap).length ? { remap: builtTickets.remap } : {}) } : {}), ...(exam.length || existsSync(join(root, "exam")) ? { exam } : {}), ...(hasTests ? { tests } : {}), ...(hasCards ? { cards } : {}), ...(hasTheory ? { theory } : {}) });
  } catch (error) {
    c.p.add(root, `собранный пакет не прошёл проверку: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** Checks the whole pack folder: every problem found, and the built pack when there are none. */
export function collectPack(dir: string): { pack?: BuiltPack; problems: PackProblem[] } {
  const root = resolve(dir);
  const c: Ctx = { p: new Problems(), root, ids: new Map() };
  try {
    const pack = collect(c);
    if (!c.p.list.length && pack) return { pack, problems: [] };
  } catch (error) {
    c.p.add(root, `внутренняя ошибка проверки: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { problems: c.p.list };
}

/** The built pack; throws a `PackError` with every problem (`file:line: text`, one per line) when the folder is not a valid pack. */
export function buildPack(dir: string): BuiltPack {
  const { pack, problems } = collectPack(dir);
  if (problems.length || !pack) throw new PackError(problems);
  return pack;
}

export function packPlugin(dir: string): Plugin {
  let code: string;
  return {
    name: "zachetka-pack",
    enforce: "pre",
    buildStart() {
      const root = resolve(dir);
      // Cards are reviewed in Anki (tools/anki), the page never shows them: keep them out of the HTML.
      const built = existsSync(join(root, "pack.yaml")) ? buildPack(root) : EMPTY_PACK;
      const { cards: _cards, ...page } = built as BuiltPack;
      code = JSON.stringify(page);
    },
    resolveId(id) { return id === virtualId ? resolvedVirtualId : undefined; },
    load(id) { return id === resolvedVirtualId ? `export default ${code};` : undefined; },
  };
}
