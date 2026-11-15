// The topic map of a subject (route #map): every topic in the canonical order with its state, what it requires,
// its tickets, and the actions — theory, mini-check, «I know it» / «I do not».
import { useMemo, useState } from "preact/hooks";
import { hasGraph, subjectTopicCounts, subjectTopics, topicDeck, topicEvidence, topicLabel, topicMinutes, topicNumber, topicQuestions, type Topic } from "../../../core/graph";
import { nextPlacementQuestion, placementMinutes, placementPlan, resumePlacement } from "../../../core/placement";
import { checkQuestions, dayFor, DAY_DOC, parseDayDoc, planSubject } from "../../../core/plan";
import { moscowDate } from "../../../core/today";
import { useData } from "../../context";
import { t } from "../../i18n";
import { type Knowledge, useKnowledge } from "../../knowledge";
import { loadPref, savePref } from "../../prefs";
import { TicketSheet } from "../theory";
import { CheckRunner } from "./check";
import { Chips, StateBadge } from "./parts";
import { PlacementRunner } from "./placement";

export function TopicMap() {
  const { pack } = useData();
  const k = useKnowledge();
  const subjects = pack.subjects.filter((subject) => hasGraph(k.graph, subject.id));
  const [picked, setPicked] = useState<string | null>(() => loadPref<string | null>("map.subject", null));
  const [placement, setPlacement] = useState(false);
  const [check, setCheck] = useState<Topic | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  // by default — the subject of the daily plan
  const fallback = planSubject(pack, k.graph, k.states, dayFor(parseDayDoc(k.meta.get(DAY_DOC)), moscowDate(new Date())));
  const subject = picked !== null && subjects.some((item) => item.id === picked) ? picked : fallback;
  const plan = useMemo(() => (subject === null ? null : placementPlan(pack, k.graph, subject)), [pack, k.graph, subject]);
  const questions = useMemo(() => (check ? checkQuestions(pack, k.graph, check.id, k.attempts) : []), [check]);

  if (subject === null || plan === null) return <main class="gmap"><p class="calm">{t.mapEmpty}</p></main>;
  if (placement) return <PlacementRunner k={k} subject={subject} backLabel={t.mapBack} onExit={() => setPlacement(false)} onPlan={() => { location.hash = "#today"; }} />;
  if (check) return <CheckRunner k={k} topic={check} questions={questions} backLabel={t.mapBack} doneLabel={t.mapToMap} onExit={() => setCheck(null)} />;

  const topics = subjectTopics(k.graph, subject);
  const counts = subjectTopicCounts(k.graph, k.states, subject);
  const done = counts.known + counts.learned;
  const doc = k.placementOf(subject);
  const unfinished = doc !== null && doc.finishedAt === undefined && nextPlacementQuestion(plan, resumePlacement(plan, doc.asked)) !== null;
  const firstOpen = topics.find((topic) => k.states.get(topic.id) === "open");
  return <main class="gmap">
    <Chips label={t.planSubject} options={subjects} value={subject} onChange={(id) => { setPicked(id); savePref("map.subject", id); }} />
    <section class="gcard gsummary">
      <div class="gsummary-line"><span class="num gbig">{done}/{counts.total}</span><span>{t.mapDone}</span></div>
      <div class="gmeter" aria-hidden="true">
        <i class="gm-known" style={{ flexGrow: counts.known }} /><i class="gm-learned" style={{ flexGrow: counts.learned }} />
        <i class="gm-open" style={{ flexGrow: counts.open }} /><i class="gm-locked" style={{ flexGrow: counts.locked }} />
      </div>
      <div class="glegend">
        <span><StateBadge state="known" /> {counts.known}</span><span><StateBadge state="learned" /> {counts.learned}</span>
        <span><StateBadge state="open" /> {counts.open}</span><span><StateBadge state="locked" /> {counts.locked}</span>
      </div>
      {plan.pool.size > 0 && <button type="button" class="ghost big" id="map-placement" onClick={() => setPlacement(true)}>
        {!doc ? t.mapPlacementTake(placementMinutes(plan)) : unfinished ? t.mapPlacementResume : t.mapPlacementResult}
      </button>}
    </section>
    <ol class="glist gtopiclist">
      {topics.map((topic) => <TopicRow key={topic.id} topic={topic} k={k} current={topic.id === firstOpen?.id} open={open.includes(topic.id)}
        onToggle={(now) => setOpen(now ? [...open.filter((id) => id !== topic.id), topic.id] : open.filter((id) => id !== topic.id))}
        onTicket={setTicket} onCheck={() => setCheck(topic)} />)}
    </ol>
    {ticket && <TicketSheet id={ticket} attempts={k.attempts} onOpen={setTicket} onClose={() => setTicket(null)} />}
  </main>;
}

function TopicRow({ topic, k, current, open, onToggle, onTicket, onCheck }: {
  topic: Topic; k: Knowledge; current: boolean; open: boolean; onToggle: (open: boolean) => void; onTicket: (id: string) => void; onCheck: () => void;
}) {
  const { pack } = useData();
  const state = k.states.get(topic.id) ?? "locked";
  const done = state === "known" || state === "learned";
  const number = String(topicNumber(k.graph, topic.id)).padStart(2, "0");
  const requires = topic.requires.map((id) => k.graph.byId.get(id)).filter((item): item is Topic => item !== undefined);
  const requireText = (other: Topic): string => other.subject === topic.subject
    ? topicLabel(k.graph, other.id)
    : `${pack.subjects.find((item) => item.id === other.subject)?.name ?? other.subject}: ${topicLabel(k.graph, other.id)}`;
  return <li class={`gtopic gtopic-${state}${current ? " gtopic-current" : ""}`}>
    <details open={open} onToggle={(e) => { const now = (e.currentTarget as HTMLDetailsElement).open; if (now !== open) onToggle(now); }}>
      <summary>
        <span class="gnum num">{number}</span>
        <span class="grow-txt">
          <span class="grow-title">{topic.title}</span>
          <span class="grow-meta"><StateBadge state={state} /><span> · {t.mapTickets(topic.tickets.length)} · {t.aboutMin(topicMinutes(topic))}</span>{current && <span class="gnext"> · {t.mapNext}</span>}</span>
          {requires.length > 0 && <span class="grow-req">{t.mapRequires} {requires.map((other, i) => <span key={other.id} class={`greq greq-${k.states.get(other.id) ?? "locked"}`}>{i > 0 && ", "}{requireText(other)}</span>)}</span>}
        </span>
        <span class="gchev" aria-hidden="true">›</span>
      </summary>
      {open && <TopicBody topic={topic} k={k} done={done} locked={state === "locked"} onTicket={onTicket} onCheck={onCheck} />}
    </details>
  </li>;
}

function TopicBody({ topic, k, done, locked, onTicket, onCheck }: { topic: Topic; k: Knowledge; done: boolean; locked: boolean; onTicket: (id: string) => void; onCheck: () => void }) {
  const { pack } = useData();
  const evidence = topicEvidence(pack, k.graph, topic.id, k.attempts);
  const hasQuestions = topicQuestions(pack, k.graph, topic.id).length > 0;
  return <div class="gbody">
    <TicketList tickets={topic.tickets} onTicket={onTicket} />
    <DeckLine deck={topicDeck(pack, k.graph, topic.id)} />
    {evidence.total > 0 && <p class="ghint">{t.mapEvidence(evidence.answered, evidence.total, evidence.value === null ? null : Math.round(evidence.value * 100))}</p>}
    {locked && <p class="ghint">{t.mapLockedHint}</p>}
    <div class="gacts">
      {hasQuestions && <button type="button" class="primary" disabled={k.ro} onClick={onCheck}>{t.checkStart}</button>}
      <button type="button" class="ghost" disabled={k.ro} onClick={() => k.mark(topic.id, done ? "unknown" : "learned")}>{done ? t.topicMarkUnknown : t.topicMarkKnown}</button>
    </div>
  </div>;
}

/** Tickets of a topic; a tap opens the theory of the ticket in the bottom sheet. */
export function TicketList({ tickets, onTicket }: { tickets: readonly string[]; onTicket: (id: string) => void }) {
  const { pack } = useData();
  return <ul class="gtickets">
    {tickets.map((id) => {
      const ticket = pack.tickets?.find((item) => item.id === id);
      const theory = (pack.theory ?? []).some((entry) => entry.ticket === id);
      return <li key={id}><button type="button" class="gticket" onClick={() => onTicket(id)}>
        <span class="gticket-title">{ticket?.title ?? id}</span>
        <span class="gticket-meta">{theory ? t.mapTheory : ticket?.src ?? t.theoryMissing}</span>
        <span class="gchev" aria-hidden="true">›</span>
      </button></li>;
    })}
  </ul>;
}

/** The Anki subdeck of a topic (Р-87), with a button that copies its name. */
export function DeckLine({ deck }: { deck: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(deck).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined);
  };
  return <p class="gdeck">
    <span class="gdeck-label">{t.planDeck}</span>
    <code class="gdeck-name">{deck}</code>
    {typeof navigator !== "undefined" && navigator.clipboard && <button type="button" class="ghost gdeck-copy" onClick={copy}>{copied ? t.copied : t.copy}</button>}
  </p>;
}
