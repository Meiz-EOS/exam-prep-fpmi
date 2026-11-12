import { describe, expect, it } from "vitest";
import {
  combine, decide, fromAlgoTheory, fromCotests, fromGithubPrs, fromGitlabRefs, fromManytask, type Observation, parseCsv,
} from "./core.ts";

const items = new Set(["cpp-mult", "cpp-stack", "aisd-c4-a", "aisd-c1-e", "aisd-td02", "aisd-td04"]);

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and newlines inside fields", () => {
    expect(parseCsv('"a","b,c","d ""q"""\n"x\ny",2,\n')).toEqual([["a", "b,c", 'd "q"'], ["x\ny", "2", ""]]);
  });
});

describe("sources", () => {
  it("manytask: only the login's rows; + ? - map to принято / сдано / доработка", () => {
    const csv = [
      '"login","task","group","status"',
      '"student1","multiplication","00-setup","+"',
      '"student1","stack","02","-"',
      '"student1","string","03","?"',
      '"other","multiplication","00-setup","-"',
      '"student1","newtask","05","+"',
    ].join("\n");
    const r = fromManytask(csv, "student1", { multiplication: "cpp-mult", stack: "cpp-stack", string: "cpp-string" });
    expect(r.obs.map((o) => [o.item, o.status])).toEqual([["cpp-mult", "принято"], ["cpp-stack", "доработка"], ["cpp-string", "сдано"]]);
    expect(r.unmapped).toEqual([{ source: "manytask", key: "newtask" }]);
  });

  it("gitlab: an MR whose head is a submit/ branch means handed in", () => {
    const ls = "aaa\trefs/heads/submit/stack\nbbb\trefs/heads/submit/string\naaa\trefs/merge-requests/4/head\nccc\trefs/merge-requests/4/merge\n";
    expect(fromGitlabRefs(ls, { stack: "cpp-stack", string: "cpp-string" }).obs).toEqual([{ item: "cpp-stack", status: "сдано", source: "MR submit/stack" }]);
  });

  it("github: review decision and state; other branches ignored", () => {
    const r = fromGithubPrs([
      { number: 7, headRefName: "1contest_taskE", state: "OPEN", reviewDecision: "CHANGES_REQUESTED" },
      { number: 8, headRefName: "4contest_taskA", state: "OPEN", reviewDecision: "APPROVED" },
      { number: 9, headRefName: "Meiz-EOS-patch-1-B", state: "MERGED", reviewDecision: "" },
      { number: 10, headRefName: "2contest_taskQ", state: "OPEN", reviewDecision: "" },
    ], items);
    expect(r.obs.map((o) => [o.item, o.status])).toEqual([["aisd-c1-e", "доработка"], ["aisd-c4-a", "принято"]]);
    expect(r.unmapped).toEqual([{ source: "github PR", key: "#10 2contest_taskQ" }]);
  });

  it("cotests: one-letter solution files only", () => {
    const r = fromCotests(["algos_dz_4/a.cpp", "algos_dz_4/a_st.cpp", "algos_dz_4/Z.cpp", "check.sh"], items);
    expect(r.obs).toEqual([{ item: "aisd-c4-a", status: "сдано", source: "cotests algos_dz_4/a.cpp" }]);
    expect(r.unmapped).toEqual([{ source: "cotests", key: "algos_dz_4/Z.cpp" }]);
  });

  it("algorithms sheet: a graded theory block after contest N → aisd-tdNN принято", () => {
    const csv = [
      '"","Студент","Группа","4. Деревья Контест","","Теория","","2. Сортировки Контест","Теория",""',
      '"","Иванов","Б05","1","","","","1","",""',
      '"","Иванов Иван","Б05","","","0.8","","2","",""',
    ].join("\n");
    const r = fromAlgoTheory(csv, "Иванов Иван", items);
    expect(r.obs.map((o) => o.item)).toEqual(["aisd-td04"]);
    expect(() => fromAlgoTheory(csv, "Нет Такого", items)).toThrow(/not found/);
  });
});

describe("rule", () => {
  const ob = (item: string, status: Observation["status"]): Observation => ({ item, status, source: "s" });

  it("combine keeps the strongest claim per item", () => {
    const m = combine([ob("x", "сдано"), ob("x", "принято"), ob("y", "доработка"), ob("y", "сдано")]);
    expect(m.get("x")?.status).toBe("принято");
    expect(m.get("y")?.status).toBe("сдано");
  });

  it("raises, sets доработка, never lowers otherwise", () => {
    const claims = combine([ob("a", "принято"), ob("b", "сдано"), ob("c", "доработка"), ob("d", "сдано")]);
    const cur = new Map([["a", "сдано"], ["b", "принято"], ["c", "принято"], ["d", "доработка"]] as const);
    const { changes } = decide(claims, cur, {});
    expect(changes.map((c) => [c.item, c.to])).toEqual([["a", "принято"], ["c", "доработка"], ["d", "сдано"]]);
  });

  it("acts only when the source value changed since the last run", () => {
    const claims = combine([ob("a", "доработка")]);
    const first = decide(claims, new Map([["a", "сдано"]]), {});
    expect(first.changes).toHaveLength(1);
    // the student resubmitted by hand; the table still says "-": no change
    const again = decide(claims, new Map([["a", "сдано"]]), first.seen);
    expect(again.changes).toEqual([]);
    // the table moves on: applies again
    expect(decide(combine([ob("a", "принято")]), new Map([["a", "сдано"]]), first.seen).changes).toHaveLength(1);
  });
});
