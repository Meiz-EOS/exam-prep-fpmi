import { useEffect, useMemo, useState } from "preact/hooks";
import { hotList } from "../../../core/hot";
import { mergeView } from "../../../core/merge";
import { subjectReady, type Attempt } from "../../../core/ready";
import { todayPlan, weakestTickets } from "../../../core/today";
import type { Doc } from "../../../store/types";
import { useData } from "../../context";
import { t } from "../../i18n";
import { ItemRow } from "../sdachi/row";
import "./today.css";

const asAttempt = (doc: Doc): Attempt => ({ test: String(doc.test ?? ""), startedAt: String(doc.startedAt ?? ""), answers: Array.isArray(doc.answers) ? doc.answers as Attempt["answers"] : [] });

export function Today() {
  const { pack, store, docs, today, loaded, canWrite, onError } = useData();
  const [meta, setMeta] = useState<Doc | null>(null);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [undo, setUndo] = useState<{ plan: NonNullable<ReturnType<typeof todayPlan>["doc"]>["plan"]; msg: string } | null>(null);
  useEffect(() => {
    if (!store) { setMetaLoaded(true); return; }
    return store.subscribe("meta", (snap) => {
      setMeta(snap.docs.find((doc) => doc.id === "today") ?? null);
      setMetaLoaded(true);
    }, () => setMetaLoaded(true));
  }, [store]);
  useEffect(() => store?.subscribe("attempts", (snap) => setAttempts(snap.docs.map(asAttempt)), () => {}), [store]);

  const parsed = todayPlan(meta, new Date());
  const view = useMemo(() => mergeView(pack, docs), [pack, docs]);
  const hot = hotList(view.items, today);
  const readySubjects = pack.subjects.filter((subject) => pack.tickets?.some((ticket) => ticket.subject === subject.id));
  const weak = weakestTickets(readySubjects.map((subject) => subjectReady(subject.id, pack, attempts, new Date(), pack.remap)));
  const titleOf = (id: string) => pack.tickets?.find((entry) => entry.id === id)?.title ?? pack.exam?.find((entry) => entry.id === id)?.title ?? id;
  const toggle = (index: number) => {
    if (!store || !canWrite || !parsed.doc) return;
    const previous = parsed.doc.plan;
    const plan = previous.map((item, i) => i === index ? { ...item, done: !item.done } : item);
    setMeta((current) => current ? { ...current, plan } : current);
    setUndo({ plan: previous, msg: parsed.doc.plan[index]?.text ?? "" });
    void store.update("meta", "today", { plan }).catch(onError);
  };
  const undoChange = () => {
    if (!store || !parsed.doc || !undo) return;
    setMeta((current) => current ? { ...current, plan: undo.plan } : current);
    void store.update("meta", "today", { plan: undo.plan }).catch(onError);
    setUndo(null);
  };

  return <main class="today">
    {parsed.doc && <section class={`today-card today-plan${parsed.stale ? " stale" : ""}`}>
      <h2>{t.todayPlan}</h2>
      {parsed.stale && <p class="today-stale">{t.todayPlanDate(`${parsed.doc.date.slice(8)}.${parsed.doc.date.slice(5, 7)}`)}</p>}
      {parsed.doc.plan.map((item, index) => <div class="today-plan-row" key={item.id}>
        <button type="button" class={`today-check${item.done ? " checked" : ""}`} role="checkbox" aria-checked={item.done ? "true" : "false"} aria-label={item.text} onClick={() => toggle(index)}>{item.done ? "✓" : ""}</button>
        <span class={item.done ? "today-done" : ""}>{item.href ? <a href={item.href}>{item.text}</a> : item.text}</span>
      </div>)}
      {parsed.doc.note && <p class="today-note">{parsed.doc.note}</p>}
    </section>}
    {!metaLoaded && <p class="today-calm">{t.todayPlanLoading}</p>}

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
    {undo && <div class="toast undo" role="status"><span>{undo.msg}</span><button type="button" onClick={undoChange}>{t.undo}</button></div>}
  </main>;
}
