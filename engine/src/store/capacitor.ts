// Progress store of the APK (docs/architecture/11-apk.md#adapter): one JSON file per collection in app storage.
// Platform-free: the file system comes in as a `Disk`, so tests run without Capacitor (capacitor-disk.ts binds it).
import {
  buildExchange, EXCHANGE_COLLECTIONS, type ExchangeCapable, type ExchangeFile, type ImportStats, planImport,
} from "../core/exchange";
import { type Collection, type Doc, KeyedQueue, type ProgressStore, type Snapshot, StoreError, upsertDoc } from "./types";

/** Minimal file access, paths relative to the app's data directory. */
export interface Disk {
  /** File text, or null when there is no such file. */
  read(path: string): Promise<string | null>;
  /** Writes the whole file, creating parent folders. */
  write(path: string, text: string): Promise<void>;
  /** Moves a file; may fail when `to` exists. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** File names in a folder; empty when it does not exist. */
  list(dir: string): Promise<string[]>;
}

export const BACKUPS_KEPT = 3;

type Sub = { next: (s: Snapshot) => void; error: (e: StoreError) => void };

function fail(e: unknown): StoreError {
  return e instanceof StoreError ? e : new StoreError("unavailable", e instanceof Error ? e.message : String(e));
}

export class CapacitorStore implements ProgressStore, ExchangeCapable {
  private docs = new Map<Collection, Doc[]>();
  private loading = new Map<Collection, Promise<void>>();
  private subs = new Map<Collection, Set<Sub>>();
  private queue = new KeyedQueue();
  private root: string;

  constructor(private disk: Disk, private pack: string) {
    this.root = `zachetka/${pack}`;
  }

  private file(col: Collection): string {
    return `${this.root}/${col}.json`;
  }

  /** Reads a collection once; a leftover temp file (crash between delete and rename) is used if the main one is gone. */
  private load(col: Collection): Promise<void> {
    let p = this.loading.get(col);
    if (!p) {
      p = (async () => {
        const text = (await this.disk.read(this.file(col))) ?? (await this.disk.read(`${this.file(col)}.tmp`));
        let value: unknown = [];
        if (text !== null) {
          try {
            value = JSON.parse(text);
          } catch {
            throw new StoreError("invalid", `${col}.json is not JSON`);
          }
        }
        if (!Array.isArray(value) || value.some((d) => !d || typeof d !== "object" || typeof (d as Doc).id !== "string")) {
          throw new StoreError("invalid", `${col}.json is not a collection`);
        }
        this.docs.set(col, value as Doc[]);
      })();
      p.catch(() => this.loading.delete(col)); // allow a retry
      this.loading.set(col, p);
    }
    return p;
  }

  private emit(col: Collection): void {
    const snap: Snapshot = { docs: (this.docs.get(col) ?? []).map((d) => ({ ...d })), fromCache: false };
    for (const sub of this.subs.get(col) ?? []) sub.next(snap);
  }

  /** Writes the collection as it is when the write runs; writes to one collection go one at a time. */
  private persist(col: Collection): Promise<void> {
    return this.queue.run(col, async () => {
      const path = this.file(col);
      const text = `${JSON.stringify(this.docs.get(col) ?? [])}\n`;
      try {
        await this.disk.write(`${path}.tmp`, text);
        try {
          await this.disk.rename(`${path}.tmp`, path);
        } catch {
          await this.disk.remove(path).catch(() => undefined);
          await this.disk.rename(`${path}.tmp`, path);
        }
      } catch (e) {
        throw fail(e);
      }
    });
  }

  private async change(col: Collection, edit: (docs: Doc[]) => Doc[]): Promise<void> {
    try {
      await this.load(col);
    } catch (e) {
      throw fail(e);
    }
    this.docs.set(col, edit((this.docs.get(col) ?? []).map((d) => ({ ...d }))));
    this.emit(col);
    await this.persist(col);
  }

  subscribe(col: Collection, next: (s: Snapshot) => void, error: (e: StoreError) => void): () => void {
    let set = this.subs.get(col);
    if (!set) this.subs.set(col, (set = new Set()));
    const sub: Sub = { next, error };
    set.add(sub);
    this.load(col).then(
      () => { if (set!.has(sub)) sub.next({ docs: (this.docs.get(col) ?? []).map((d) => ({ ...d })), fromCache: false }); },
      (e: unknown) => { if (set!.has(sub)) sub.error(fail(e)); },
    );
    return () => { set!.delete(sub); };
  }

  update(col: Collection, id: string, patch: Record<string, unknown>): Promise<void> {
    return this.change(col, (docs) => upsertDoc(docs, id, patch));
  }

  async create(col: Collection, data: Record<string, unknown>): Promise<string> {
    // Same shape as the PC server's ids: unique across devices, valid for the exchange file.
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
    await this.change(col, (docs) => [...docs, { ...data, id, updatedAt: new Date().toISOString() }]);
    return id;
  }

  remove(col: Collection, id: string): Promise<void> {
    return this.change(col, (docs) => docs.filter((d) => d.id !== id));
  }

  async canWrite(): Promise<boolean> {
    return true;
  }

  async exportFile(): Promise<ExchangeFile> {
    try {
      await Promise.all(EXCHANGE_COLLECTIONS.map((c) => this.load(c)));
    } catch (e) {
      throw fail(e);
    }
    return buildExchange(this.pack, Object.fromEntries(EXCHANGE_COLLECTIONS.map((c) => [c, this.docs.get(c) ?? []])));
  }

  /** Backs up the current state (last BACKUPS_KEPT kept), then merges the file in. */
  async importFile(file: ExchangeFile): Promise<ImportStats> {
    const current = await this.exportFile();
    const dir = `${this.root}/backup`;
    const stamp = current.exportedAt.replace(/[:.]/g, "-");
    try {
      await this.disk.write(`${dir}/before-import-${stamp}.json`, `${JSON.stringify(current)}\n`);
      const old = (await this.disk.list(dir)).filter((n) => n.startsWith("before-import-")).sort().slice(0, -BACKUPS_KEPT);
      for (const name of old) await this.disk.remove(`${dir}/${name}`).catch(() => undefined);
    } catch (e) {
      throw fail(e);
    }
    const plan = planImport(current.collections, file);
    for (const col of EXCHANGE_COLLECTIONS) {
      const writes = plan.writes.filter((w) => w.col === col);
      if (!writes.length) continue;
      await this.change(col, (docs) => {
        const byId = new Map(docs.map((d) => [d.id, d]));
        for (const w of writes) byId.set(w.doc.id, { ...w.doc });
        return [...byId.values()];
      });
    }
    return { added: plan.added, updated: plan.updated, kept: plan.kept };
  }
}
