// What the student knows, for every screen built on the topic graph (docs/architecture/14-graph-plan.md#states):
// one subscription to `meta` and one to `attempts` per mounted module, the derived topic states, and the writes.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { markTopic, packGraph, parseTopicMarks, TOPIC_MARKS_DOC, topicStates, type TopicGraph, type TopicMark, type TopicMarks, type TopicState } from "../core/graph";
import { parsePlacementDoc, placementDocId, placementKnown, type PlacementDoc } from "../core/placement";
import type { Doc } from "../store/types";
import { useData } from "./context";
import { type Attempt, toAttempt } from "./modules/tests/run";

export interface Knowledge {
  /** Both collections have answered (or there is no store). */
  loaded: boolean;
  /** No store or no right to write: every action is disabled. */
  ro: boolean;
  meta: ReadonlyMap<string, Doc>;
  attempts: Attempt[];
  graph: TopicGraph;
  marks: TopicMarks;
  states: ReadonlyMap<string, TopicState>;
  /** The placement document of a subject, with the raw `avoid` list of the run. */
  placementOf(subject: string): (PlacementDoc & { avoid: string[] }) | null;
  /** Merge-patches a `meta` document; the screen sees the change at once. */
  patchMeta(id: string, patch: Record<string, unknown>): void;
  /** «I know it» / «I do not»: keeps a mark only while it changes the state (`markTopic`). */
  mark(topic: string, want: TopicMark["state"]): void;
  /** Writes the mark `learned` whatever the answers say (a passed mini-check, Р-88). */
  markLearned(topic: string): void;
}

export function useKnowledge(): Knowledge {
  const { pack, store, canWrite, onError } = useData();
  const [meta, setMeta] = useState<ReadonlyMap<string, Doc>>(new Map());
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  // What has arrived, per store: a store that appears later (it is null on the first render) starts from «nothing
  // loaded» in the very render it appears in — else the screens would write over a progress they have not read yet.
  const [seen, setGot] = useState<{ store: typeof store; meta: boolean; attempts: boolean }>({ store, meta: false, attempts: false });
  const got = seen.store === store ? seen : { store, meta: !store, attempts: !store };
  // One subscription per collection and store; never inside render paths that re-run (03-build.md#traps, 5).
  useEffect(() => {
    if (!store) { setGot({ store, meta: true, attempts: true }); return; }
    setGot((now) => (now.store === store ? now : { store, meta: false, attempts: false }));
    const offMeta = store.subscribe("meta", (snap) => {
      setMeta(new Map(snap.docs.map((doc) => [doc.id, doc])));
      setGot((now) => (now.meta ? now : { ...now, meta: true }));
    }, () => setGot((now) => ({ ...now, meta: true })));
    const offAttempts = store.subscribe("attempts", (snap) => {
      setAttempts(snap.docs.map(toAttempt));
      setGot((now) => (now.attempts ? now : { ...now, attempts: true }));
    }, () => setGot((now) => ({ ...now, attempts: true })));
    return () => { offMeta(); offAttempts(); };
  }, [store]);

  const graph = useMemo(() => packGraph(pack), [pack]);
  const derived = useMemo(() => {
    const placements = [...meta.values()].filter((doc) => doc.id.startsWith("placement-")).map(parsePlacementDoc);
    const known = placementKnown(pack, graph, placements);
    const marks = parseTopicMarks(meta.get(TOPIC_MARKS_DOC));
    return { known, marks, states: topicStates(pack, graph, { known, marks, attempts }) };
  }, [pack, graph, meta, attempts]);

  // The latest values for the callbacks below, so that two writes in a row do not lose each other.
  const live = useRef({ meta, derived, attempts });
  live.current = { meta, derived, attempts };
  const ro = !store || !canWrite;

  return useMemo<Knowledge>(() => {
    const patchMeta = (id: string, patch: Record<string, unknown>): void => {
      if (!store || !canWrite) return;
      const next = new Map(live.current.meta);
      next.set(id, { ...(next.get(id) ?? {}), ...patch, id });
      live.current = { ...live.current, meta: next };
      setMeta(next);
      void store.update("meta", id, patch).catch(onError);
    };
    const writeMarks = (marks: Record<string, TopicMark>): void => patchMeta(TOPIC_MARKS_DOC, { marks });
    const currentMarks = (): TopicMarks => parseTopicMarks(live.current.meta.get(TOPIC_MARKS_DOC));
    return {
      loaded: got.meta && got.attempts, ro, meta, attempts, graph, marks: derived.marks, states: derived.states,
      placementOf: (subject) => {
        const raw = meta.get(placementDocId(subject));
        const doc = parsePlacementDoc(raw);
        const avoid = (raw as { avoid?: unknown } | undefined)?.avoid;
        return doc && { ...doc, avoid: Array.isArray(avoid) ? avoid.filter((id): id is string => typeof id === "string") : [] };
      },
      patchMeta,
      mark: (topic, want) => writeMarks(markTopic(pack, graph, { known: live.current.derived.known, marks: currentMarks(), attempts: live.current.attempts }, topic, want, new Date().toISOString())),
      markLearned: (topic) => writeMarks({ ...currentMarks(), [topic]: { state: "learned", at: new Date().toISOString() } }),
    };
  }, [pack, store, canWrite, graph, meta, attempts, derived, got.meta, got.attempts, ro]);
}
