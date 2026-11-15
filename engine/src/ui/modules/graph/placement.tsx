// The entry test by the graph (docs/architecture/14-graph-plan.md#placement-screen): intro → questions one by one → result.
// The state machine is core/placement.ts; this screen shows the question, grades it (Р-17) and saves after every answer.
import { useMemo, useRef, useState } from "preact/hooks";
import { nextTopics, subjectTopicCounts, topicLabel } from "../../../core/graph";
import { answerPlacement, nextPlacementQuestion, placementAttemptTest, placementDoc, placementDocId, placementMinutes, placementPlan, resumePlacement, startPlacement, stopPlacement, type PlacementPlan, type PlacementState } from "../../../core/placement";
import { useData } from "../../context";
import { t } from "../../i18n";
import type { Knowledge } from "../../knowledge";
import { QuestionCard } from "../tests";
import { type Answer, startRun } from "../tests/run";
import { StateBadge } from "./parts";

interface Run {
  plan: PlacementPlan;
  state: PlacementState;
  startedAt: string;
  /** Id of the `attempts` document with the answer texts; created with the first answer. */
  attempt: Promise<string> | null;
  answers: Answer[];
  avoid: string[];
  /** Answers given since this screen opened the run. */
  added: number;
}

export function PlacementRunner({ k, subject, backLabel, onExit, onPlan, canSkip }: {
  k: Knowledge;
  subject: string;
  /** Text of the «back» button in the top bar. */
  backLabel: string;
  onExit: () => void;
  /** «To the plan of the day» on the result screen. */
  onPlan: () => void;
  /** Offer «skip the test» on the intro (the daily plan does). */
  canSkip?: boolean;
}) {
  const { pack, store, onError } = useData();
  const [run, setRun] = useState<Run | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const name = pack.subjects.find((item) => item.id === subject)?.name ?? subject;
  const stored = k.placementOf(subject);
  const base = useMemo(() => placementPlan(pack, k.graph, subject), [pack, k.graph, subject]);
  const limit = Math.min(base.maxQuestions, base.pool.size);

  /** Writes the run to `meta/placement-<subject>` and its answers to `attempts`, in order. */
  const save = (next: Run): void => {
    const now = new Date().toISOString();
    const over = nextPlacementQuestion(next.plan, next.state) === null;
    const p = chain.current.then(async () => {
      const attempt = await next.attempt!;
      k.patchMeta(placementDocId(subject), { ...placementDoc(next.plan, next.state, { startedAt: next.startedAt, now, attempt }), ...(over ? {} : { finishedAt: null }), avoid: next.avoid });
      await store!.update("attempts", attempt, { answers: next.answers, finishedAt: over ? now : null });
    });
    chain.current = p.then(() => undefined, () => undefined);
    p.catch(onError);
  };

  const begin = (): void => {
    if (!store) return;
    // a retake avoids the questions of the previous run (Р-85)
    const avoid = stored ? [...new Set([...stored.avoid, ...stored.asked.map((answer) => answer.q)])] : [];
    const plan = placementPlan(pack, k.graph, subject, { avoid });
    // nothing is written until the first answer: leaving at once keeps the previous result
    setRun({ plan, state: startPlacement(plan), startedAt: new Date().toISOString(), attempt: null, answers: [], avoid, added: 0 });
  };

  /** Continues the saved run: an unfinished one, or one the student interrupted. */
  const resume = (): void => {
    if (!store || !stored) return;
    const plan = placementPlan(pack, k.graph, subject, { avoid: stored.avoid });
    const answers = k.attempts.find((attempt) => attempt.id === stored.attempt)?.answers ?? [];
    setRun({ plan, state: resumePlacement(plan, stored.asked), startedAt: stored.startedAt, attempt: stored.attempt !== undefined ? Promise.resolve(stored.attempt) : null, answers, avoid: stored.avoid, added: 0 });
  };

  const skip = (): void => {
    const now = new Date().toISOString();
    k.patchMeta(placementDocId(subject), { ...placementDoc(base, stopPlacement(startPlacement(base)), { startedAt: now, now }), avoid: [] });
  };

  const current = run && nextPlacementQuestion(run.plan, run.state);
  const bar = <div class="runbar">
    <button type="button" class="ghost" onClick={onExit}>{backLabel}</button>
    <span class="meta num">{t.placementTitle(name)}</span>
  </div>;

  if (run && current) {
    const answer = (a: Answer): void => {
      const attempt = run.attempt ?? startRun(store!, placementAttemptTest(subject), new Date(run.startedAt));
      attempt.catch(() => undefined);
      const next: Run = { ...run, attempt, state: answerPlacement(run.plan, run.state, { topic: current.topic.id, q: a.q, score: a.self, at: a.at }), answers: [...run.answers, a], added: run.added + 1 };
      setRun(next);
      save(next);
    };
    const stop = (): void => {
      // nothing new answered: the saved state (no test, or the previous result) stays as it is
      if (run.added === 0 && (!stored || stored.finishedAt !== undefined)) { setRun(null); return; }
      const next: Run = { ...run, state: stopPlacement(run.state) };
      setRun(next);
      save(next);
    };
    const n = run.state.asked.length + 1;
    const max = Math.min(run.plan.maxQuestions, Math.max(n, run.plan.pool.size));
    return <div class="tests run placement">
      {bar}
      <div class="gprogress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={n - 1}><span style={{ width: `${Math.round(((n - 1) / max) * 100)}%` }} /></div>
      <QuestionCard key={current.question.id} q={current.question} n={n} total={max} last={false}
        label={t.placementQuestionOf(n, max)} note={t.placementTopic(topicLabel(k.graph, current.topic.id))} onNext={answer} />
      <button type="button" class="ghost big" id="placement-stop" onClick={stop}>{t.placementStop}</button>
      <p class="ghint">{t.placementStopHint}</p>
    </div>;
  }

  const unfinished = stored !== null && stored.finishedAt === undefined && nextPlacementQuestion(base, resumePlacement(base, stored.asked)) !== null;
  if (!stored || unfinished) {
    return <div class="tests run placement">
      {bar}
      <div class="qcard gintro">
        <h3>{t.placementTitle(name)}</h3>
        <p>{t.placementIntro(limit, placementMinutes(base))}</p>
        <p class="ghint">{t.placementIntroHow}</p>
        {unfinished
          ? <button type="button" class="primary big" id="placement-start" disabled={k.ro} onClick={resume}>{t.placementResume(stored!.asked.length)}</button>
          : <button type="button" class="primary big" id="placement-start" disabled={k.ro || base.pool.size === 0} onClick={begin}>{t.testStart}</button>}
        {canSkip && !stored && <button type="button" class="ghost big" id="placement-skip" disabled={k.ro} onClick={skip}>{t.placementSkip}</button>}
      </div>
    </div>;
  }

  // Result: recomputed from the saved answers on the current graph, with the marks the student set by hand.
  const result = resumePlacement(base, stored.asked);
  const counts = subjectTopicCounts(k.graph, k.states, subject);
  const first = nextTopics(k.graph, k.states, subject)[0];
  const canContinue = stored.asked.length > 0 && nextPlacementQuestion(base, result) !== null;
  return <div class="tests run placement">
    {bar}
    <div class="qcard gresult">
      <h3>{stored.asked.length ? t.placementDone : t.placementSkipped}</h3>
      <p class="gresult-count"><span class="num gbig">{result.known.length}</span> {t.placementKnownOf(result.known.length, base.topics.length)}</p>
      <p class="ghint">{t.placementAsked(stored.asked.length, stored.asked.filter((answer) => answer.ok).length)}</p>
      <p class="gstart">{first ? <>{t.placementStartFrom} <strong>{topicLabel(k.graph, first.id)}</strong></> : counts.locked ? t.planBlocked : t.planAllTopics}</p>
      <button type="button" class="primary big" id="placement-plan" onClick={onPlan}>{t.toPlan}</button>
      {canContinue && <button type="button" class="ghost big" id="placement-continue" disabled={k.ro} onClick={resume}>{t.placementContinue(Math.min(base.maxQuestions - stored.asked.length, limit))}</button>}
      <button type="button" class="ghost big" id="placement-again" disabled={k.ro} onClick={begin}>{stored.asked.length ? t.placementAgain : t.placementTake}</button>
    </div>
    <section class="gtopics" aria-label={t.placementTopics}>
      <h4>{t.placementTopics}</h4>
      <p class="ghint">{t.placementFixHint}</p>
      <ul class="glist">
        {base.topics.map((topic) => {
          const state = k.states.get(topic.id) ?? "locked";
          const done = state === "known" || state === "learned";
          const asked = stored.asked.some((answer) => answer.topic === topic.id);
          return <li class={`grow grow-${state}`} key={topic.id}>
            <span class="grow-txt"><span class="grow-title">{topicLabel(k.graph, topic.id)}</span>
              <span class="grow-meta"><StateBadge state={state} />{asked && <span> · {t.placementWasAsked}</span>}</span></span>
            <button type="button" class="ghost gfix" disabled={k.ro} onClick={() => k.mark(topic.id, done ? "unknown" : "learned")}>{done ? t.topicMarkUnknown : t.topicMarkKnown}</button>
          </li>;
        })}
      </ul>
    </section>
  </div>;
}
