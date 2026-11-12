import { dueOf, type Due, type ISODate, SOON_DAYS } from "./dates.ts";
import { DONE, type Status } from "./status.ts";

export interface HotInput {
  status: Status;
  kind: string;
  soft?: ISODate | null;
  hard?: ISODate | null;
  /** Dates the student set by hand (they are already merged into soft/hard). */
  override?: { soft?: ISODate; hard?: ISODate };
}

/**
 * The deadline that still applies. Deadlines are for handing work in, not for checking it (decision 08.11):
 * - submitted or accepted → none;
 * - rework → only dates the student set by hand (the pack deadline was for the first hand-in);
 * - otherwise → the usual soft/hard deadline.
 */
export function activeDue(item: HotInput, today: ISODate): Due | null {
  if (DONE.has(item.status)) return null;
  if (item.status === "доработка") return item.override ? dueOf(item.override, today) : null;
  return dueOf(item, today);
}

/** Overdue or due within SOON_DAYS by the deadline that still applies, not an exam. `keepDone` keeps an item that was just marked done. */
export function hotDue(item: HotInput, today: ISODate, keepDone = false): Due | null {
  if (item.kind === "экзамен") return null;
  const due = keepDone && DONE.has(item.status) ? dueOf(item, today) : activeDue(item, today);
  return due && due.days <= SOON_DAYS ? due : null;
}

/**
 * Hot items sorted by the date that matters now (earliest first).
 * `keep` marks items that stay even when done (changed in this session, so they do not vanish under the finger).
 */
export function hotList<T extends HotInput>(items: readonly T[], today: ISODate, keep?: (item: T) => boolean): { item: T; due: Due }[] {
  const out: { item: T; due: Due }[] = [];
  for (const item of items) {
    const due = hotDue(item, today, keep?.(item) ?? false);
    if (due) out.push({ item, due });
  }
  return out.sort((a, b) => a.due.days - b.due.days);
}
