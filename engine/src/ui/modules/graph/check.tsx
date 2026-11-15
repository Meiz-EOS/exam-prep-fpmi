// The mini-check of a topic (docs/architecture/14-graph-plan.md#today, step 3): about three short questions,
// self-graded like any test (Р-17); the answers go to `attempts` as `check-<topic>`; passing marks the topic learned.
import { useRef, useState } from "preact/hooks";
import type { Question } from "../../../content/schema";
import { topicLabel, type Topic } from "../../../core/graph";
import { CHECK_PASS, checkAttemptTest, checkResult } from "../../../core/plan";
import { useData } from "../../context";
import { t } from "../../i18n";
import type { Knowledge } from "../../knowledge";
import { QuestionCard } from "../tests";
import { type Answer, appendAnswer, nextIndex, startRun } from "../tests/run";

export function CheckRunner({ k, topic, questions, attempt, backLabel, doneLabel, onExit, onStart, onFinish }: {
  k: Knowledge;
  topic: Topic;
  /** The questions of this run (`checkQuestions`); fixed for the life of the screen. */
  questions: readonly Question[];
  /** Id of today's unfinished run to continue. */
  attempt?: string;
  backLabel: string;
  /** Text of the button on the result card. */
  doneLabel: string;
  onExit: () => void;
  /** The `attempts` document of the run exists. */
  onStart?: (attempt: string) => void;
  onFinish?: (passed: boolean) => void;
}) {
  const { store, onError } = useData();
  const [asked] = useState(() => [...questions]);
  const [answers, setAnswers] = useState<Answer[]>(() => (attempt !== undefined ? k.attempts.find((item) => item.id === attempt)?.answers ?? [] : []));
  const id = useRef<Promise<string> | null>(attempt !== undefined ? Promise.resolve(attempt) : null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const index = nextIndex(asked, answers);
  const q = asked[index];

  const save = (a: Answer): void => {
    const prior = answers;
    const next = [...prior, a];
    setAnswers(next);
    if (!id.current) {
      id.current = startRun(store!, checkAttemptTest(topic.id));
      id.current.then((created) => onStart?.(created), () => undefined);
    }
    const p = chain.current.then(async () => { await appendAnswer(store!, await id.current!, prior, a, asked.length); });
    chain.current = p.then(() => undefined, () => undefined);
    p.catch(onError);
    if (nextIndex(asked, next) >= asked.length) {
      const passed = checkResult(next)?.passed ?? false;
      // the day's tick first: the plan keeps a learned topic as the topic of the day only when its check is ticked
      onFinish?.(passed);
      if (passed) k.markLearned(topic.id);
    }
  };

  const result = checkResult(answers);
  return <div class="tests run check">
    <div class="runbar">
      <button type="button" class="ghost" onClick={onExit}>{backLabel}</button>
      <span class="meta num">{t.checkTitle(topicLabel(k.graph, topic.id))}</span>
    </div>
    {q ? <QuestionCard key={q.id} q={q} n={index + 1} total={asked.length} last={index === asked.length - 1} onNext={save} />
      : <div class="qcard gresult">
        <h3>{result?.passed ? t.checkPassed : t.checkFailed}</h3>
        <p class="gresult-count"><span class="num gbig">{Math.round((result?.value ?? 0) * 100)}%</span> {t.checkAvg(Math.round(CHECK_PASS * 100))}</p>
        <p class="ghint">{result?.passed ? t.checkPassedHint : t.checkFailedHint}</p>
        <button type="button" class="primary big" id="check-exit" onClick={onExit}>{doneLabel}</button>
      </div>}
  </div>;
}
