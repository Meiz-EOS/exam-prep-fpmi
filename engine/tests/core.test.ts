import { describe, expect, it } from "vitest";
import { dayNumber, daysUntil, dueOf, localISODate } from "../src/core/dates";
import { activeDue, hotDue, hotList } from "../src/core/hot";
import { groupProgress } from "../src/core/progress";
import { nextStatus, isStatus } from "../src/core/status";

const T = "2026-11-07";

describe("dates", () => {
  it("rejects impossible dates", () => {
    expect(dayNumber("2026-02-30")).toBeNull();
    expect(dayNumber("2026-11-7")).toBeNull();
    expect(daysUntil(T, "2026-11-08")).toBe(1);
    expect(daysUntil("2026-12-31", "2027-01-01")).toBe(1);
  });
  it("uses local calendar date", () => {
    expect(localISODate(new Date(2026, 10, 7, 23, 59))).toBe("2026-11-07");
  });
});

describe("dueOf", () => {
  it("soft ahead with hard following is not final", () => {
    expect(dueOf({ soft: "2026-11-10", hard: "2026-11-16" }, T)).toEqual({ date: "2026-11-10", days: 3, final: false, state: "soon" });
  });
  it("after soft passes, hard is used", () => {
    expect(dueOf({ soft: "2026-11-10", hard: "2026-11-16" }, "2026-11-11")).toEqual({ date: "2026-11-16", days: 5, final: true, state: "soon" });
  });
  it("only hard", () => {
    expect(dueOf({ hard: "2026-11-30" }, T)?.state).toBe("later");
  });
  it("overdue soft without hard", () => {
    expect(dueOf({ soft: "2026-11-01" }, T)).toEqual({ date: "2026-11-01", days: -6, final: true, state: "late" });
  });
  it("today", () => {
    expect(dueOf({ soft: T }, T)?.state).toBe("today");
  });
  it("7-day boundary", () => {
    expect(dueOf({ soft: "2026-11-14" }, T)?.state).toBe("soon");
    expect(dueOf({ soft: "2026-11-15" }, T)?.state).toBe("later");
  });
  it("no dates", () => {
    expect(dueOf({}, T)).toBeNull();
    expect(dueOf({ soft: null, hard: "bad" }, T)).toBeNull();
  });
});

describe("hot", () => {
  const base = { kind: "теордз", status: "не начато" as const };
  it("done items and exams are never hot", () => {
    expect(hotDue({ ...base, status: "сдано", soft: "2026-11-08" }, T)).toBeNull();
    expect(hotDue({ ...base, status: "принято", soft: "2026-11-01" }, T)).toBeNull();
    expect(hotDue({ ...base, kind: "экзамен", soft: "2026-11-08" }, T)).toBeNull();
  });
  it("rework ignores the pack deadline, keeps a deadline set by hand", () => {
    expect(hotDue({ ...base, status: "доработка", soft: "2026-11-08" }, T)).toBeNull();
    expect(hotDue({ ...base, status: "доработка", soft: "2026-11-09", override: { soft: "2026-11-09" } }, T)?.days).toBe(2);
  });
  it("active deadline: none once handed in, the usual one before", () => {
    expect(activeDue({ ...base, status: "сдано", soft: "2026-10-01" }, T)).toBeNull();
    expect(activeDue({ ...base, status: "принято", hard: "2026-10-01" }, T)).toBeNull();
    expect(activeDue({ ...base, status: "в работе", soft: "2026-10-01" }, T)?.state).toBe("late");
  });
  it("list matches v0 on 2026-11-07 and is sorted", () => {
    const items = [
      { id: "cpp-string", ...base, kind: "задача-cpp", soft: "2026-11-11" },
      { id: "aig2-submit", ...base, kind: "дз", soft: "2026-11-10", hard: "2026-11-16" },
      { id: "aisd-td04", ...base, soft: "2026-11-08" },
      { id: "cpp-bigint", ...base, kind: "задача-cpp", soft: "2026-11-29" },
      { id: "aig-kr1", ...base, kind: "кр", status: "принято" as const, soft: "2026-10-12" },
    ];
    expect(hotList(items, T).map((h) => h.item.id)).toEqual(["aisd-td04", "aig2-submit", "cpp-string"]);
  });
  it("kept items stay hot after they are done, exams still never", () => {
    const items = [
      { id: "a", ...base, status: "сдано" as const, soft: "2026-11-08" },
      { id: "b", ...base, status: "сдано" as const, soft: "2026-11-09" },
      { id: "e", ...base, kind: "экзамен", soft: "2026-11-08" },
    ];
    expect(hotList(items, T, (i) => i.id !== "b").map((h) => h.item.id)).toEqual(["a"]);
  });
});

describe("progress", () => {
  it("counts group progress", () => {
    const p = groupProgress(["принято", "сдано", "в работе", "доработка", "не начато"]);
    expect(p).toMatchObject({ total: 5, accepted: 1, submitted: 1, working: 2, done: 2 });
    expect(p.shares.working).toBeCloseTo(0.4);
  });
  it("empty group", () => {
    expect(groupProgress([]).shares.accepted).toBe(0);
  });
});

describe("status", () => {
  it("cycles", () => {
    expect(nextStatus("не начато")).toBe("в работе");
    expect(nextStatus("принято")).toBe("не начато");
    expect(nextStatus("доработка")).toBe("сдано");
    expect(isStatus("сдано")).toBe(true);
    expect(isStatus("done")).toBe(false);
  });
});
