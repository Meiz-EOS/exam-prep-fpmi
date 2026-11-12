import { type Collection, type Doc, KeyedQueue, type ProgressStore, type Snapshot, StoreError, type StoreErrorCode } from "./types";

// Minimal shapes of the claude.ai runtime used here (see the platform's db.d.ts / user.d.ts).
interface DbErr { code: string; message?: string }
interface DocSnap { id: string; data(): Record<string, unknown> | undefined }
interface QuerySnap { docs: DocSnap[]; metadata: { fromCache: boolean } }
interface DocRef {
  get(): Promise<{ exists: boolean }>;
  set(d: Record<string, unknown>): Promise<void>;
  update(d: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
interface ColRef {
  doc(id?: string): DocRef & { id: string };
  onSnapshot(next: (s: QuerySnap) => void, err: (e: DbErr) => void): () => void;
}
export interface ClaudeDb { collection(path: string): ColRef }
interface ClaudeUser { can(cap: string): Promise<boolean | null> }
interface ClaudeRuntime { use(name: string): Promise<unknown> }

declare global {
  interface Window { claude?: ClaudeRuntime }
}

function mapCode(code: string): StoreErrorCode {
  switch (code) {
    case "invalid_argument": return "read_only"; // a well-formed write rejected = no write access
    case "quota_exceeded": return "quota";
    case "revoked": return "revoked";
    case "not_granted":
    case "capability_disabled":
    case "capability_removed": return "no_store";
    default: return "unavailable";
  }
}
const wrap = (e: unknown) => {
  const err = e as DbErr;
  return new StoreError(mapCode(err?.code ?? ""), err?.message);
};

/** Progress store on the claude.ai artifact database. */
export class ClaudeDbStore implements ProgressStore {
  private queue = new KeyedQueue();
  constructor(private db: ClaudeDb, private user: ClaudeUser | null) {}

  /** Resolves the platform namespaces; null when this view has no database. */
  static async connect(runtime: ClaudeRuntime | undefined = typeof window !== "undefined" ? window.claude : undefined): Promise<ClaudeDbStore | null> {
    if (!runtime?.use) return null;
    const db = (await runtime.use("db")) as ClaudeDb | null;
    if (!db) return null;
    const user = (await runtime.use("user")) as ClaudeUser | null;
    return new ClaudeDbStore(db, user);
  }

  subscribe(c: Collection, next: (s: Snapshot) => void, error: (e: StoreError) => void): () => void {
    return this.db.collection(c).onSnapshot(
      (snap) => next({
        docs: snap.docs.map((d) => ({ ...(d.data() ?? {}), id: d.id }) as Doc),
        fromCache: snap.metadata.fromCache,
      }),
      (e) => error(wrap(e)),
    );
  }

  update(c: Collection, id: string, patch: Record<string, unknown>): Promise<void> {
    const body = { ...patch, updatedAt: new Date().toISOString() };
    return this.queue.run(`${c}/${id}`, async () => {
      const ref = this.db.collection(c).doc(id);
      try {
        // update() requires an existing doc; items from the pack may have none yet.
        const snap = await ref.get();
        await (snap.exists ? ref.update(body) : ref.set(body));
      } catch (e) {
        throw wrap(e);
      }
    });
  }

  async create(c: Collection, data: Record<string, unknown>): Promise<string> {
    const ref = this.db.collection(c).doc();
    try {
      await ref.set({ ...data, updatedAt: new Date().toISOString() });
    } catch (e) {
      throw wrap(e);
    }
    return ref.id;
  }

  remove(c: Collection, id: string): Promise<void> {
    return this.queue.run(`${c}/${id}`, async () => {
      try {
        await this.db.collection(c).doc(id).delete();
      } catch (e) {
        throw wrap(e);
      }
    });
  }

  async canWrite(): Promise<boolean | null> {
    try {
      return this.user ? await this.user.can("data.write") : null;
    } catch {
      return null;
    }
  }
}
