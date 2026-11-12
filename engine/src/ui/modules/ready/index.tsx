import { useEffect, useState } from "preact/hooks";
import type { BuiltExamTicket, BuiltTicket } from "../../../content/schema";
import { cell, subjectReady, type Attempt, type Level } from "../../../core/ready";
import type { Doc } from "../../../store/types";
import { useData } from "../../context";
import { t } from "../../i18n";
import "./ready.css";

const levels: Level[] = ["L0", "L1", "L2"];
const asAttempt = (doc: Doc): Attempt => ({ test: String(doc.test ?? ""), startedAt: String(doc.startedAt ?? ""), ...(typeof doc.finishedAt === "string" ? { finishedAt: doc.finishedAt } : {}), answers: Array.isArray(doc.answers) ? doc.answers as Attempt["answers"] : [] });

export function Ready() {
  const { pack, store } = useData();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  useEffect(() => store?.subscribe("attempts", (snap) => setAttempts(snap.docs.map(asAttempt)), () => {}), [store]);
  const subjects = pack.subjects.filter((subject) => pack.tickets?.some((ticket) => ticket.subject === subject.id));
  const tests = pack.tests ?? [];
  return <main class="ready">
    {subjects.length === 0 && <p class="ready-empty">{t.readyEmpty}</p>}
    {subjects.map((subject) => {
      const summary = subjectReady(subject.id, pack, attempts, new Date(), pack.remap);
      const tickets = (pack.tickets ?? []).filter((ticket) => ticket.subject === subject.id);
      const exam = (pack.exam ?? []).filter((ticket) => ticket.subject === subject.id);
      const displayTickets = exam.length ? exam.map((ticket) => {
        const included = ticket.includes.map((id) => tickets.find((item) => item.id === id)).filter((item): item is BuiltTicket => item !== undefined);
        const maxLevel = included.reduce<Level | undefined>((max, item) => !max || levels.indexOf(item.maxLevel ?? "L2") > levels.indexOf(max) ? item.maxLevel ?? "L2" : max, undefined);
        return { id: ticket.id, title: ticket.title, key: included.some((item) => item.key), maxLevel };
      }) : tickets;
      return <details class="ready-subject" key={subject.id} open>
        <summary><span>{subject.name}</span><span class="ready-summary num">{levels.map((level) => `${level} ${percent(summary.shares[level])}`).join(" · ")}</span></summary>
        <div class="ready-body">
          <div class="ready-shares">{levels.map((level) => <div class="ready-share" key={level}>
            <span>{t.readyLevel(level)}</span><span class="num">{percent(summary.shares[level])}</span><Bar value={summary.shares[level]} />
          </div>)}</div>
          <div class="ready-goals">
            <Goal label={t.readyToUd} met={summary.toUd} gaps={gaps(summary.cells, displayTickets, pack.thresholds?.ud ?? {}, false)} />
            <Goal label={t.readyToHor} met={summary.toHor} gaps={gaps(summary.cells, displayTickets, pack.thresholds?.hor ?? {}, !!pack.thresholds?.hor.keyL2)} />
          </div>
          <div class="ready-table" role="table" aria-label={subject.name}>
            <div class="ready-head" role="row"><span role="columnheader">{t.readyTitle}</span>{levels.map((level) => <span role="columnheader" key={level}>{level}</span>)}</div>
            {exam.length ? <>
              {exam.map((ticket) => <details class="ready-exam" key={ticket.id}><summary><span>{ticket.title} <span class="ready-confidence">{t.readyConfidence[ticket.confidence]}</span></span><ExamValues ticket={ticket} summary={summary.cells} /></summary>
                <div class="ready-exam-theorems">{ticket.includes.map((id) => { const theorem = tickets.find((item) => item.id === id); return theorem && <TicketRow key={id} ticket={theorem} attempts={attempts} tests={tests} remap={pack.remap ?? {}} />; })}</div>
              </details>)}
              {tickets.filter((ticket) => !exam.some((item) => item.includes.includes(ticket.id))).length > 0 && <section class="ready-outside"><h3>{t.readyOutside}</h3>{tickets.filter((ticket) => !exam.some((item) => item.includes.includes(ticket.id))).map((ticket) => <TicketRow key={ticket.id} ticket={ticket} attempts={attempts} tests={tests} remap={pack.remap ?? {}} />)}</section>}
            </> : tickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} attempts={attempts} tests={tests} remap={pack.remap ?? {}} />)}
          </div>
        </div>
      </details>;
    })}
  </main>;
}

function ExamValues({ ticket, summary }: { ticket: BuiltExamTicket; summary: ReturnType<typeof subjectReady>["cells"] }) {
  return <span class="ready-exam-values">{levels.map((level) => { const cell = summary.find((item) => item.ticket === ticket.id && item.level === level); return <span key={level}>{level} <Value cell={cell !== undefined} value={cell?.value ?? null} /></span>; })}</span>;
}

function percent(value: number | undefined): string { return value === undefined ? "—" : `${Math.round(value * 100)}%`; }
/** Р-54: «n/a» — the ticket has no such level (maxLevel); «—» — the level exists but has no answers yet. */
function Value({ cell, value }: { cell: boolean; value: number | null }) {
  return !cell ? <span class="ready-na">{t.readyNa}</span> : <>{value === null ? "—" : percent(value)}</>;
}
function Bar({ value }: { value: number | undefined }) { return <span class="ready-bar" aria-hidden="true"><span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} /></span>; }
type Cell = { ticket: string; level: Level; mastered: boolean };
/** What is still short of a threshold, as counts: "L0: 3 of 84, need 80" — never a list of ticket names. */
function gaps(cells: readonly Cell[], tickets: readonly { id: string; key?: boolean; maxLevel?: Level }[], thresholds: Partial<Record<Level, number>>, keyL2: boolean): string[] {
  const out: string[] = [];
  for (const level of levels) {
    const share = thresholds[level];
    const eligible = tickets.filter((ticket) => !ticket.maxLevel || levels.indexOf(level) <= levels.indexOf(ticket.maxLevel));
    const total = eligible.length;
    if (share === undefined || total === 0) continue;
    const have = eligible.filter((ticket) => cells.some((c) => c.ticket === ticket.id && c.level === level && c.mastered)).length;
    const need = Math.ceil(share * total);
    if (have < need) out.push(t.readyGap(level, have, total, need));
  }
  const keys = tickets.filter((ticket) => ticket.key);
  if (keyL2 && keys.length) {
    const have = keys.filter((ticket) => cells.some((c) => c.ticket === ticket.id && c.level === "L2" && c.mastered)).length;
    if (have < keys.length) out.push(t.readyKeyGap(have, keys.length));
  }
  return out;
}
function Goal({ label, met, gaps }: { label: string; met: boolean; gaps: string[] }) {
  return <div class="ready-goal"><span class="ready-goal-label">{label}</span>
    {met ? <span class="ready-met">{t.readyMet}</span> : <ul class="ready-gaps">{gaps.map((g) => <li key={g} class="num">{g}</li>)}</ul>}
  </div>;
}

function TicketRow({ ticket, attempts, tests, remap }: { ticket: BuiltTicket; attempts: Attempt[]; tests: NonNullable<ReturnType<typeof useData>["pack"]["tests"]>; remap: Readonly<Record<string, string>> }) {
  const values = levels.map((level) => ({ level, cell: cell(ticket.id, level, tests, attempts, remap), eligible: !ticket.maxLevel || levels.indexOf(level) <= levels.indexOf(ticket.maxLevel) }));
  const questionIds = new Set(tests.flatMap((test) => test.questions).filter((question) => (remap[question.ticket] ?? question.ticket) === ticket.id).map((question) => question.id));
  const last = attempts.flatMap((attempt) => attempt.answers).filter((answer) => questionIds.has(answer.q)).map((answer) => answer.at).sort().at(-1);
  return <div class="ready-ticket" role="row">
    <div class="ready-ticket-title" role="cell">{ticket.title}{ticket.provisional && <span class="ready-provisional">{t.readyProvisional}</span>}</div>
    {values.map(({ level, cell, eligible }) => <div class="ready-ticket-value" role="cell" key={level} aria-label={level}>
      <span class="ready-mobile-level">{level}</span><span class="num"><Value cell={eligible} value={cell.value} /></span>{eligible && cell.mastered && <span class="ready-mastered">{t.readyMastered}</span>}<Bar value={eligible ? cell.value ?? undefined : undefined} />
    </div>)}
    <div class="ready-ticket-meta" role="cell">{t.readyLast}: <time>{last ? shortDate(last) : "—"}</time></div>
  </div>;
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}
