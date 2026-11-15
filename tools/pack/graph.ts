// `graph/<subject>.yaml` → topics of the built pack, and the checks of the entry pool against them
// (docs/architecture/14-graph-plan.md). Called by build-pack.ts after the tickets and the tests are read.
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { GraphFileSchema, type BuiltTest, type BuiltTicket, type BuiltTopic } from "../../engine/src/content/schema.ts";
import { topoOrder } from "../../engine/src/core/graph.ts";
import { addIssues, loadYaml, type Problems } from "./problems.ts";

export interface GraphEnv {
  p: Problems;
  /** Warnings: the pack still builds. */
  w: Problems;
  root: string;
  /** Registers a pack-wide id; false (and a problem) when it is taken. */
  claim(file: string, id: string, line?: number): boolean;
  /** Where a claimed id (a question, a test) is declared. */
  locate(id: string): { file: string; line?: number | undefined } | undefined;
}

/** An entry-pool question has at most this many reference points (Р-84). */
const ENTRY_MAX_POINTS = 3;
/** «…и сформулируйте её отрицание»: the filler the entry pool must not contain (Р-84). */
const NEGATION_FILLER = /(сформулируйте|запишите|дайте|постройте|назовите)[^.?!]*отрицани/i;

const listed = (ids: readonly string[], max = 8): string => `${ids.slice(0, max).map((id) => `"${id}"`).join(", ")}${ids.length > max ? ` и ещё ${ids.length - max}` : ""}`;

export function buildGraph(env: GraphEnv, subjectIds: Set<string>, tickets: readonly BuiltTicket[], tests: readonly BuiltTest[]): BuiltTopic[] {
  const dir = join(env.root, "graph");
  const files = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".yaml")).sort() : [];
  const ticketSubject = new Map(tickets.map((ticket) => [ticket.id, ticket.subject]));
  const topics: BuiltTopic[] = [];
  const where = new Map<string, { file: string; line?: number | undefined; requires: (number | undefined)[] }>();
  const ticketTopic = new Map<string, string>();
  const withGraph: { subject: string; file: string }[] = [];

  for (const file of files) {
    const subject = basename(file, ".yaml");
    const path = join(dir, file);
    if (!subjectIds.has(subject)) { env.p.add(path, `предмет "${subject}" не описан в pack.yaml (имя файла или папки должно совпадать с id предмета)`); continue; }
    const src = loadYaml(env.p, path);
    if (!src) continue;
    const parsed = GraphFileSchema.safeParse(src.doc.toJS());
    if (!parsed.success) {
      addIssues(env.p, path, parsed.error.issues, src, (issuePath) => {
        const id = issuePath[0] === "topics" && issuePath.length >= 2 && issuePath[2] !== "id" ? src.value(["topics", issuePath[1]!, "id"]) : undefined;
        return typeof id === "string" ? `тема ${id}` : undefined;
      });
      continue;
    }
    withGraph.push({ subject, file: path });
    for (const [index, topic] of parsed.data.topics.entries()) {
      const line = src.line(["topics", index]);
      if (!env.claim(path, topic.id, src.line(["topics", index, "id"]))) continue;
      if (topic.title.includes("::")) env.p.add(path, `тема "${topic.id}": в названии нельзя «::» — так Anki разделяет вложенные колоды`, src.line(["topics", index, "title"]));
      for (const [ticketIndex, ticket] of topic.tickets.entries()) {
        const ticketLine = src.line(["topics", index, "tickets", ticketIndex]);
        const owner = ticketSubject.get(ticket);
        const taken = ticketTopic.get(ticket);
        if (owner === undefined) env.p.add(path, `тема "${topic.id}" содержит неизвестный тикет "${ticket}"`, ticketLine);
        else if (owner !== subject) env.p.add(path, `тема "${topic.id}" содержит тикет "${ticket}" другого предмета (${owner})`, ticketLine);
        else if (taken !== undefined) env.p.add(path, `тема "${topic.id}": тикет "${ticket}" уже входит в тему "${taken}" (один тикет — ровно в одной теме)`, ticketLine);
        else ticketTopic.set(ticket, topic.id);
      }
      topics.push({ id: topic.id, subject, title: topic.title, tickets: topic.tickets, requires: topic.requires, ...(topic.minutes !== undefined ? { minutes: topic.minutes } : {}) });
      where.set(topic.id, { file: path, line, requires: topic.requires.map((_, requireIndex) => src.line(["topics", index, "requires", requireIndex])) });
    }
    const missing = tickets.filter((ticket) => ticket.subject === subject && !ticketTopic.has(ticket.id)).map((ticket) => ticket.id);
    if (missing.length) env.p.add(path, `в граф не вошли тикеты предмета (${missing.length}): ${listed(missing)} — при графе каждый тикет предмета должен быть ровно в одной теме`);
  }

  // `requires` may point at a topic of any subject, so they are checked when every file is read
  const ids = new Set(topics.map((topic) => topic.id));
  let requiresOk = true;
  for (const topic of topics) {
    const loc = where.get(topic.id)!;
    const seen = new Set<string>();
    for (const [index, required] of topic.requires.entries()) {
      const line = loc.requires[index] ?? loc.line;
      let text: string | undefined;
      if (required === topic.id) text = `тема "${topic.id}" требует саму себя`;
      else if (!ids.has(required)) text = `тема "${topic.id}" требует неизвестную тему "${required}" (в requires — id тем из graph/, не тикетов)`;
      else if (seen.has(required)) text = `тема "${topic.id}": "${required}" повторяется в requires`;
      seen.add(required);
      if (text === undefined) continue;
      env.p.add(loc.file, text, line);
      requiresOk = false;
    }
  }
  if (!requiresOk) return topics;
  const { order, cycle } = topoOrder(topics);
  if (cycle.length) {
    const loc = where.get(cycle[0]!)!;
    env.p.add(loc.file, `цикл в графе тем: ${[...cycle, cycle[0]!].join(" → ")} (стрелка — «требует»); уберите одну из этих зависимостей`, loc.line);
    return topics;
  }
  for (const { subject, file } of withGraph) checkEntryPool(env, subject, file, order, ticketTopic, tests);
  return order;
}

/** Р-84: the rules of the entry pool of a subject with a graph. Only warnings: the pool is rewritten after the graph appears. */
function checkEntryPool(env: GraphEnv, subject: string, graphFile: string, topics: readonly BuiltTopic[], ticketTopic: Map<string, string>, tests: readonly BuiltTest[]): void {
  const entries = tests.filter((test) => test.kind === "entry" && test.subject === subject);
  if (!entries.length) {
    env.w.add(graphFile, `у предмета "${subject}" есть граф, но нет входного пула (tests/${subject}/${subject}-entry.md, kind: entry) — входной тест по нему не пройти`);
    return;
  }
  const questionById = new Map(tests.flatMap((test) => test.questions.map((question) => [question.id, question] as const)));
  const asked = new Set<string>();
  for (const test of entries) {
    for (const question of [...test.reuse.flatMap((id) => questionById.get(id) ?? []), ...test.questions]) {
      const label = `входной пул "${test.id}": вопрос "${question.id}"`;
      const loc = env.locate(question.id) ?? env.locate(test.id);
      const warn = (text: string): void => env.w.add(loc?.file ?? graphFile, text, loc?.line);
      if (question.level === "L2") { warn(`${label} уровня L2 — во входном тесте он не задаётся (нужны L0 и L1)`); continue; }
      const topic = ticketTopic.get(question.ticket);
      if (topic !== undefined) asked.add(topic);
      if (question.points.length > ENTRY_MAX_POINTS) warn(`${label}: в эталоне ${question.points.length} пунктов, во входном пуле — 2–${ENTRY_MAX_POINTS} (ответ за минуту)`);
      if (NEGATION_FILLER.test(question.body)) warn(`${label} просит ещё и отрицание — во входном пуле один вопрос проверяет одно`);
    }
  }
  const bare = topics.filter((topic) => topic.subject === subject && !asked.has(topic.id)).map((topic) => topic.id);
  if (bare.length) env.w.add(graphFile, `во входном пуле нет вопросов (L0/L1) по темам (${bare.length}): ${listed(bare)} — такие темы входной тест определяет только по соседним`);
}
