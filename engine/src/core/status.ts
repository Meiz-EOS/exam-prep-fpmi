export const STATUSES = ["не начато", "в работе", "сдано", "принято", "доработка"] as const;
export type Status = (typeof STATUSES)[number];

/** Submitted or accepted: no longer needs work. */
export const DONE: ReadonlySet<Status> = new Set<Status>(["сдано", "принято"]);

const NEXT: Record<Status, Status> = {
  "не начато": "в работе",
  "в работе": "сдано",
  "сдано": "принято",
  "принято": "не начато",
  "доработка": "сдано",
};

/** Status after one tap on the status button. */
export function nextStatus(s: Status): Status {
  return NEXT[s];
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** Checkbox items: ticked = done; ticking writes "принято", unticking "не начато". */
export const CHECKED: Status = "принято";
export const UNCHECKED: Status = "не начато";
