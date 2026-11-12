import type { BuiltPack } from "../content/schema.ts";
import { dayNumber, type ISODate } from "./dates.ts";
import { isStatus, type Status } from "./status.ts";

/** A progress document as stored (id + loose JSON; anything may be missing or wrong). */
export type ProgressDoc = { id: string } & Record<string, unknown>;

export interface Override { soft?: ISODate; hard?: ISODate; title?: string }

export interface ViewItem {
  id: string;
  /** Subject id from the pack; for custom items with an unknown subject, the raw value. */
  subject: string;
  group: string;
  kind: string;
  title: string;
  soft?: ISODate;
  hard?: ISODate;
  /** Note from the pack (author's). */
  packNote?: string;
  star?: boolean;
  status: Status;
  score?: number | string;
  /** Note written by the student. */
  note?: string;
  /** Fields changed on the phone, still to be folded into the pack (Р-4). */
  override?: Override;
  source: "pack" | "custom" | "orphan";
  updatedAt?: string;
}

export interface ViewExam { id: string; subject: string; title: string; date: ISODate; score?: number | string }

export interface View { items: ViewItem[]; exams: ViewExam[]; orphans: ViewItem[] }

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const date = (v: unknown): ISODate | undefined => (typeof v === "string" && dayNumber(v) !== null ? v : undefined);
const score = (v: unknown): number | string | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : str(v);

function readOverride(v: unknown): Override | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: Override = {};
  const soft = date(o.soft), hard = date(o.hard), title = str(o.title);
  if (soft) out.soft = soft;
  if (hard) out.hard = hard;
  if (title) out.title = title;
  return Object.keys(out).length ? out : undefined;
}

function progressFields(doc: ProgressDoc | undefined, packNote?: string) {
  const note = str(doc?.note);
  return {
    status: isStatus(doc?.status) ? doc.status : ("не начато" as Status),
    score: score(doc?.score),
    // A v0 document may still carry the author's note; do not show it as the student's own.
    note: note !== undefined && note !== packNote ? note : undefined,
    override: readOverride(doc?.override),
    updatedAt: str(doc?.updatedAt),
  };
}

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * Pack + progress → what the page shows. Catalog fields come from the pack,
 * then the student's override; progress fields come from the database.
 */
export function mergeView(pack: BuiltPack, docs: readonly ProgressDoc[]): View {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const known = new Set<string>();
  const subjectByName = new Map(pack.subjects.map((s) => [s.name, s.id]));
  const subjectIds = new Set(pack.subjects.map((s) => s.id));

  const items: ViewItem[] = pack.items.map((it) => {
    known.add(it.id);
    const p = progressFields(byId.get(it.id), it.note);
    return compact({
      id: it.id, subject: it.subject, group: it.group, kind: it.kind,
      title: p.override?.title ?? it.title,
      soft: p.override?.soft ?? it.soft,
      hard: p.override?.hard ?? it.hard,
      packNote: it.note, star: it.star,
      ...p, source: "pack" as const,
    });
  });

  const exams: ViewExam[] = pack.exams.map((ex) => {
    known.add(ex.id);
    return compact({ id: ex.id, subject: ex.subject, title: ex.title, date: ex.date, score: score(byId.get(ex.id)?.score) });
  });

  const orphans: ViewItem[] = [];
  for (const doc of docs) {
    if (known.has(doc.id)) continue;
    const title = str(doc.title);
    // Explicit custom items, and v0 items added through its form (they carry their own title).
    if (doc.custom === true || title) {
      const raw = str(doc.subject) ?? "";
      const subject = subjectIds.has(raw) ? raw : subjectByName.get(raw) ?? raw;
      const p = progressFields(doc);
      items.push(compact({
        id: doc.id, subject, group: str(doc.group) ?? "", kind: str(doc.kind) ?? "",
        title: title ?? doc.id, soft: p.override?.soft ?? date(doc.soft), hard: p.override?.hard ?? date(doc.hard),
        ...p, source: "custom" as const,
      }));
    } else {
      orphans.push(compact({ id: doc.id, subject: "", group: "", kind: "", title: doc.id, ...progressFields(doc), source: "orphan" as const }));
    }
  }
  return { items, exams, orphans };
}
