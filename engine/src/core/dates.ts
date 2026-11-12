/** Calendar date as `YYYY-MM-DD`. */
export type ISODate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a valid ISO date, or null. */
export function dayNumber(date: ISODate): number | null {
  const m = RE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

/** Local calendar date of a moment (the viewer's "today"). */
export function localISODate(now: Date): ISODate {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Whole days from `today` to `date` (negative when `date` is in the past). */
export function daysUntil(today: ISODate, date: ISODate): number | null {
  const a = dayNumber(today);
  const b = dayNumber(date);
  return a === null || b === null ? null : b - a;
}

export type DueState = "late" | "today" | "soon" | "later";

export interface Due {
  date: ISODate;
  days: number;
  /** False while a soft deadline is current and a hard one still follows. */
  final: boolean;
  state: DueState;
}

/** Deadlines closer than this many days count as "soon". */
export const SOON_DAYS = 7;

/**
 * The deadline that matters today: the soft one until it passes, then the hard one.
 * Returns null when the item has no valid deadline.
 */
export function dueOf(item: { soft?: ISODate | null; hard?: ISODate | null }, today: ISODate): Due | null {
  const soft = item.soft ? daysUntil(today, item.soft) : null;
  const hard = item.hard ? daysUntil(today, item.hard) : null;
  let date: ISODate;
  let days: number;
  let final: boolean;
  if (soft !== null && soft >= 0) {
    [date, days, final] = [item.soft!, soft, hard === null];
  } else if (hard !== null) {
    [date, days, final] = [item.hard!, hard, true];
  } else if (soft !== null) {
    [date, days, final] = [item.soft!, soft, true];
  } else {
    return null;
  }
  const state: DueState = days < 0 ? "late" : days === 0 ? "today" : days <= SOON_DAYS ? "soon" : "later";
  return { date, days, final, state };
}
