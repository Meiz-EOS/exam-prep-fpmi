import { parseTodayDoc, type TodayDoc } from "../content/schema.ts";
import type { SubjectReady } from "./ready.ts";

export interface TodayPlan {
  doc: TodayDoc | null;
  stale: boolean;
}

function moscowDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function todayPlan(value: unknown, now: Date): TodayPlan {
  const doc = parseTodayDoc(value);
  return { doc, stale: doc !== null && doc.date !== moscowDate(now) };
}

export interface WeakTicket {
  ticket: string;
  level: SubjectReady["cells"][number]["level"];
  value: number;
}

export function weakestTickets(subjects: readonly SubjectReady[], count = 5): WeakTicket[] {
  return subjects.flatMap((subject) => subject.cells)
    .filter((cell): cell is typeof cell & { value: number } => cell.value !== null)
    .sort((a, b) => a.value - b.value || a.ticket.localeCompare(b.ticket) || a.level.localeCompare(b.level))
    .slice(0, Math.max(0, count))
    .map(({ ticket, level, value }) => ({ ticket, level, value }));
}
