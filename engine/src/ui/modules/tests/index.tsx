import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BuiltExamTicket, BuiltPack, BuiltTest, Question } from "../../../content/schema";
import { useData } from "../../context";
import { t } from "../../i18n";
import { Math as Tex } from "../../math";
import { l2TopicParents } from "../../../content/coverage";
import { examCode } from "../theory";
import { type Answer, type Attempt, appendAnswer, attemptsOf, minutesBetween, nextIndex, selfScore, startRun, testQuestions, toAttempt } from "./run";
import "./tests.css";

interface Run {
  test: BuiltTest;
  startedAt: string;
  /** Resolves to the attempt document id (create is async; the first question shows at once). */
  id: Promise<string>;
  answers: Answer[];
}

export function Tests() {
  const { pack, store, canWrite, onError } = useData();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  // Kept here, not in the list: the list unmounts during a run and the group must stay open after it.
  const [openTickets, setOpenTickets] = useState<string[]>([]);
  const [openTopics, setOpenTopics] = useState<string[]>([]);
  const ro = !store || !canWrite;

  // One subscription per store; never inside render paths that re-run (03-build.md#traps, 5).
  useEffect(() => {
    if (!store) return;
    return store.subscribe("attempts", (snap) => setAttempts(snap.docs.map(toAttempt)), () => {});
  }, [store]);

  const start = (test: BuiltTest, open?: Attempt) => {
    if (!store) return;
    if (open) { setRun({ test, startedAt: open.startedAt, id: Promise.resolve(open.id), answers: open.answers }); return; }
    const now = new Date();
    const id = startRun(store, test.id, now);
    id.catch(onError);
    setRun({ test, startedAt: now.toISOString(), id, answers: [] });
  };

  if (run) return <RunView key={run.test.id + run.startedAt} run={run} onExit={() => setRun(null)} />;

  const tests = pack.tests ?? [];
  const subjects = pack.subjects.filter((s) => tests.some((x) => x.subject === s.id));
  return (
    <div class="tests">
      {tests.length === 0 && <p class="calm">{t.testsEmpty}</p>}
      {subjects.map((s) => {
        const { plain, byTicket, byTopic } = splitTests(pack, s.id);
        const open = openTickets.includes(s.id);
        const topicsOpen = openTopics.includes(s.id);
        return (
          <section class="subject" key={s.id}>
            <h3>{s.name}</h3>
            {plain.length > 0 && (
              <div class="list">
                {plain.map((test) => <TestRow key={test.id} test={test} attempts={attempts} disabled={ro} onStart={start} />)}
              </div>
            )}
            {byTicket.length > 0 && (
              <details class="list bytickets" open={open}
                onToggle={(e) => {
                  const now = (e.currentTarget as HTMLDetailsElement).open;
                  if (now !== open) setOpenTickets(now ? [...openTickets, s.id] : openTickets.filter((x) => x !== s.id));
                }}>
                <summary><span>{t.testsByTicket(new Set(byTicket.map((x) => x.test.exam)).size)}</span><span class="gchev" aria-hidden="true">›</span></summary>
                {byTicket.map(({ test, exam, part }) => (
                  <TestRow key={test.id} test={test} exam={exam} l2Part={part} attempts={attempts} disabled={ro} onStart={start} />
                ))}
              </details>
            )}
            {byTopic.length > 0 && (
              <details class="list bytopics" open={topicsOpen}
                onToggle={(e) => {
                  const now = (e.currentTarget as HTMLDetailsElement).open;
                  if (now !== topicsOpen) setOpenTopics(now ? [...openTopics, s.id] : openTopics.filter((x) => x !== s.id));
                }}>
                <summary><span>{t.testsByTopic(byTopic.length)}</span><span class="gchev" aria-hidden="true">›</span></summary>
                {byTopic.map(({ test, part }) => <TestRow key={test.id} test={test} l2Part={part} attempts={attempts} disabled={ro} onStart={start} />)}
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}

const kindOrder: Record<string, number> = { entry: 0, retest: 1, mock: 2 };

/** Р-26: entry, retests and mocks first (stable within a kind); ticket tests in `exam/<subject>.yaml` order, unknown exam ids last. */
export function splitTests(pack: BuiltPack, subject: string): { plain: BuiltTest[]; byTicket: { test: BuiltTest; exam?: BuiltExamTicket; part?: [number, number] }[]; byTopic: { test: BuiltTest; part?: [number, number] }[] } {
  const own = (pack.tests ?? []).filter((x) => x.subject === subject);
  const plain = own.filter((x) => x.kind !== "ticket" && x.kind !== "topic").sort((a, b) => (kindOrder[a.kind] ?? 3) - (kindOrder[b.kind] ?? 3));
  const exam = (pack.exam ?? []).filter((x) => x.subject === subject);
  const rank = (test: BuiltTest) => { const i = exam.findIndex((x) => x.id === test.exam); return i < 0 ? exam.length : i; };
  // Р-44: L2 parts follow the L0/L1 test for their exam ticket, ordered by id.
  const ticketTests = own.filter((x) => x.kind === "ticket");
  const orderedExams = [...new Set(ticketTests.map((x) => x.exam))].sort((a, b) => {
    const ai = exam.findIndex((x) => x.id === a); const bi = exam.findIndex((x) => x.id === b);
    return (ai < 0 ? exam.length : ai) - (bi < 0 ? exam.length : bi);
  });
  const byTicket = orderedExams.flatMap((examId) => {
    const ordinary = ticketTests.filter((x) => x.exam === examId && x.level !== "L2");
    const l2 = ticketTests.filter((x) => x.exam === examId && x.level === "L2").sort((a, b) => a.id.localeCompare(b.id));
    const e = exam.find((x) => x.id === examId);
    return [...ordinary, ...l2].map((test) => {
      const isPart = test.level === "L2" && l2.length > 1;
      return { test, ...(e ? { exam: e } : {}), ...(isPart ? { part: [l2.indexOf(test) + 1, l2.length] as [number, number] } : {}) };
    });
  });
  const tickets = (pack.tickets ?? []).filter((x) => x.subject === subject);
  const topicRank = (test: BuiltTest) => {
    const covered = test.covers?.[0];
    const i = tickets.findIndex((x) => x.id === covered);
    return i < 0 ? tickets.length : i;
  };
  // Р-52: L2 topic tests (and their parts) follow their parent topic test, ordered by id.
  const topics = own.filter((x) => x.kind === "topic");
  const l2Topics = topics.filter((x) => x.level === "L2").sort((a, b) => a.id.localeCompare(b.id));
  const parentOf = new Map(l2Topics.map((x) => [x.id, l2TopicParents(x, topics)[0]?.id]));
  const byTopic = topics.filter((x) => x.level !== "L2" || parentOf.get(x.id) === undefined).sort((a, b) => topicRank(a) - topicRank(b)).flatMap((test) => {
    if (test.level === "L2") return [{ test }];
    const l2 = l2Topics.filter((x) => parentOf.get(x.id) === test.id);
    return [{ test }, ...l2.map((x, i) => ({ test: x, ...(l2.length > 1 ? { part: [i + 1, l2.length] as [number, number] } : {}) }))];
  });
  return { plain, byTicket, byTopic };
}

function TestRow({ test, exam, l2Part, attempts, disabled, onStart }: {
  test: BuiltTest; exam?: BuiltExamTicket; l2Part?: [number, number]; attempts: Attempt[]; disabled: boolean; onStart: (t: BuiltTest, open?: Attempt) => void;
}) {
  const { pack } = useData();
  const total = testQuestions(pack, test).length;
  const { latest, open } = attemptsOf(attempts, test.id);
  const shown = latest ? Math.min(latest.answers.length, total) : 0;
  const action = open ? t.testResume : latest ? t.testAgain : t.testStart;
  return (
    <button type="button" class="trow" disabled={disabled || total === 0} onClick={() => onStart(test, open)}>
      <span class="ttxt">
        {exam ? (
          <span class="ttitle">
            <span class="tcode">{examCode(exam)}</span> {exam.title}{" "}
            <span class="tconf" title={t.readyConfidence[exam.confidence]} aria-label={t.readyConfidence[exam.confidence]}>{t.testConfidenceMark[exam.confidence]}</span>
          </span>
        ) : <span class="ttitle">{test.title}</span>}
        <span class="meta">{[...(exam ? [] : [t.testKind[test.kind] ?? test.kind]), ...(test.level === "L2" ? [<span class="l2badge">{t.testLevelL2}</span>, ...(l2Part ? [t.testPart(l2Part[0], l2Part[1])] : [])] : []), t.testMin(test.minutes), t.testQuestions(total)].map((item, i) => <span key={i}>{i > 0 && " · "}{item}</span>)}</span>
      </span>
      <span class="tstate num">{latest ? t.testProgress(shown, total) : ""}</span>
      <span class="tact">{action}</span>
      <span class="gchev" aria-hidden="true">›</span>
    </button>
  );
}

function RunView({ run, onExit }: { run: Run; onExit: () => void }) {
  const { pack, store, onError } = useData();
  const questions = useMemo(() => testQuestions(pack, run.test), [pack, run.test]);
  const [answers, setAnswers] = useState<Answer[]>(run.answers);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const h = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(h);
  }, []);
  const idx = nextIndex(questions, answers);
  const q = questions[idx];
  const elapsed = t.testMinutes(minutesBetween(run.startedAt, now), run.test.minutes);

  const chain = useRef<Promise<void>>(Promise.resolve());
  const save = (a: Answer) => {
    const prior = answers;
    setAnswers([...prior, a]); // shown at once, before the store answers
    // Writes are chained so answers reach the document in order.
    const p = chain.current.then(async () => appendAnswer(store!, await run.id, prior, a, questions.length));
    chain.current = p.then(() => undefined, () => undefined);
    p.catch(onError);
  };

  return (
    <div class="tests run">
      <div class="runbar">
        <button type="button" class="ghost" onClick={onExit}>{t.testsBack}</button>
        <span class="meta num">{run.test.title}</span>
        <span class="meta num timer" title={elapsed}>{elapsed}</span>
      </div>
      {q ? (
        <QuestionCard key={q.id} q={q} n={idx + 1} total={questions.length} last={idx === questions.length - 1} onNext={save} />
      ) : (
        <Done answers={answers} onExit={onExit} />
      )}
    </div>
  );
}

function QuestionCard({ q, n, total, last, onNext }: {
  q: Question; n: number; total: number; last: boolean; onNext: (a: Answer) => void;
}) {
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  const [hits, setHits] = useState<number[]>([]);
  const [gross, setGross] = useState(false);
  const score = selfScore(hits.length, q.points.length, gross);
  const toggle = (i: number) => setHits(hits.includes(i) ? hits.filter((x) => x !== i) : [...hits, i].sort((a, b) => a - b));
  const next = () => onNext({
    q: q.id, text, hits, ...(gross ? { gross: true as const } : {}), self: score, at: new Date().toISOString(),
  });
  return (
    <article class="qcard">
      <div class="meta num">{t.testQuestionOf(n, total)}</div>
      <div class="qbody"><Tex text={q.body} /></div>
      <label class="alabel">{t.testAnswerLabel}
        <textarea id="answer" class="answer" value={text} readOnly={shown} placeholder={t.testAnswerPlaceholder}
          onInput={(e) => setText(e.currentTarget.value)} />
      </label>
      {/* The slot keeps its height: the button is replaced by the reference in place, nothing below jumps. */}
      {!shown ? (
        <button type="button" class="primary big" id="show-ref" onClick={() => setShown(true)}>{t.testShowRef}</button>
      ) : (
        <div class="ref">
          <h4>{t.testRefTitle}</h4>
          {q.points.map((p, i) => (
            <label class="point" key={i}>
              <input type="checkbox" class="pt" checked={hits.includes(i)} onChange={() => toggle(i)} />
              <span><Tex text={p} /></span>
            </label>
          ))}
          <label class="point gross">
            <input type="checkbox" id="gross" checked={gross} onChange={(e) => setGross(e.currentTarget.checked)} />
            <span>{t.testGross}</span>
          </label>
          <div class="score num" id="score">{gross ? t.testScoreGross : t.testScore(Math.round(score * 100))}</div>
          <button type="button" class="primary big" id="next" onClick={next}>{last ? t.testFinish : t.testNext}</button>
        </div>
      )}
    </article>
  );
}

function Done({ answers, onExit }: { answers: Answer[]; onExit: () => void }) {
  const avg = answers.length ? Math.round((answers.reduce((s, a) => s + a.self, 0) / answers.length) * 100) : 0;
  return (
    <div class="qcard done">
      <h3>{t.testDoneTitle}</h3>
      <p>{t.testDoneAvg(avg)}</p>
      <button type="button" class="primary big" onClick={onExit}>{t.testToList}</button>
    </div>
  );
}
