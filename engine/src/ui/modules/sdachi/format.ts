import type { Due, ISODate } from "../../../core/dates";
import type { Strings } from "../../i18n";

/** `2026-11-10` → `10.11`. */
export function shortDate(d: ISODate): string {
  return `${d.slice(8, 10)}.${d.slice(5, 7)}`;
}

/** Row highlight for a deadline: overdue and today are "late", the next days "soon", the rest plain. */
export function dueClass(due: Due | null): "" | "late" | "soon" {
  if (!due) return "";
  if (due.state === "late" || due.state === "today") return "late";
  return due.state === "soon" ? "soon" : "";
}

/** Grey line under an item title: context or kind (single problems have none), score, the student's note or else the pack note. */
export function rowMeta(item: { kind?: string; score?: number | string; note?: string; packNote?: string }, t: Pick<Strings, "score">, context?: string): string[] {
  const meta: string[] = [];
  if (context) meta.push(context);
  else if (item.kind && item.kind !== "дз-задача") meta.push(item.kind);
  if (item.score !== undefined) meta.push(t.score(String(item.score)));
  if (item.note) meta.push(`✎ ${item.note}`);
  else if (item.packNote && !context) meta.push(item.packNote);
  return meta;
}

export function dueText(due: Due, t: Strings): string {
  const d = shortDate(due.date);
  const base = due.days < 0 ? t.dueLate(d, -due.days)
    : due.days === 0 ? t.dueToday(d)
    : due.days === 1 ? t.dueTomorrow(d)
    : t.dueIn(d, due.days);
  return due.final ? base : `${base} (${t.soft})`;
}
