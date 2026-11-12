/** Item kinds; kept free of zod so the page can import it without the validator. */
export const KINDS = ["дз", "дз-задача", "теордз", "контест", "задача-cpp", "устная", "кр", "экзамен"] as const;
export type Kind = (typeof KINDS)[number];

/** Kinds tracked with a "solved" checkbox instead of the five statuses (single problems of an assignment). */
const CHECK_KINDS: ReadonlySet<string> = new Set<Kind>(["дз-задача"]);
export const isCheckKind = (kind: string): boolean => CHECK_KINDS.has(kind);
