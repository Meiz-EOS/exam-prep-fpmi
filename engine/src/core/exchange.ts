// Progress exchange file zachetka-progress/1 and its merge (docs/architecture/11-apk.md#merge, 07-standalone.md#exchange).
// Imports carry `.ts` so plain node (tools/serve/server.ts) can load this module.
import { z } from "zod";
import type { Collection, Doc } from "../store/types.ts";

export const EXCHANGE_FORMAT = "zachetka-progress/1";
export const EXCHANGE_COLLECTIONS = ["items", "attempts", "meta"] as const satisfies readonly Collection[];
/** Same rule as the PC server's document ids (07-standalone.md#data-dir). */
export const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type Collections = Record<Collection, Doc[]>;

export interface ExchangeFile {
  format: typeof EXCHANGE_FORMAT;
  pack: string;
  exportedAt: string;
  collections: Collections;
}

export interface ImportStats {
  added: number;
  updated: number;
  kept: number;
}

export interface ImportPlan extends ImportStats {
  writes: { col: Collection; doc: Doc }[];
}

/** A store that can export and import the exchange file (11-apk.md#capability). */
export interface ExchangeCapable {
  exportFile(): Promise<ExchangeFile>;
  importFile(file: ExchangeFile): Promise<ImportStats>;
}

export function isExchangeCapable(store: unknown): store is ExchangeCapable {
  const s = store as Partial<ExchangeCapable> | null;
  return !!s && typeof s.exportFile === "function" && typeof s.importFile === "function";
}

export type ExchangeErrorCode = "not_exchange" | "format" | "other_pack" | "bad_doc";

export class ExchangeError extends Error {
  code: ExchangeErrorCode; // no parameter property: plain node strips types only
  constructor(code: ExchangeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const DocSchema = z.looseObject({
  id: z.string().regex(DOC_ID),
  // Optional: documents written before W5 (agent, claude.ai) have no stamp; if present it must parse.
  updatedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))).optional(),
});

const FileSchema = z.object({
  format: z.string(),
  pack: z.string(),
  exportedAt: z.string(),
  collections: z.object({
    items: z.array(z.unknown()).default([]),
    attempts: z.array(z.unknown()).default([]),
    meta: z.array(z.unknown()).default([]),
  }),
});

export function buildExchange(pack: string, collections: Partial<Collections>, now = new Date()): ExchangeFile {
  const out = { items: [], attempts: [], meta: [] } as Collections;
  for (const col of EXCHANGE_COLLECTIONS) {
    out[col] = (collections[col] ?? []).map((d) => ({ ...d })).sort((a, b) => a.id.localeCompare(b.id));
  }
  return { format: EXCHANGE_FORMAT, pack, exportedAt: now.toISOString(), collections: out };
}

/** Validates an exchange file for this pack; throws ExchangeError and applies nothing on any problem. */
export function parseExchange(value: unknown, pack: string): ExchangeFile {
  const file = FileSchema.safeParse(value);
  if (!file.success) throw new ExchangeError("not_exchange", "not a Zachetka progress file");
  if (file.data.format !== EXCHANGE_FORMAT) throw new ExchangeError("format", `unsupported format ${file.data.format}`);
  if (file.data.pack !== pack) throw new ExchangeError("other_pack", `file is for pack ${file.data.pack}, not ${pack}`);
  const collections = { items: [], attempts: [], meta: [] } as Collections;
  for (const col of EXCHANGE_COLLECTIONS) {
    const seen = new Set<string>();
    for (const raw of file.data.collections[col]) {
      const doc = DocSchema.safeParse(raw);
      if (!doc.success) throw new ExchangeError("bad_doc", `bad document in ${col}`);
      if (seen.has(doc.data.id)) throw new ExchangeError("bad_doc", `duplicate id ${doc.data.id} in ${col}`);
      seen.add(doc.data.id);
      collections[col].push(doc.data as Doc);
    }
  }
  return { format: EXCHANGE_FORMAT, pack, exportedAt: file.data.exportedAt, collections };
}

function time(doc: Doc | undefined): number {
  const t = typeof doc?.updatedAt === "string" ? Date.parse(doc.updatedAt) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function newer(theirs: number, ours: number): boolean {
  return Number.isFinite(theirs) && (!Number.isFinite(ours) || theirs > ours);
}

/**
 * Per document: absent locally → add; newer updatedAt in the file → replace; otherwise keep ours.
 * A missing or unparsable stamp is older than any real one; when neither side has one, ours stays.
 * Nothing is ever deleted.
 */
export function planImport(local: Partial<Collections>, incoming: ExchangeFile): ImportPlan {
  const plan: ImportPlan = { writes: [], added: 0, updated: 0, kept: 0 };
  for (const col of EXCHANGE_COLLECTIONS) {
    const mine = new Map((local[col] ?? []).map((d) => [d.id, d]));
    for (const doc of incoming.collections[col]) {
      const own = mine.get(doc.id);
      if (!own) {
        plan.writes.push({ col, doc: { ...doc } });
        plan.added++;
      } else if (newer(time(doc), time(own))) {
        plan.writes.push({ col, doc: { ...doc } });
        plan.updated++;
      } else {
        plan.kept++;
      }
    }
  }
  return plan;
}

/** Applies a plan to plain collections (memory-backed stores and tests). */
export function applyPlan(local: Partial<Collections>, plan: ImportPlan): Collections {
  const out = { items: [], attempts: [], meta: [] } as Collections;
  for (const col of EXCHANGE_COLLECTIONS) {
    const map = new Map((local[col] ?? []).map((d) => [d.id, { ...d }]));
    for (const w of plan.writes) if (w.col === col) map.set(w.doc.id, { ...w.doc });
    out[col] = [...map.values()];
  }
  return out;
}
