import { EXCHANGE_FORMAT, type ExchangeCapable, type ExchangeFile, type ImportStats } from "../core/exchange";
import { type Collection, type Doc, KeyedQueue, type ProgressStore, type Snapshot, StoreError, upsertDoc } from "./types";

type Sub = { next: (s: Snapshot) => void; error: (e: StoreError) => void };

/** Reload period while the tab is visible (07-standalone.md#api). */
export const RELOAD_MS = 30_000;

/** Progress store backed by the local server (tools/serve/server.ts), same origin. */
export class HttpStore implements ProgressStore, ExchangeCapable {
  private queue = new KeyedQueue();
  private docs = new Map<Collection, Doc[]>();
  private subs = new Map<Collection, Set<Sub>>();
  private stops = new Map<Collection, () => void>();
  /** Bumped on every local write; a reload that started before a write is stale. */
  private gen = new Map<Collection, number>();

  constructor(private base = "") {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.base + path, init);
    } catch (e) {
      throw new StoreError("unavailable", e instanceof Error ? e.message : undefined);
    }
    if (res.status === 400 || res.status === 404 || res.status === 413 || res.status === 415) {
      throw new StoreError("invalid", `HTTP ${res.status}`);
    }
    if (!res.ok) throw new StoreError("unavailable", `HTTP ${res.status}`);
    return res;
  }

  private emit(col: Collection, fromCache: boolean, only?: Sub): void {
    const snap: Snapshot = { docs: (this.docs.get(col) ?? []).map((d) => ({ ...d })), fromCache };
    for (const sub of only ? [only] : this.subs.get(col) ?? []) sub.next(snap);
  }

  private async load(col: Collection): Promise<void> {
    const started = this.gen.get(col) ?? 0;
    try {
      const value: unknown = await (await this.request(`/api/${col}`)).json().catch(() => {
        throw new StoreError("invalid", "bad JSON");
      });
      if (!Array.isArray(value) || value.some((d) => !d || typeof d !== "object" || typeof (d as Doc).id !== "string")) {
        throw new StoreError("invalid", "bad collection");
      }
      // A local write happened meanwhile: this answer may predate it; the next reload catches up.
      if ((this.gen.get(col) ?? 0) !== started) return;
      this.docs.set(col, value as Doc[]);
      this.emit(col, false);
    } catch (e) {
      const err = e instanceof StoreError ? e : new StoreError("unavailable");
      for (const sub of this.subs.get(col) ?? []) sub.error(err);
    }
  }

  subscribe(col: Collection, next: (s: Snapshot) => void, error: (e: StoreError) => void): () => void {
    let set = this.subs.get(col);
    if (!set) this.subs.set(col, (set = new Set()));
    const sub: Sub = { next, error };
    set.add(sub);
    if (set.size === 1) {
      const reload = () => { if (document.visibilityState !== "hidden") void this.load(col); };
      window.addEventListener("focus", reload);
      document.addEventListener("visibilitychange", reload);
      const timer = setInterval(reload, RELOAD_MS);
      this.stops.set(col, () => {
        window.removeEventListener("focus", reload);
        document.removeEventListener("visibilitychange", reload);
        clearInterval(timer);
      });
      void this.load(col);
    } else if (this.docs.has(col)) {
      queueMicrotask(() => this.emit(col, false, sub));
    }
    const own = set;
    return () => {
      own.delete(sub);
      if (own.size === 0) {
        this.stops.get(col)?.();
        this.stops.delete(col);
        this.subs.delete(col);
      }
    };
  }

  /** Applies a change locally at once (the UI must not wait for the disk). */
  private local(col: Collection, change: (docs: Doc[]) => Doc[]): void {
    this.gen.set(col, (this.gen.get(col) ?? 0) + 1);
    this.docs.set(col, change((this.docs.get(col) ?? []).map((d) => ({ ...d }))));
    this.emit(col, true);
  }

  private send(method: string, path: string, body?: unknown): Promise<Response> {
    return this.request(path, body === undefined ? { method } : {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  }

  update(col: Collection, id: string, patch: Record<string, unknown>): Promise<void> {
    this.local(col, (docs) => upsertDoc(docs, id, patch));
    return this.queue.run(`${col}/${id}`, async () => {
      await this.send("PATCH", `/api/${col}/${encodeURIComponent(id)}`, patch);
    });
  }

  async create(col: Collection, data: Record<string, unknown>): Promise<string> {
    const value: unknown = await (await this.send("POST", `/api/${col}`, data)).json().catch(() => null);
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id !== "string") throw new StoreError("invalid", "bad create response");
    this.local(col, (docs) => [...docs, { ...data, id, updatedAt: new Date().toISOString() }]);
    return id;
  }

  remove(col: Collection, id: string): Promise<void> {
    this.local(col, (docs) => docs.filter((d) => d.id !== id));
    return this.queue.run(`${col}/${id}`, async () => {
      await this.send("DELETE", `/api/${col}/${encodeURIComponent(id)}`);
    });
  }

  /** Exchange file built by the server from disk (11-apk.md#capability). */
  async exportFile(): Promise<ExchangeFile> {
    const value: unknown = await (await this.request("/api/export")).json().catch(() => null);
    if ((value as ExchangeFile | null)?.format !== EXCHANGE_FORMAT) throw new StoreError("invalid", "bad export");
    return value as ExchangeFile;
  }

  /** The server merges and writes; then every subscribed collection reloads. */
  async importFile(file: ExchangeFile): Promise<ImportStats> {
    const res = await this.send("POST", "/api/import", file);
    const stats = (await res.json().catch(() => null)) as ImportStats | null;
    if (!stats || typeof stats.added !== "number") throw new StoreError("invalid", "bad import response");
    await Promise.all([...this.subs.keys()].map((col) => this.load(col)));
    return stats;
  }

  async canWrite(): Promise<boolean> {
    return true;
  }
}
