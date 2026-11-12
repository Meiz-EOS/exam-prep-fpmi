// Checks a pack folder and prints every problem at once as `file:line: text` (docs/architecture/13-classmates.md#format).
//   npm run check:pack [path]     default path: the pack from zachetka.local.json (tools/lib/settings.ts)
// Exit code 1 when there is at least one problem. The rules live in build-pack.ts (`collectPack`), the wording in problems.ts.
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectPack } from "./build-pack.ts";
import { formatProblem, type PackProblem } from "./problems.ts";
import { loadSettings } from "../lib/settings.ts";

/** The path relative to `base`, or the absolute one when the pack lies outside of it. */
function shownPath(dir: string, base: string): string {
  const rel = relative(base, resolve(dir));
  return rel.startsWith("..") ? resolve(dir) : rel || ".";
}

export interface PackCheck {
  problems: PackProblem[];
  /** `ok: <path> (N items, ...)` when the pack is valid. */
  summary?: string;
}

/** Validates the pack folder `dir`: all problems, or a one-line summary of what the pack contains. */
export function checkPack(dir: string, base = process.cwd()): PackCheck {
  const { pack, problems } = collectPack(dir);
  if (problems.length || !pack) return { problems };
  const questions = (pack.tests ?? []).reduce((sum, test) => sum + test.questions.length, 0);
  const counts = [
    `${pack.subjects.length} subjects`, `${pack.items.length} items`,
    ...(pack.tickets ? [`${pack.tickets.length} tickets`] : []),
    ...(pack.exam ? [`${pack.exam.length} exam tickets`] : []),
    ...(pack.tests ? [`${pack.tests.length} tests, ${questions} questions`] : []),
    ...(pack.cards ? [`${pack.cards.length} cards`] : []),
    ...(pack.theory ? [`${pack.theory.length} theory entries`] : []),
  ];
  return { problems: [], summary: `ok: ${shownPath(dir, base)} (${counts.join(", ")})` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let dir: string;
  try {
    dir = process.argv[2] ?? loadSettings().pack;
  } catch (error) {
    console.error(`zachetka check:pack: ${(error as Error).message}`);
    process.exit(1);
  }
  const { problems, summary } = checkPack(dir);
  if (problems.length) {
    for (const problem of problems) console.log(formatProblem(problem, process.cwd()));
    console.error(`\nНайдено проблем: ${problems.length}`);
    process.exit(1);
  }
  console.log(summary);
}
