import type { Status } from "./status.ts";

export interface GroupProgress {
  total: number;
  accepted: number;
  submitted: number;
  /** In progress or sent back for rework. */
  working: number;
  /** accepted + submitted: the "14/40" number. */
  done: number;
  /** Shares 0..1 for the progress bar segments. */
  shares: { accepted: number; submitted: number; working: number };
}

export function groupProgress(statuses: readonly Status[]): GroupProgress {
  let accepted = 0, submitted = 0, working = 0;
  for (const s of statuses) {
    if (s === "принято") accepted++;
    else if (s === "сдано") submitted++;
    else if (s === "в работе" || s === "доработка") working++;
  }
  const total = statuses.length;
  const share = (n: number) => (total ? n / total : 0);
  return {
    total, accepted, submitted, working, done: accepted + submitted,
    shares: { accepted: share(accepted), submitted: share(submitted), working: share(working) },
  };
}
