import { type Collection, type Doc, KeyedQueue, type ProgressStore, type Snapshot, StoreError } from "./types";

/** In-memory store for tests and `npm run dev`. */
export class MemoryStore implements ProgressStore {
  private data = new Map<Collection, Map<string, Doc>>();
  private subs = new Map<Collection, Set<(s: Snapshot) => void>>();
  private queue = new KeyedQueue();
  private seq = 0;

  constructor(initial: Partial<Record<Collection, Doc[]>> = {}, private writable = true) {
    for (const [col, docs] of Object.entries(initial) as [Collection, Doc[]][]) {
      this.data.set(col, new Map(docs.map((d) => [d.id, { ...d }])));
    }
  }

  private col(c: Collection): Map<string, Doc> {
    let m = this.data.get(c);
    if (!m) this.data.set(c, (m = new Map()));
    return m;
  }

  private emit(c: Collection): void {
    const snap: Snapshot = { docs: [...this.col(c).values()].map((d) => ({ ...d })), fromCache: false };
    for (const fn of this.subs.get(c) ?? []) fn(snap);
  }

  subscribe(c: Collection, next: (s: Snapshot) => void, _error?: (e: StoreError) => void): () => void {
    let set = this.subs.get(c);
    if (!set) this.subs.set(c, (set = new Set()));
    set.add(next);
    queueMicrotask(() => this.emit(c));
    return () => set!.delete(next);
  }

  private guard(): void {
    if (!this.writable) throw new StoreError("read_only");
  }

  update(c: Collection, id: string, patch: Record<string, unknown>): Promise<void> {
    return this.queue.run(`${c}/${id}`, async () => {
      this.guard();
      const prev = this.col(c).get(id) ?? { id };
      this.col(c).set(id, { ...prev, ...patch, id, updatedAt: new Date().toISOString() });
      this.emit(c);
    });
  }

  async create(c: Collection, data: Record<string, unknown>): Promise<string> {
    this.guard();
    const id = `m${++this.seq}`;
    this.col(c).set(id, { ...data, id, updatedAt: new Date().toISOString() });
    this.emit(c);
    return id;
  }

  remove(c: Collection, id: string): Promise<void> {
    return this.queue.run(`${c}/${id}`, async () => {
      this.guard();
      this.col(c).delete(id);
      this.emit(c);
    });
  }

  async canWrite(): Promise<boolean> {
    return this.writable;
  }
}
