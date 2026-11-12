import { parse } from "yaml";

/** A parse error that knows its 1-based line in the file (when it is known). */
export class MdError extends Error {
  line: number | undefined;
  constructor(message: string, line?: number) {
    super(message);
    this.line = line;
  }
}

export interface RawQuestion { id: string; ticket: string; level: string; body: string; points: string[] }
export interface RawTest { meta: unknown; questions: RawQuestion[] }
export interface RawCard { id: string; question: string; answer: string; tickets?: string[] }
export interface RawCardsFile { meta: unknown; cards: RawCard[] }
export interface RawTheory { ticket: string; formulation: string; skeleton?: string[]; reliesOn?: string[] }
export interface RawTheoryFile { entries: RawTheory[] }

const TICKET_LINE = /^ticket:\s*(\S+)\s*·\s*level:\s*(\S+)\s*$/;

function parsePoints(id: string, lines: string[], at: number): string[] {
  const points: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) points.push(bullet[1]!.trim());
    else if (/^\s+\S/.test(line) && points.length) points[points.length - 1] += ` ${line.trim()}`;
    else throw new MdError(`вопрос ${id}: Эталон — маркированный список (строки "- ..."), а получено "${line.trim()}"`, at);
  }
  return points;
}

function parseQuestion(id: string, lines: string[], at: number): RawQuestion {
  let start = 0;
  while (start < lines.length && !lines[start]!.trim()) start++;
  const head = TICKET_LINE.exec(lines[start] ?? "");
  if (!head) throw new MdError(`вопрос ${id}: после заголовка нужна строка "ticket: <id тикета> · level: <L0|L1|L2>"`, at);
  const rest = lines.slice(start + 1);
  let inFence = false;
  let etalon = -1;
  for (let i = 0; i < rest.length; i++) {
    if (/^\s*(```|~~~)/.test(rest[i]!)) inFence = !inFence;
    else if (!inFence && /^###\s+Эталон\s*$/.test(rest[i]!)) { etalon = i; break; }
  }
  if (etalon < 0) throw new MdError(`вопрос ${id}: нет раздела "### Эталон"`, at);
  return { id, ticket: head[1]!, level: head[2]!, body: rest.slice(0, etalon).join("\n").trim(), points: parsePoints(id, rest.slice(etalon + 1), at) };
}

/** Split `---`-delimited YAML front-matter (parsed, unvalidated) from the body lines. */
function splitFrontMatter(text: string): { meta: unknown; body: string[]; bodyLine: number } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new MdError('файл должен начинаться со строки "---" (front-matter)', 1);
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) throw new MdError('front-matter не закрыт: нужна вторая строка "---"', 1);
  let meta: unknown;
  try { meta = parse(lines.slice(1, end).join("\n")); }
  catch (error) { throw new MdError(`front-matter — не YAML: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`, 2); }
  return { meta, body: lines.slice(end + 1), bodyLine: end + 2 };
}

export interface MdLayout {
  /** YAML between the `---` lines (empty when there is none) and the 1-based line number of its first line minus one. */
  front: string;
  frontOffset: number;
  /** `## <id>` headings outside code fences, with 1-based line numbers. */
  headings: { id: string; line: number }[];
}

/** Where things are in a markdown file, for error messages. Never throws. */
export function mdLayout(text: string): MdLayout {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let front = "";
  let from = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (end > 0) { front = lines.slice(1, end).join("\n"); from = end + 1; }
  }
  const headings: MdLayout["headings"] = [];
  let inFence = false;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    const heading = inFence ? null : /^##\s+(\S+)/.exec(line);
    if (heading) headings.push({ id: heading[1]!, line: i + 1 });
  }
  return { front, frontOffset: 1, headings };
}

/** Pure parser for tests/<subject>/<test>.md: front-matter plus `## <qid>` sections. Validation of values is left to the schemas. */
export function parseTestMd(text: string): RawTest {
  const { meta, body, bodyLine } = splitFrontMatter(text);
  const questions: RawQuestion[] = [];
  let current: { id: string; at: number; lines: string[] } | undefined;
  let inFence = false;
  const flush = () => { if (current) questions.push(parseQuestion(current.id, current.lines, current.at)); };
  for (const [index, line] of body.entries()) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^##\s+(\S+)\s*$/.exec(line);
    if (heading) { flush(); current = { id: heading[1]!, at: bodyLine + index, lines: [] }; }
    else if (current) current.lines.push(line);
    else if (line.trim()) throw new MdError(`текст до первого вопроса (вопрос начинается со строки "## <id>"): "${line.trim()}"`, bodyLine + index);
  }
  flush();
  return { meta, questions };
}

/** Parse cards/<subject>/<topic>.md with `## <id>` (optionally `## <id> · <ticket>, <ticket>`) and a standalone `---` separator. */
export function parseCardsMd(text: string): RawCardsFile {
  const { meta, body, bodyLine } = splitFrontMatter(text);
  const cards: RawCard[] = [];
  let current: { id: string; at: number; tickets?: string[]; lines: string[] } | undefined;
  let inFence = false;
  const flush = () => {
    if (!current) return;
    let fence = false;
    const separator = current.lines.findIndex((line) => {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return false; }
      return !fence && line.trim() === "---";
    });
    if (separator < 0) throw new MdError(`карточка ${current.id}: нет строки "---" между вопросом и ответом`, current.at);
    const question = current.lines.slice(0, separator).join("\n").trim();
    const answer = current.lines.slice(separator + 1).join("\n").trim();
    if (!question || !answer) throw new MdError(`карточка ${current.id}: вопрос и ответ не должны быть пустыми`, current.at);
    cards.push({ id: current.id, question, answer, ...(current.tickets ? { tickets: current.tickets } : {}) });
  };
  for (const [index, line] of body.entries()) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^##\s+(\S+)(?:\s*·\s*(.+?))?\s*$/.exec(line);
    if (heading) {
      flush();
      const own = heading[2]?.split(",").map((id) => id.trim()).filter(Boolean);
      current = { id: heading[1]!, at: bodyLine + index, ...(own?.length ? { tickets: own } : {}), lines: [] };
    }
    else if (current) current.lines.push(line);
    else if (line.trim()) throw new MdError(`текст до первой карточки (карточка начинается со строки "## <id>"): "${line.trim()}"`, bodyLine + index);
  }
  flush();
  return { meta, cards };
}

/** Parse theory/<subject>/<topic>.md with one `## <ticket>` entry per ticket. */
export function parseTheoryMd(text: string): RawTheoryFile {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const entries: RawTheory[] = [];
  let current: { ticket: string; at: number; lines: string[] } | undefined;
  let inFence = false;
  const flush = () => {
    if (!current) return;
    const ticket = current.ticket;
    const at = current.at;
    const sections = new Map<string, string[]>();
    let section: string | undefined;
    let sectionFence = false;
    for (const line of current.lines) {
      if (/^\s*(```|~~~)/.test(line)) sectionFence = !sectionFence;
      const heading = sectionFence ? null : /^###\s+(.+?)\s*$/.exec(line);
      if (heading) {
        section = heading[1]!;
        if (sections.has(section)) throw new MdError(`тикет ${ticket}: раздел "${section}" повторяется`, at);
        sections.set(section, []);
      } else if (section) sections.get(section)!.push(line);
      else if (line.trim()) throw new MdError(`тикет ${ticket}: текст до первого раздела "### ...": "${line.trim()}"`, at);
    }
    const formulation = sections.get("Формулировка")?.join("\n").trim();
    if (!formulation) throw new MdError(`тикет ${ticket}: нет раздела "### Формулировка"`, at);
    const skeletonText = sections.get("Скелет")?.join("\n");
    let skeleton: string[] | undefined;
    if (skeletonText !== undefined) {
      skeleton = skeletonText.split("\n").filter((line) => line.trim()).map((line) => {
        const item = /^\s*\d+[.)]\s+(.+)$/.exec(line);
        if (!item) throw new MdError(`тикет ${ticket}: Скелет — нумерованный список ("1. ..."), а получено "${line.trim()}"`, at);
        return item[1]!.trim();
      });
    }
    const reliesText = sections.get("Опирается на")?.join("\n").trim();
    const reliesOn = reliesText ? reliesText.split(",").map((id) => id.trim()) : undefined;
    entries.push({ ticket, formulation, ...(skeleton !== undefined ? { skeleton } : {}), ...(reliesOn ? { reliesOn } : {}) });
  };
  for (const [index, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^##\s+(\S+)\s*$/.exec(line);
    if (heading) { flush(); current = { ticket: heading[1]!, at: index + 1, lines: [] }; }
    else if (current) current.lines.push(line);
    else if (line.trim()) throw new MdError(`текст до первой записи (запись начинается со строки "## <id тикета>"): "${line.trim()}"`, index + 1);
  }
  flush();
  return { entries };
}
