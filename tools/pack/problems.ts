// Pack problems: one list for the whole check, one human text per schema issue (docs/architecture/13-classmates.md#format).
// Everything that validates a pack (build-pack.ts) reports here instead of throwing at the first error.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { LineCounter, isMap, isPair, isScalar, isSeq, parseDocument, type Document } from "yaml";
import type { ZodIssue } from "zod";

export interface PackProblem {
  file: string;
  /** 1-based; absent when the place cannot be derived. */
  line?: number;
  text: string;
}

/** `file:line: text` (or `file: text`); `file` is shown relative to `base` when given. */
export function formatProblem(problem: PackProblem, base?: string): string {
  const file = base === undefined ? problem.file : relative(base, problem.file) || ".";
  return `${file}${problem.line !== undefined ? `:${problem.line}` : ""}: ${problem.text}`;
}

export class Problems {
  list: PackProblem[] = [];
  add(file: string, text: string, line?: number): void {
    this.list.push({ file, text, ...(line !== undefined ? { line } : {}) });
  }
}

/** Thrown by `buildPack`: every problem of the pack, one per line; the list is in `problems`. */
export class PackError extends Error {
  problems: PackProblem[];
  constructor(problems: PackProblem[]) {
    super(problems.map((problem) => formatProblem(problem)).join("\n"));
    this.problems = problems;
  }
}

export type Path = (string | number)[];

/** Where an issue's path is in a source (line) and what the raw value there is. */
export interface Locator {
  line(path: Path, key?: string): number | undefined;
  value(path: Path): unknown;
}

export function valueAt(root: unknown, path: Path): unknown {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

/** A YAML text with lines: `offset` is the number of lines before the text in the real file (markdown front-matter). */
export class YamlSource implements Locator {
  doc: Document.Parsed;
  lc: LineCounter;
  offset: number;

  constructor(text: string, offset = 0) {
    this.lc = new LineCounter();
    this.doc = parseDocument(text, { lineCounter: this.lc });
    this.offset = offset;
  }

  /** Syntax errors of the YAML itself, with lines. */
  errors(): { text: string; line: number | undefined }[] {
    return this.doc.errors.map((error) => ({
      text: `ошибка YAML: ${error.message.split(/ at line \d+/)[0]!.trim()}`,
      line: error.linePos?.[0] ? error.linePos[0].line + this.offset : undefined,
    }));
  }

  value(path: Path): unknown { return valueAt(this.doc.toJS(), path); }

  private lineOfOffset(offset: number | undefined): number | undefined {
    return offset === undefined ? undefined : this.lc.linePos(offset).line + this.offset;
  }

  /** Line of the deepest node that exists along `path` (a missing key points at its parent). With `key`: the line of that key inside the map at `path`. */
  line(path: Path, key?: string): number | undefined {
    let node: unknown = this.doc.contents;
    let best: unknown = node;
    for (const segment of path) {
      let next: unknown;
      if (isMap(node)) {
        const pair = node.items.find((item) => isScalar(item.key) && String(item.key.value) === String(segment));
        next = pair ? (pair.value ?? pair.key) : undefined;
      } else if (isSeq(node) && typeof segment === "number") next = node.items[segment];
      if (next === undefined || next === null) break;
      node = next;
      best = next;
    }
    if (key !== undefined && isMap(best)) {
      const pair = best.items.find((item) => isPair(item) && isScalar(item.key) && String(item.key.value) === key);
      const range = isScalar(pair?.key) ? pair.key.range : undefined;
      if (range) return this.lineOfOffset(range[0]);
    }
    const range = (best as { range?: [number, number, number] | null } | null)?.range;
    return this.lineOfOffset(range?.[0]);
  }
}

/** Reads and parses a YAML file; syntax errors are reported to `problems`. */
export function loadYaml(problems: Problems, file: string): YamlSource | undefined {
  let text: string;
  try { text = readFileSync(file, "utf8"); }
  catch { problems.add(file, "файл не читается"); return undefined; }
  const source = new YamlSource(text);
  const errors = source.errors();
  for (const error of errors) problems.add(file, error.text, error.line);
  return errors.length ? undefined : source;
}

const ID_PATTERN = "^[a-z0-9][a-z0-9.-]*$";
const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

function typeName(expected: string): string {
  return ({ string: "строка", number: "число", boolean: "да/нет (true или false)", array: "список", object: "вложенная запись", int: "целое число" } as Record<string, string>)[expected] ?? expected;
}

/** A value as the author wrote it, for "получено ...". */
function shown(value: unknown): string {
  if (value === undefined || value === null) return "пусто";
  if (typeof value === "string") return `"${value}"`;
  if (Array.isArray(value)) return `список из ${value.length}`;
  if (typeof value === "object") return "вложенная запись";
  return String(value);
}

/** Russian wording for the `custom` issues raised in engine/src/content/schema.ts, keyed by their English message. */
function customText(message: string, field: string): string | undefined {
  if (message === "Invalid calendar date") return `поле "${field}" — такой даты нет в календаре`;
  let match = /^kind (\w+) requires (\w+)$/.exec(message);
  if (match) return `для kind: ${match[1]} нужно поле "${match[2]}"`;
  match = /^(\w+) is only allowed with kind (\w+), not (\w+)$/.exec(message);
  if (match) return `поле "${match[1]}" допустимо только при kind: ${match[2]}, а здесь kind: ${match[3]}`;
  if (message === "level is only allowed with kind ticket or topic") return 'поле "level" допустимо только при kind: ticket или topic';
  return undefined;
}

/** One Russian line for a zod issue. `value` is the raw value at the issue path. */
export function issueText(issue: ZodIssue, value: unknown): string {
  const last = issue.path[issue.path.length - 1];
  const field = typeof last === "string" ? last : undefined;
  const label = field !== undefined ? `поле "${field}"` : issue.path.length ? `элемент №${Number(last) + 1}` : "содержимое файла";
  switch (issue.code) {
    case "invalid_type": {
      const expected = typeName(String((issue as { expected?: unknown }).expected));
      if (value === undefined) return field !== undefined ? `не указано обязательное поле "${field}" (${expected})` : `не хватает значения (${expected})`;
      return `${label} — нужен тип «${expected}», получено ${shown(value)}`;
    }
    case "invalid_value": {
      const values = (issue as { values?: unknown[] }).values ?? [];
      return `${label} — допустимо: ${values.map(String).join(", ")}; получено ${shown(value)}`;
    }
    case "too_small":
    case "too_big": {
      const { origin, minimum, maximum, inclusive } = issue as { origin?: string; minimum?: number | bigint; maximum?: number | bigint; inclusive?: boolean };
      const small = issue.code === "too_small";
      const limit = Number(small ? minimum : maximum);
      if (origin === "string") {
        if (small && limit === 1) return `${label} — не может быть пустым`;
        return `${label} — ${small ? "не короче" : "не длиннее"} ${limit} символов, получено ${typeof value === "string" ? value.length : "?"}`;
      }
      if (origin === "array") return `${label} — ${small ? "не меньше" : "не больше"} ${limit} элементов, получено ${Array.isArray(value) ? value.length : "?"}`;
      const bound = small ? (inclusive ? `не меньше ${limit}` : `больше ${limit}`) : (inclusive ? `не больше ${limit}` : `меньше ${limit}`);
      return `${label} — нужно число ${bound}, получено ${shown(value)}`;
    }
    case "invalid_format": {
      const pattern = String((issue as { pattern?: unknown }).pattern ?? "").replace(/^\/|\/$/g, "");
      if (pattern === DATE_PATTERN) return `${label} — нужна дата ГГГГ-ММ-ДД, получено ${shown(value)}`;
      if (pattern === ID_PATTERN) return `${label} — нужен id: строчные латинские буквы, цифры, точка и дефис, первым символом буква или цифра; получено ${shown(value)}`;
      return `${label} — неверный формат (${issue.message}), получено ${shown(value)}`;
    }
    case "custom": {
      const text = customText(issue.message, field ?? "");
      if (text) return /^поле/.test(text) && issue.message === "Invalid calendar date" ? `${text}, получено ${shown(value)}` : text;
      return `${label} — ${issue.message}`;
    }
    case "unrecognized_keys":
      return `лишнее поле ${(issue as { keys: string[] }).keys.map((key) => `"${key}"`).join(", ")} — такого поля в формате нет (опечатка?)`;
    default:
      return `${label} — ${issue.message}`;
  }
}

/**
 * Turns the issues of a failed `safeParse` into problems. `context` may add a hint (like the id of the item) to an issue's path.
 * A calendar-date issue is dropped when the value is not even date-shaped: the format issue says it already.
 */
export function addIssues(problems: Problems, file: string, issues: readonly ZodIssue[], locator: Locator, context?: (path: Path) => string | undefined): void {
  for (const issue of issues) {
    const path = issue.path as Path;
    const value = locator.value(path);
    if (issue.code === "custom" && issue.message === "Invalid calendar date" && !(typeof value === "string" && new RegExp(DATE_PATTERN).test(value))) continue;
    const hint = context?.(path);
    const suffix = hint ? ` (${hint})` : "";
    if (issue.code === "unrecognized_keys") {
      for (const key of (issue as { keys: string[] }).keys) {
        problems.add(file, issueText({ ...issue, keys: [key] } as ZodIssue, value) + suffix, locator.line(path, key));
      }
      continue;
    }
    problems.add(file, issueText(issue, value) + suffix, locator.line(path));
  }
}
