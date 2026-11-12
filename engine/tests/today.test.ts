import { describe, expect, it } from "vitest";
import { parseTodayDoc } from "../src/content/schema.ts";
import { todayPlan, weakestTickets } from "../src/core/today.ts";
import type { SubjectReady } from "../src/core/ready.ts";

describe("today", () => {
  it("marks a plan stale by Moscow calendar day", () => {
    expect(todayPlan({ date: "2026-11-08", plan: [] }, new Date("2026-11-08T22:30:00Z")).stale).toBe(true);
    expect(todayPlan({ date: "2026-11-09", plan: [] }, new Date("2026-11-08T22:30:00Z")).stale).toBe(false);
  });

  it("tolerates empty and malformed documents and drops invalid fields", () => {
    expect(parseTodayDoc(null)).toBeNull();
    expect(parseTodayDoc({})).toBeNull();
    expect(parseTodayDoc({ date: "2026-11-09", plan: "bad", note: 4 })).toBeNull();
    expect(parseTodayDoc({ date: "2026-11-09", plan: [{ id: "p", text: "read", done: "yes" }, { text: "bad" }], note: 4 }))
      .toEqual({ date: "2026-11-09", plan: [{ id: "p", text: "read" }] });
  });

  it("returns the five weakest answered cells, excluding missing values", () => {
    const cells = Array.from({ length: 7 }, (_, i) => ({ ticket: `t${i}`, level: "L0" as const, mastered: false, value: i === 0 ? null : i / 10 }));
    const ready = { subject: "math", shares: {}, toUd: false, toHor: false, missing: { ud: { levels: [], tickets: [] }, hor: { levels: [], tickets: [] } }, cells } satisfies SubjectReady;
    expect(weakestTickets([ready])).toEqual([
      { ticket: "t1", level: "L0", value: 0.1 }, { ticket: "t2", level: "L0", value: 0.2 },
      { ticket: "t3", level: "L0", value: 0.3 }, { ticket: "t4", level: "L0", value: 0.4 },
      { ticket: "t5", level: "L0", value: 0.5 },
    ]);
  });
});
