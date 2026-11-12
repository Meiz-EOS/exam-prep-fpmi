export type Collection = "items" | "attempts" | "meta";

/** A stored document: its id plus its JSON body. */
export type Doc = { id: string } & Record<string, unknown>;

/** Merge `patch` into doc `id` (creating it if missing) and stamp `updatedAt`; mutates and returns `docs`. */
export function upsertDoc(docs: Doc[], id: string, patch: Record<string, unknown>): Doc[] {
  const i = docs.findIndex((d) => d.id === id);
  const doc = { ...(i < 0 ? {} : docs[i]), ...patch, id, updatedAt: new Date().toISOString() } as Doc;
  if (i < 0) docs.push(doc); else docs[i] = doc;
  return docs;
}

export type StoreErrorCode =
  | "read_only"     // the viewer may not write
  | "unavailable"   // no connection / store did not answer
  | "revoked"       // access withdrawn
  | "quota"         // store is full
  | "invalid"       // bad call; a bug
  | "no_store";     // this view has no store at all

export class StoreError extends Error {
  constructor(public code: StoreErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface Snapshot {
  docs: Doc[];
  /** True until the store has confirmed the data (cached or optimistic view). */
  fromCache: boolean;
}

/** Progress storage used by the UI; adapters live next to this file. */
export interface ProgressStore {
  /** Subscribe once per collection; returns unsubscribe. */
  subscribe(col: Collection, next: (snap: Snapshot) => void, error: (e: StoreError) => void): () => void;
  /** Merge fields into an existing document (creates it if absent). Writes to one doc are serialized. */
  update(col: Collection, id: string, patch: Record<string, unknown>): Promise<void>;
  /** Create a document with a generated id. */
  create(col: Collection, data: Record<string, unknown>): Promise<string>;
  remove(col: Collection, id: string): Promise<void>;
  /** true/false when known, null when the platform does not say. */
  canWrite(): Promise<boolean | null>;
}

/** Serializes async tasks per key (one write at a time per document). */
export class KeyedQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    this.tails.set(key, next);
    void next.finally(() => { if (this.tails.get(key) === next) this.tails.delete(key); }).catch(() => undefined);
    return next;
  }
}
