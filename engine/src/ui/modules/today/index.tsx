// «Сегодня» (docs/architecture/14-graph-plan.md#today): the plan of the day the app builds itself —
// reviews → new topic → mini-check — with one «Start» button. core/plan.ts decides, this file draws.
// A pack without any topic graph keeps the previous screen (agent's plan, deadlines, Anki summary, weakest tickets).
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TodayDoc } from "../../../content/schema";
import { hasGraph, topicLabel } from "../../../core/graph";
import { hotList } from "../../../core/hot";
import { mergeView } from "../../../core/merge";
import { chooseSubject, DAY_DOC, type DayDoc, dayPatch, dayPlan, oneMoreTopic, type PlanStep } from "../../../core/plan";
import { subjectReady } from "../../../core/ready";
import { todayPlan, weakestTickets } from "../../../core/today";
import { useData } from "../../context";
import { t } from "../../i18n";
import { type Knowledge, useKnowledge } from "../../knowledge";
import { CheckRunner } from "../graph/check";
import { DeckLine, TicketList } from "../graph/map";
import { Chips } from "../graph/parts";
import { PlacementRunner } from "../graph/placement";
import { dueClass, dueText } from "../sdachi/format";
import { ItemRow } from "../sdachi/row";
import { TicketSheet } from "../theory";
import "./today.css";

export function Today() {
  const { pack } = useData();
  const k = useKnowledge();
  return pack.subjects.some((subject) => hasGraph(k.graph, subject.id)) ? <PlanToday k={k} /> : <LegacyToday k={k} />;
}

/** Hot deadlines shown in the strip above the plan. */
const HOT_ROWS = 3;

function PlanToday({ k }: { k: Knowledge }) {
  const { pack, docs, today, loaded } = useData();
  const [view, setView] = useState<null | "placement" | "check">(null);
  const [focus, setFocus] = useState<PlanStep["id"] | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const stepsRef = useRef<HTMLOListElement>(null);

  const agent = todayPlan(k.meta.get("today"), new Date());
  const plan = useMemo(() => dayPlan({
    pack, graph: k.graph, states: k.states, day: k.meta.get(DAY_DOC), agent: agent.doc,
    placements: pack.subjects.map((subject) => k.placementOf(subject.id)), attempts: k.attempts, now: new Date(),
  }), [pack, k.graph, k.states, k.meta, k.attempts]);

  // A new day, a subject or a topic the plan has chosen are stored, so that the topic does not change during the day.
  const wanted = JSON.stringify(dayPatch(plan.day));
  useEffect(() => {
    if (k.loaded && !k.ro && plan.dirty && plan.subject !== null) k.patchMeta(DAY_DOC, dayPatch(plan.day));
  }, [k.loaded, k.ro, plan.dirty, wanted]);
  const latest = useRef(plan.day);
  latest.current = plan.day;
  const updateDay = (change: (day: DayDoc) => DayDoc): void => {
    latest.current = change(latest.current);
    k.patchMeta(DAY_DOC, dayPatch(latest.current));
  };
  const tick = (key: "anki" | "theory" | "check", on: boolean): void => updateDay((day) => {
    const { [key]: _old, ...rest } = day.done;
    return { ...day, done: on ? { ...day.done, [key]: new Date().toISOString() } : rest };
  });

  const view0 = useMemo(() => mergeView(pack, docs), [pack, docs]);
  const hot = hotList(view0.items, today);
  const subjectName = (id: string): string => pack.subjects.find((item) => item.id === id)?.name ?? id;

  const check = plan.steps.find((step): step is Extract<PlanStep, { id: "check" }> => step.id === "check");
  if (view === "placement" && plan.subject !== null) {
    return <PlacementRunner k={k} subject={plan.subject} backLabel={t.planBack} canSkip onExit={() => setView(null)} onPlan={() => setView(null)} />;
  }
  if (view === "check" && check) {
    return <CheckRunner k={k} topic={check.topic} questions={check.questions} attempt={check.attempt} backLabel={t.planBack} doneLabel={t.toPlan}
      onExit={() => setView(null)}
      onStart={(id) => updateDay((day) => ({ ...day, check: id }))}
      onFinish={() => tick("check", true)} />;
  }

  const placementPending = plan.steps.some((step) => step.id === "placement");
  const current = focus !== null && plan.steps.some((step) => step.id === focus && !step.done) ? focus : plan.next?.id ?? null;
  const started = plan.steps.some((step) => step.done) || plan.steps.some((step) => step.id === "placement" && step.asked > 0);
  const open = (step: PlanStep): void => {
    if (step.id === "placement") { setView("placement"); return; }
    if (step.id === "check" && step.questions.length > 0) { setView("check"); return; }
    setFocus(step.id);
    stepsRef.current?.querySelector(`[data-step="${step.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const learnWithoutCheck = (topic: string): void => { tick("check", true); k.markLearned(topic); };

  const title = (step: PlanStep): string => step.id === "placement" ? t.planStepPlacement
    : step.id === "anki" ? t.planStepAnki
    : step.id === "theory" ? t.planStepTopic(topicLabel(k.graph, step.topic.id))
    : t.planStepCheck;
  const sub = (step: PlanStep): ComponentChildren => {
    if (step.id === "placement") return step.asked > 0 ? t.planPlacementResume(step.asked) : t.planPlacementSub;
    if (step.id === "anki") return step.due === null ? t.planAnkiSub : t.planAnkiDue(step.due);
    if (step.id === "theory") return placementPending ? t.planTopicProvisional : t.planTopicSub(step.tickets.length);
    if (step.done) return plan.topicLearned ? t.planCheckPassed : t.planCheckFailed;
    return step.questions.length ? t.planCheckSub(step.questions.length) : t.planCheckNone;
  };
  const body = (step: PlanStep): ComponentChildren => {
    if (step.id === "placement") return <div class="plan-acts">
      <button type="button" class="primary" id="plan-placement" disabled={k.ro} onClick={() => setView("placement")}>{step.asked > 0 ? t.testResume : t.planPlacementGo}</button>
    </div>;
    if (step.id === "anki") return <>
      <p class="plan-hint">{t.planAnkiHow}</p>
      <div class="plan-acts"><button type="button" class="primary" id="plan-anki-done" disabled={k.ro} onClick={() => tick("anki", true)}>{t.planMarkDone}</button></div>
    </>;
    if (step.id === "theory") return <>
      <p class="plan-hint">{t.planTopicHow}</p>
      <TicketList tickets={step.topic.tickets} onTicket={setTicket} />
      <DeckLine deck={step.deck} />
      {!placementPending && <div class="plan-acts">
        <button type="button" class="primary" id="plan-theory-done" disabled={k.ro} onClick={() => tick("theory", true)}>{t.planMarkDone}</button>
        <button type="button" class="ghost" id="plan-know" disabled={k.ro} onClick={() => k.mark(step.topic.id, "learned")}>{t.topicMarkKnown}</button>
      </div>}
    </>;
    return <>
      <p class="plan-hint">{step.questions.length ? t.planCheckHow : t.planCheckNoneHow}</p>
      {!placementPending && <div class="plan-acts">
        {step.questions.length
          ? <button type="button" class="primary" id="plan-check" disabled={k.ro} onClick={() => setView("check")}>{step.attempt ? t.testResume : t.checkStart}</button>
          : <button type="button" class="primary" id="plan-check" disabled={k.ro} onClick={() => learnWithoutCheck(step.topic.id)}>{t.planMarkLearned}</button>}
      </div>}
    </>;
  };

  const canMore = plan.topic !== null && (plan.subjects.find((item) => item.id === plan.subject)?.open ?? 0) > 0;
  return <main class="today plan-today">
    {loaded && hot.length > 0 && <section class="today-strip" aria-label={t.todayHot}>
      {hot.slice(0, HOT_ROWS).map(({ item, due }) => <a class="today-strip-row" href="#sdachi" key={item.id}>
        <span class="today-strip-title">{item.title}<span class="today-strip-ctx"> · {subjectName(item.subject)}</span></span>
        <span class={`due ${dueClass(due)}`}>{dueText(due, t)}</span>
      </a>)}
      {hot.length > HOT_ROWS && <a class="today-strip-more" href="#sdachi">{t.planHotMore(hot.length - HOT_ROWS)}</a>}
    </section>}

    <header class="plan-head">
      <h2>{t.planTitle}</h2>
      {plan.steps.length > 0 && <span class="plan-total num">{plan.allDone ? t.planTotalDone(plan.minutes) : plan.left === plan.minutes ? t.aboutMin(plan.minutes) : t.planLeft(plan.left, plan.minutes)}</span>}
    </header>
    <Chips label={t.planSubject} options={plan.subjects} value={plan.subject} disabled={k.ro} onChange={(id) => { setFocus(null); updateDay((day) => chooseSubject(day, id)); }} />

    {!k.loaded ? <p class="today-calm">{t.todayPlanLoading}</p> : <>
      {plan.allDone ? <section class="today-card plan-done" id="plan-done">
        <h3>{t.planAllDone}</h3>
        <p>{plan.topic === null ? (plan.noTopic?.reason === "blocked" ? t.planBlocked : t.planAllTopics)
          : plan.topicLearned ? t.planDoneLearned(topicLabel(k.graph, plan.topic.id)) : t.planDoneNotLearned(topicLabel(k.graph, plan.topic.id))}</p>
        <div class="plan-acts">
          {canMore && <button type="button" class="primary" id="plan-more" disabled={k.ro} onClick={() => { setFocus(null); updateDay(oneMoreTopic); }}>{t.planOneMore}</button>}
          {plan.topic !== null && !plan.topicLearned && check && check.questions.length > 0 && <button type="button" class="ghost" id="plan-retry" disabled={k.ro} onClick={() => { updateDay((day) => { const { check: _run, ...rest } = day; const { check: _done, ...done } = day.done; return { ...rest, done }; }); setView("check"); }}>{t.planRetryCheck}</button>}
          <a class="ghost plan-link" href="#map">{t.planToMap}</a>
        </div>
      </section> : plan.next && <button type="button" class="primary big plan-go" id="plan-go" disabled={k.ro} onClick={() => open(plan.next!)}>
        <span class="plan-go-main">{started ? t.planContinue : t.planStart}</span>
        <span class="plan-go-sub">{title(plan.next)} · {t.aboutMin(plan.next.minutes)}</span>
      </button>}

      <ol class="plan-steps" ref={stepsRef}>
        {plan.steps.map((step, index) => {
          const isCurrent = step.id === current && !plan.allDone;
          const canTick = (step.id === "anki" || (step.id === "theory" && !placementPending)) && !k.ro;
          return <li class={`plan-step${step.done ? " done" : ""}${isCurrent ? " current" : ""}`} data-step={step.id} key={step.id}>
            {step.id === "anki" || step.id === "theory"
              ? <button type="button" class={`today-check${step.done ? " checked" : ""}`} role="checkbox" aria-checked={step.done ? "true" : "false"} aria-label={title(step)} disabled={!canTick}
                onClick={() => tick(step.id as "anki" | "theory", !step.done)}>{step.done ? "✓" : index + 1}</button>
              : <span class={`plan-num${step.done ? " checked" : ""}`} aria-hidden="true">{step.done ? "✓" : index + 1}</span>}
            <div class="plan-step-main">
              <button type="button" class="plan-step-head" aria-expanded={isCurrent ? "true" : "false"} disabled={step.done} onClick={() => setFocus(step.id)}>
                <span class="plan-step-title">{title(step)}</span>
                <span class="plan-step-min num">{t.aboutMin(step.minutes)}</span>
                <span class="plan-step-sub">{sub(step)}</span>
              </button>
              {isCurrent && <div class="plan-step-body">{body(step)}</div>}
            </div>
          </li>;
        })}
      </ol>

      {!plan.allDone && plan.noTopic && <p class="today-card plan-note">
        {plan.noTopic.reason === "all" ? t.planAllTopics : <>{t.planBlocked}{plan.noTopic.by.length > 0 && <> {t.planBlockedBy(plan.noTopic.by.map((topic) => `${subjectName(topic.subject)}: ${topicLabel(k.graph, topic.id)}`).join("; "))}</>}</>}
      </p>}
      {plan.day.finished.length > 0 && <p class="today-calm">{t.planFinished(plan.day.finished.map((id) => topicLabel(k.graph, id)).filter(Boolean).join("; "))}</p>}
    </>}

    {agent.doc && !agent.stale && (agent.doc.plan.length > 0 || agent.doc.note) && <details class="today-card today-agent">
      <summary><span>{t.planAgent}</span><span class="num">{agent.doc.plan.length > 0 ? `${agent.doc.plan.filter((item) => item.done).length}/${agent.doc.plan.length}` : ""}</span></summary>
      <AgentPlan k={k} doc={agent.doc} />
    </details>}
    {ticket && <TicketSheet id={ticket} attempts={k.attempts} onOpen={setTicket} onClose={() => setTicket(null)} />}
  </main>;
}

/** The agent's plan (`meta/today`, Р-19): items that can be ticked, with undo, and the note. */
function AgentPlan({ k, doc }: { k: Knowledge; doc: TodayDoc }) {
  const [undo, setUndo] = useState<{ plan: TodayDoc["plan"]; msg: string } | null>(null);
  const toggle = (index: number): void => {
    if (k.ro) return;
    setUndo({ plan: doc.plan, msg: doc.plan[index]?.text ?? "" });
    k.patchMeta("today", { plan: doc.plan.map((item, i) => (i === index ? { ...item, done: !item.done } : item)) });
  };
  const undoChange = (): void => {
    if (!undo) return;
    k.patchMeta("today", { plan: undo.plan });
    setUndo(null);
  };
  return <>
    {doc.plan.map((item, index) => <div class="today-plan-row" key={item.id}>
      <button type="button" class={`today-check${item.done ? " checked" : ""}`} role="checkbox" aria-checked={item.done ? "true" : "false"} aria-label={item.text} onClick={() => toggle(index)}>{item.done ? "✓" : ""}</button>
      <span class={item.done ? "today-done" : ""}>{item.href ? <a href={item.href}>{item.text}</a> : item.text}</span>
    </div>)}
    {doc.note && <p class="today-note">{doc.note}</p>}
    {undo && <div class="toast undo" role="status"><span>{undo.msg}</span><button type="button" onClick={undoChange}>{t.undo}</button></div>}
  </>;
}

/** The screen of a pack without a topic graph (Р-19, Р-90): agent's plan, deadlines, Anki summary, weakest tickets. */
function LegacyToday({ k }: { k: Knowledge }) {
  const { pack, docs, today, loaded } = useData();
  const parsed = todayPlan(k.meta.get("today"), new Date());
  const view = useMemo(() => mergeView(pack, docs), [pack, docs]);
  const hot = hotList(view.items, today);
  const readySubjects = pack.subjects.filter((subject) => pack.tickets?.some((ticket) => ticket.subject === subject.id));
  const weak = weakestTickets(readySubjects.map((subject) => subjectReady(subject.id, pack, k.attempts, new Date(), pack.remap)));
  const titleOf = (id: string) => pack.tickets?.find((entry) => entry.id === id)?.title ?? pack.exam?.find((entry) => entry.id === id)?.title ?? id;

  return <main class="today">
    {parsed.doc && <section class={`today-card today-plan${parsed.stale ? " stale" : ""}`}>
      <h2>{t.todayPlan}</h2>
      {parsed.stale && <p class="today-stale">{t.todayPlanDate(`${parsed.doc.date.slice(8)}.${parsed.doc.date.slice(5, 7)}`)}</p>}
      <AgentPlan k={k} doc={parsed.doc} />
    </section>}
    {!k.loaded && <p class="today-calm">{t.todayPlanLoading}</p>}

    <section class="today-section" aria-labelledby="today-hot-title">
      <h2 id="today-hot-title">{t.todayHot}</h2>
      {!loaded ? <p class="today-calm">…</p> : hot.length === 0 ? <p class="today-calm">{t.todayNoHot}</p> : <div class="today-list">{hot.map(({ item }) => <ItemRow key={item.id} item={item} context={`${pack.subjects.find((s) => s.id === item.subject)?.name ?? item.subject} · ${item.group || item.kind}`} />)}</div>}
    </section>

    {parsed.doc?.anki && <section class="today-card today-anki">
      <h2>{t.todayAnki}</h2><p class="today-count">{t.todayDue(parsed.doc.anki.due)}</p>
      {parsed.doc.anki.weak.length > 0 && <ul>{parsed.doc.anki.weak.map((item) => <li key={item.ticket}><a href={pack.tests?.length ? "#tests" : "#theory"}>{titleOf(item.ticket)}</a><span>{item.lapses}</span></li>)}</ul>}
    </section>}

    <section class="today-section">
      <h2>{t.todayWeak}</h2>
      {weak.length === 0 ? <p class="today-calm">{t.todayWeakNone}</p> : <ul class="today-weak">{weak.map((item) => {
        return <li key={`${item.ticket}:${item.level}`}><a href={pack.tests?.length ? "#tests" : "#theory"}>{titleOf(item.ticket)}</a><span class="num">{item.level} · {Math.round(item.value * 100)}%</span></li>;
      })}</ul>}
    </section>
  </main>;
}
