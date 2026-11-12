import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import type { BuiltExamTicket, BuiltTicket } from "../../../content/schema";
import { cell, type Attempt, type Level } from "../../../core/ready";
import type { Doc } from "../../../store/types";
import { useData } from "../../context";
import { t } from "../../i18n";
import { Math as MathText } from "../../math";
import { Sheet } from "../../sheet";
import "./theory.css";

const levels: Level[] = ["L0", "L1", "L2"];
const asAttempt = (doc: Doc): Attempt => ({ test: String(doc.test ?? ""), startedAt: String(doc.startedAt ?? ""), ...(typeof doc.finishedAt === "string" ? { finishedAt: doc.finishedAt } : {}), answers: Array.isArray(doc.answers) ? doc.answers as Attempt["answers"] : [] });

export type TheoryGroup = { exam: BuiltExamTicket | null; theorems: BuiltTicket[] };

/** Р-27: theorems grouped by exam ticket in `includes` order; exam tickets with no theorems are omitted; the rest go to «outside». */
export function groupTheoryByExam(tickets: BuiltTicket[], exam: BuiltExamTicket[]): TheoryGroup[] {
  if (!exam.length) return [{ exam: null, theorems: [...tickets].sort((a, b) => Number(!!b.key) - Number(!!a.key)) }];
  const included = new Set(exam.flatMap((ticket) => ticket.includes));
  const groups: TheoryGroup[] = exam.map((ticket) => ({ exam: ticket, theorems: ticket.includes.flatMap((id) => {
    const theorem = tickets.find((item) => item.id === id);
    return theorem ? [theorem] : [];
  }) })).filter((group) => group.theorems.length > 0);
  const outside = tickets.filter((ticket) => !included.has(ticket.id));
  if (outside.length) groups.push({ exam: null, theorems: outside });
  return groups;
}

export function Theory() {
  const { pack, store } = useData();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => store?.subscribe("attempts", (snap) => setAttempts(snap.docs.map(asAttempt)), () => {}), [store]);
  const subjects = pack.subjects.filter((subject) => pack.tickets?.some((ticket) => ticket.subject === subject.id));
  const tickets = pack.tickets ?? [];
  const selected = tickets.find((ticket) => ticket.id === openId);
  const entry = (pack.theory ?? []).find((item) => item.ticket === openId);

  return <main class="theory">
    {subjects.length === 0 && <p class="theory-empty">{t.theoryEmpty}</p>}
    {subjects.map((subject) => <section class="theory-subject" key={subject.id} aria-labelledby={`theory-${subject.id}`}>
      <h2 id={`theory-${subject.id}`}>{subject.name}</h2>
      <div class="theory-list">{renderGroups(subject.id, tickets, pack.exam ?? [], (ticket) => <button class="theory-ticket" type="button" key={ticket.id} onClick={() => setOpenId(ticket.id)}>
        <span class="theory-ticket-title">{ticket.title}{ticket.key && <span class="theory-key">{t.theoryKey}</span>}</span>
        <span class="theory-levels">{levels.map((level) => <span key={level}>{level} {valueLabel(ticket, level, pack.tests ?? [], attempts, pack.remap ?? {})}</span>)}</span>
        <span class="theory-chevron" aria-hidden="true">›</span>
      </button>)}</div>
    </section>)}
    {selected && <Sheet title={selected.title} sub={selected.key ? t.theoryKey : undefined} onClose={() => setOpenId(null)}>
      {entry ? <div class="theory-detail">
        <section><h3>{t.theoryFormulation}</h3><div class="theory-math"><MathText text={entry.formulation} /></div></section>
        {entry.skeleton && <section><h3>{t.theorySkeleton}</h3><ol>{entry.skeleton.map((step, index) => <li key={index}><MathText text={step} /></li>)}</ol></section>}
        {!!entry.reliesOn?.length && <section><h3>{t.theoryRelies}</h3><ul class="theory-relies">{entry.reliesOn.map((id) => <li key={id}><button type="button" onClick={() => setOpenId(id)}>{tickets.find((ticket) => ticket.id === id)?.title ?? id}</button></li>)}</ul></section>}
        {selected.src && <p class="theory-source"><span>{t.theorySource}: </span>{selected.src}</p>}
      </div> : <p class="theory-missing">{t.theoryMissing}</p>}
      <div class="theory-detail-levels">{levels.map((level) => <span key={level}>{level} <strong>{valueLabel(selected, level, pack.tests ?? [], attempts, pack.remap ?? {})}</strong></span>)}</div>
    </Sheet>}
  </main>;
}

/** Exam ticket code shown in group headers: id without the subject prefix (aig-b-g01 → b-g01). */
export const examCode = (ticket: BuiltExamTicket): string => ticket.id.startsWith(`${ticket.subject}-`) ? ticket.id.slice(ticket.subject.length + 1) : ticket.id;

function renderGroups(subjectId: string, tickets: BuiltTicket[], exam: BuiltExamTicket[], renderTicket: (ticket: BuiltTicket) => VNode) {
  const subjectTickets = tickets.filter((ticket) => ticket.subject === subjectId);
  const subjectExam = exam.filter((ticket) => ticket.subject === subjectId);
  const groups = groupTheoryByExam(subjectTickets, subjectExam);
  if (!subjectExam.length) return groups.flatMap((group) => group.theorems.map(renderTicket));
  return groups.map((group, index) => <section class="theory-exam-group" key={group.exam?.id ?? `outside-${index}`}>
    <h3>{group.exam ? <><span class="theory-exam-code">{examCode(group.exam)}</span> {group.exam.title} <span class="theory-confidence">{t.readyConfidence[group.exam.confidence]}</span></> : t.theoryOutside}</h3>
    {group.theorems.map(renderTicket)}
  </section>);
}

function valueLabel(ticket: BuiltTicket, level: Level, tests: NonNullable<ReturnType<typeof useData>["pack"]["tests"]>, attempts: Attempt[], remap: Readonly<Record<string, string>>): string {
  const value = cell(ticket.id, level, tests, attempts, remap).value;
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

