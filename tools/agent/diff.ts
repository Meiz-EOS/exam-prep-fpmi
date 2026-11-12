// Session-start report for the agent: what changed in progress since the last snapshot.
// Usage: node tools/agent/diff.ts [--data <pack data dir>] [--pack <pack dir>] [--no-save]  (defaults: tools/lib/settings.ts)
// Remembers the last check in <pack data dir>/private/last-seen*.json.
//    or: node tools/agent/diff.ts --docs <dir>/items [--attempts <dir>/attempts] --pack … (claude.ai snapshot)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { BuiltPack, BuiltTest, Question } from "../../engine/src/content/schema.ts";
import { mergeView, type ProgressDoc, type ViewItem } from "../../engine/src/core/merge.ts";
import { buildPack } from "../pack/build-pack.ts";
import { loadSettings } from "../lib/settings.ts";
import { type Attempt, type Answer, subjectReady, type SubjectReady, type Level } from "../../engine/src/core/ready.ts";

/** What is remembered per item between sessions. */
export type Seen = Record<string, { status: string; note?: string; score?: string; override?: string }>;

/** What is remembered per attempt answer between sessions. */
export type SeenAttempts = Record<string, { answeredAt: string; agent?: number }>;

/** Reads documents saved by `ArtifactData list ... out_dir` (bare body or {id, data} wrapper). */
export function readDocs(dir: string): ProgressDoc[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : f.slice(0, -5);
    const body = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : raw;
    return { ...body, id };
  });
}

/** Reads attempt documents from a directory. */
export function readAttempts(dir: string): Attempt[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>;
    const body = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : raw;
    return body as unknown as Attempt;
  });
}

function snap(it: ViewItem): Seen[string] {
  const s: Seen[string] = { status: it.status };
  if (it.note) s.note = it.note;
  if (it.score !== undefined) s.score = String(it.score);
  if (it.override) s.override = JSON.stringify(it.override);
  return s;
}

function answerKey(attempt: Attempt, answer: Answer): string {
  return `${attempt.test}:${answer.q}:${answer.at}`;
}

/** Item changes since the snapshot, one list per report section, and the next snapshot. */
function itemChanges(items: ViewItem[], seen: Seen) {
  const next: Seen = {};
  const status: string[] = [], notes: string[] = [], scores: string[] = [], overrides: string[] = [], custom: string[] = [];
  const label = (it: ViewItem) => `${it.id} «${it.title}»`;
  for (const it of items) {
    const now = snap(it);
    next[it.id] = now;
    const was = seen[it.id];
    if ((was?.status ?? "не начато") !== now.status) status.push(`  ${label(it)}: ${was?.status ?? "не начато"} → ${now.status}`);
    if (now.note && now.note !== was?.note) notes.push(`  ${label(it)}: ${now.note}`);
    if (now.score && now.score !== was?.score) scores.push(`  ${label(it)}: ${now.score}`);
    if (it.override) overrides.push(`  ${label(it)}: ${now.override}${now.override === was?.override ? "" : " (новое)"}`);
    if (it.source === "custom" && !was) custom.push(`  ${label(it)} [${it.subject}] ${it.soft ?? ""}`.trimEnd());
  }
  return { next, status, notes, scores, overrides, custom };
}

/** Answers not seen before, answers without an agent grade, and the next answer snapshot. */
function answerChanges(attempts: Attempt[], seenAttempts: SeenAttempts) {
  const newAnswers: string[] = [];
  const ungradedAnswers: string[] = [];
  const nextAttempts: SeenAttempts = {};

  for (const attempt of attempts) {
    for (const answer of attempt.answers) {
      const key = answerKey(attempt, answer);
      const was = seenAttempts[key];
      nextAttempts[key] = { answeredAt: answer.at, agent: answer.agent };
      if (!was) {
        const score = answer.agent ?? (answer.gross ? 0 : answer.self);
        const text = answer.text ? answer.text.slice(0, 80) : "";
        newAnswers.push(`  ${answer.q} (${attempt.test}): ${score.toFixed(2)} — ${text}`);
      }
      if (answer.agent === undefined) {
        ungradedAnswers.push(`  ${answer.q} (${attempt.test}): self=${answer.self.toFixed(2)}${answer.gross ? " gross" : ""}`);
      }
    }
  }
  return { newAnswers, ungradedAnswers, nextAttempts };
}

/** Readiness shares per subject that has attempts. */
function subjectLines(pack: BuiltPack, attempts: Attempt[]): string[] {
  const lines: string[] = [];
  for (const subject of pack.subjects) {
    const subjectAttempts = attempts.filter((a) => {
      const test = pack.tests?.find((t) => t.id === a.test);
      return test?.subject === subject.id;
    });
    if (subjectAttempts.length === 0) continue;
    const ready: SubjectReady = subjectReady(subject.id, pack, subjectAttempts, new Date());
    const levels: Level[] = ["L0", "L1", "L2"];
    const shares = levels.map((l) => ready.shares[l] !== undefined ? `${l}=${(ready.shares[l]! * 100).toFixed(0)}%` : `${l}=—`).join(" ");
    lines.push(`  ${subject.name}: ${shares}  toUd=${ready.toUd} toHor=${ready.toHor}`);
  }
  return lines;
}

export function report(
  pack: BuiltPack,
  docs: ProgressDoc[],
  seen: Seen,
  attempts: Attempt[],
  seenAttempts: SeenAttempts,
): { lines: string[]; next: Seen; nextAttempts: SeenAttempts } {
  const view = mergeView(pack, docs);
  const items = itemChanges([...view.items, ...view.orphans], seen);
  const answers = answerChanges(attempts, seenAttempts);
  const lines: string[] = [];
  const add = (title: string, list: string[]) => { if (list.length) lines.push(`${title} (${list.length}):`, ...list); };
  add("Статусы", items.status);
  add("Заметки", items.notes);
  add("Баллы", items.scores);
  add("Правки сроков/названий — перенести в пакет по согласованию", items.overrides);
  add("Новые свои пункты", items.custom);
  add("Без пакета (осиротевшие id)", view.orphans.map((o) => `  ${o.id}: ${o.status}`));
  if (attempts.length) {
    add("Новые ответы", answers.newAnswers);
    add("Ответы без оценки агента", answers.ungradedAnswers);
    add("Готовность по предметам", subjectLines(pack, attempts));
  }
  return { lines: lines.length ? lines : ["Изменений нет."], next: items.next, nextAttempts: answers.nextAttempts };
}

/** `--data <dir>` (PC data folder) stands for `--docs <dir>/items --attempts <dir>/attempts`. */
export function inputs(v: { data?: string; docs?: string; attempts?: string }): { docs?: string; attempts?: string } {
  if (v.data && (v.docs || v.attempts)) throw new Error("use either --data or --docs/--attempts");
  return v.data ? { docs: join(v.data, "items"), attempts: join(v.data, "attempts") } : { docs: v.docs, attempts: v.attempts };
}

function main(): void {
  const { values } = parseArgs({ options: { data: { type: "string" }, docs: { type: "string" }, pack: { type: "string" }, attempts: { type: "string" }, "no-save": { type: "boolean" } } });
  const s = values.pack && values.data ? undefined : loadSettings();
  const src = inputs(values.data || values.docs ? values : { ...values, data: s!.packData });
  const pack = values.pack ?? s!.pack;
  if (!src.docs) throw new Error("usage: [--data <dir> | --docs <dir> [--attempts <dir>]] [--pack <pack dir>] [--no-save]");
  // Last snapshot is personal: kept in the pack data folder (13-classmates.md#private).
  const privateDir = join(values.data ?? s!.packData, "private");
  const seenPath = join(privateDir, "last-seen.json");
  const seen: Seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, "utf8")) : {};
  const attemptsSeenPath = join(privateDir, "last-seen-attempts.json");
  const seenAttempts: SeenAttempts = existsSync(attemptsSeenPath) ? JSON.parse(readFileSync(attemptsSeenPath, "utf8")) : {};
  const { lines, next, nextAttempts } = report(
    buildPack(pack),
    readDocs(src.docs),
    seen,
    src.attempts ? readAttempts(src.attempts) : [],
    seenAttempts,
  );
  console.log(lines.join("\n"));
  if (!values["no-save"]) {
    mkdirSync(privateDir, { recursive: true });
    writeFileSync(seenPath, JSON.stringify(next, null, 1) + "\n");
    writeFileSync(attemptsSeenPath, JSON.stringify(nextAttempts, null, 1) + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();