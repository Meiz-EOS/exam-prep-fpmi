import katex from "katex";
import { describe, expect, it } from "vitest";
import { buildPack } from "../../tools/pack/build-pack";
import { splitMath } from "../src/ui/math";
import { ticketTestGaps, ticketTestMinutes, topicTestGaps, topicTestMinutes } from "../src/content/coverage";

// Content written by tools can lose backslashes (\f, \v become control characters; \mathbb becomes "mathbb").
// Every text in the real pack must be clean and every formula must render.
const pack = buildPack("packs/igor-2026w");
const texts: { where: string; text: string }[] = [];
for (const test of pack.tests ?? []) {
  for (const q of test.questions) {
    texts.push({ where: `${test.id}/${q.id}`, text: q.body });
    q.points.forEach((p, i) => texts.push({ where: `${test.id}/${q.id}#${i + 1}`, text: p }));
  }
}
for (const card of pack.cards ?? []) {
  texts.push({ where: card.id, text: `${card.question}\n${card.answer}` });
}
for (const entry of pack.theory ?? []) {
  texts.push({ where: entry.ticket, text: entry.formulation });
  entry.skeleton?.forEach((step, i) => texts.push({ where: `${entry.ticket}#${i + 1}`, text: step }));
}
const BARE = /(?<![\\A-Za-z])(mathbb|mathcal|forall|exists|varepsilon|frac|lim|alpha|beta|infty|sum|sqrt|cdot|ldots|leqslant|geqslant)(?![A-Za-z])/;

describe("igor-2026w text and formulas", () => {
  it("ticket titles are plain text (shown without KaTeX)", () => {
    const bad = (pack.tickets ?? []).filter((ticket) => /[\\${}]|\^[\s{]|(?<![A-Za-z])_|_(?=[\d{]|[A-Za-z](?![A-Za-z]))|enumerate|itemize|[pv]matrix|\b(proposition|theorem|lemma|corollary|definition)\b/i.test(ticket.title)).map((ticket) => ticket.id);
    expect(bad).toEqual([]);
  });
  it("ticket titles have balanced brackets unless shortened with …", () => {
    const pairs: [string, string][] = [["(", ")"], ["[", "]"]];
    const balanced = (s: string) => pairs.every(([o, c]) => s.split(o).length === s.split(c).length);
    expect((pack.tickets ?? []).filter((ticket) => !ticket.title.endsWith("…") && !balanced(ticket.title)).map((ticket) => ticket.id)).toEqual([]);
  });
  it("has no control characters", () => {
    expect(texts.filter((t) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t.text)).map((t) => t.where)).toEqual([]);
  });
  it("has no LaTeX commands without a backslash inside formulas", () => {
    const bad = texts.filter((t) => splitMath(t.text).some((p) => p.math && BARE.test(p.tex))).map((t) => t.where);
    expect(bad).toEqual([]);
  });
  it("has no doubled backslash before a command inside formulas (\\\\mathbb renders as a line break + text)", () => {
    const bad = texts.filter((t) => splitMath(t.text).some((p) => p.math && /(?<!\\)\\\\[a-z]{2,}/.test(p.tex))).map((t) => t.where);
    expect(bad).toEqual([]);
  });
  it("every formula renders with KaTeX", () => {
    const bad: string[] = [];
    for (const t of texts) {
      for (const p of splitMath(t.text)) {
        if (!p.math) continue;
        try { katex.renderToString(p.tex, { displayMode: p.display, throwOnError: true }); } catch { bad.push(`${t.where}: ${p.src.slice(0, 40)}`); }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("igor-2026w ticket tests", () => {
  const ticketTests = (pack.tests ?? []).filter((test) => test.kind === "ticket");
  it("every theorem of an exam ticket with a test has L0 and L1 questions (Р-24)", () => {
    expect(ticketTestGaps(pack.tests ?? [], pack.exam ?? [], pack.tickets ?? [])).toEqual([]);
  });
  it("minutes = 2 per L0 + 4 per L1 question (Р-23)", () => {
    const wrong = ticketTests.map((test) => ({ id: test.id, minutes: test.minutes, expected: ticketTestMinutes(test, pack.tests ?? []) }))
      .filter((item) => item.minutes !== item.expected);
    expect(wrong).toEqual([]);
  });
});

describe("igor-2026w topic tests", () => {
  const topicTests = (pack.tests ?? []).filter((test) => test.kind === "topic");
  it("has L0 and L1 for covered tickets (L0 only when maxLevel is L0)", () => {
    expect(topicTestGaps(pack.tests ?? [], pack.tickets ?? [])).toEqual([]);
  });
  it("minutes = 2 per L0 + 4 per L1 + 8 per L2 question", () => {
    expect(topicTests.map((test) => ({ id: test.id, minutes: test.minutes, expected: topicTestMinutes(test, pack.tests ?? []) }))
      .filter((item) => item.minutes !== item.expected)).toEqual([]);
  });
  it("does not cover a ticket in two topic tests of the same level (Р-38, Р-51)", () => {
    const owners = new Map<string, string>();
    const duplicates: string[] = [];
    for (const test of topicTests) for (const ticket of test.covers ?? []) {
      const key = `${test.level ?? "L0/L1"} ${ticket}`;
      const previous = owners.get(key);
      if (previous !== undefined) duplicates.push(`${ticket}: ${previous}, ${test.id}`);
      owners.set(key, test.id);
    }
    expect(duplicates).toEqual([]);
  });
});
