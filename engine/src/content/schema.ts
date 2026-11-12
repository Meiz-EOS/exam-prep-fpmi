import { z } from "zod";

import { KINDS } from "../core/kinds.ts";

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/);
const kindSchema = z.enum(KINDS);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}, "Invalid calendar date");

const ratioSchema = z.number().min(0).max(1);
const levelSchema = z.enum(["L0", "L1", "L2"]);

const ThresholdsSchema = z.object({
  ud: z.object({ L0: ratioSchema, L1: ratioSchema }).strict(),
  hor: z.object({ L0: ratioSchema, L1: ratioSchema, L2: ratioSchema, keyL2: z.boolean() }).strict(),
}).strict();

export const PackSchema = z.object({
  id: idSchema,
  title: z.string(),
  subjects: z.array(z.object({ id: idSchema, name: z.string() }).strict()),
  exams: z.array(z.object({ id: idSchema, subject: idSchema, title: z.string(), date: dateSchema }).strict()),
  thresholds: ThresholdsSchema.optional(),
}).strict();

export const TicketsFileSchema = z.object({
  provisional: z.boolean().optional(),
  tickets: z.array(z.object({
    id: idSchema,
    title: z.string(),
    src: z.string().optional(),
    key: z.boolean().optional(),
    maxLevel: levelSchema.optional(),
  }).strict()),
}).strict();

export const ExamTicketsFileSchema = z.object({ tickets: z.array(z.object({
  id: idSchema, title: z.string(), confidence: z.enum(["sure", "likely", "ours", "doubtful"]),
  includes: z.array(idSchema),
}).strict()) }).strict();

export const RemapFileSchema = z.record(idSchema, idSchema);

const TEST_KINDS = ["entry", "retest", "mock", "ticket", "topic"] as const;

/** `exam` (exam ticket id) is required for `kind: ticket` and forbidden otherwise (Р-23). */
const examFieldRule = (meta: { kind: string; exam?: string }, ctx: z.RefinementCtx): void => {
  if (meta.kind === "ticket" && meta.exam === undefined) ctx.addIssue({ code: "custom", path: ["exam"], message: "kind ticket requires exam" });
  if (meta.kind !== "ticket" && meta.exam !== undefined) ctx.addIssue({ code: "custom", path: ["exam"], message: `exam is only allowed with kind ticket, not ${meta.kind}` });
};

const coversFieldRule = (meta: { kind: string; covers?: string[] }, ctx: z.RefinementCtx): void => {
  if (meta.kind === "topic" && meta.covers === undefined) ctx.addIssue({ code: "custom", path: ["covers"], message: "kind topic requires covers" });
  if (meta.kind !== "topic" && meta.covers !== undefined) ctx.addIssue({ code: "custom", path: ["covers"], message: `covers is only allowed with kind topic, not ${meta.kind}` });
};
const testMetaRules = (meta: { kind: string; exam?: string; covers?: string[] }, ctx: z.RefinementCtx): void => {
  examFieldRule(meta, ctx);
  coversFieldRule(meta, ctx);
};
const testLevelRule = (meta: { kind: string; level?: string }, ctx: z.RefinementCtx): void => {
  // Р-44, Р-51: L2 tests exist for exam tickets and for topics.
  if (meta.level !== undefined && meta.kind !== "ticket" && meta.kind !== "topic") ctx.addIssue({ code: "custom", path: ["level"], message: "level is only allowed with kind ticket or topic" });
};

export const TestMetaSchema = z.object({
  id: idSchema,
  title: z.string(),
  kind: z.enum(TEST_KINDS),
  exam: idSchema.optional(),
  covers: z.array(idSchema).optional(),
  level: z.literal("L2").optional(),
  minutes: z.number().int().positive(),
  reuse: z.array(idSchema).default([]),
}).strict().superRefine((meta, ctx) => { testMetaRules(meta, ctx); testLevelRule(meta, ctx); });

export const QuestionSchema = z.object({
  id: idSchema,
  ticket: idSchema,
  level: levelSchema,
  body: z.string().min(1),
  points: z.array(z.string().min(1)).min(2).max(6),
}).strict();

export const ItemsFileSchema = z.array(z.object({
  group: z.string(),
  kind: kindSchema.optional(),
  items: z.array(z.object({
    id: idSchema,
    title: z.string(),
    kind: kindSchema.optional(),
    soft: dateSchema.optional(),
    hard: dateSchema.optional(),
    note: z.string().optional(),
    star: z.boolean().optional(),
  }).strict()),
}).strict());

const ItemSchema = z.object({
  id: idSchema,
  subject: idSchema,
  group: z.string(),
  kind: kindSchema,
  title: z.string(),
  soft: dateSchema.optional(),
  hard: dateSchema.optional(),
  note: z.string().optional(),
  star: z.boolean().optional(),
}).strict();

const BuiltTicketSchema = z.object({
  id: idSchema,
  subject: idSchema,
  title: z.string(),
  src: z.string().optional(),
  key: z.boolean().optional(),
  maxLevel: levelSchema.optional(),
  provisional: z.boolean().optional(),
}).strict();

const BuiltExamTicketSchema = z.object({
  id: idSchema, subject: idSchema, title: z.string(),
  confidence: z.enum(["sure", "likely", "ours", "doubtful"]), includes: z.array(idSchema),
}).strict();

const BuiltTestSchema = z.object({
  id: idSchema,
  subject: idSchema,
  title: z.string(),
  kind: z.enum(TEST_KINDS),
  level: z.literal("L2").optional(),
  exam: idSchema.optional(),
  covers: z.array(idSchema).optional(),
  minutes: z.number().int().positive(),
  reuse: z.array(idSchema),
  questions: z.array(QuestionSchema),
}).strict().superRefine((meta, ctx) => { testMetaRules(meta, ctx); testLevelRule(meta, ctx); });

export const CardMetaSchema = z.object({
  deck: z.string().min(1),
  tickets: z.array(idSchema).default([]),
}).strict();

export const CardSchema = z.object({
  id: idSchema,
  deck: z.string().min(1),
  subject: idSchema,
  tickets: z.array(idSchema),
  question: z.string().min(1),
  answer: z.string().min(1),
  source: z.string(),
}).strict();

export const TodayDocSchema = z.object({
  date: dateSchema,
  plan: z.array(z.object({
    id: z.string(),
    text: z.string(),
    href: z.string().optional(),
    done: z.boolean().optional(),
  }).strip()),
  anki: z.object({
    at: z.string().datetime({ offset: true }),
    due: z.number().int().nonnegative(),
    weak: z.array(z.object({ ticket: idSchema, lapses: z.number().int().nonnegative() }).strip()),
  }).strip().optional(),
  note: z.string().optional(),
}).strip();

/** Read untrusted `meta/today`; malformed fields are dropped independently. */
export function parseTodayDoc(value: unknown): TodayDoc | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const date = dateSchema.safeParse(raw.date);
  if (!date.success || !Array.isArray(raw.plan)) return null;
  const plan = raw.plan.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const parsed = TodayDocSchema.shape.plan.element.pick({ id: true, text: true }).safeParse({ id: item.id, text: item.text });
    if (!parsed.success) return [];
    const href = item.href === undefined ? undefined : z.string().safeParse(item.href);
    const done = item.done === undefined ? undefined : z.boolean().safeParse(item.done);
    return [{ ...parsed.data, ...(href?.success ? { href: href.data } : {}), ...(done?.success ? { done: done.data } : {}) }];
  });
  const anki = raw.anki === undefined ? undefined : TodayDocSchema.shape.anki.unwrap().safeParse(raw.anki);
  const note = raw.note === undefined ? undefined : z.string().safeParse(raw.note);
  return {
    date: date.data,
    plan,
    ...(anki?.success ? { anki: anki.data } : {}),
    ...(note?.success ? { note: note.data } : {}),
  };
}

export type TodayDoc = z.infer<typeof TodayDocSchema>;

export const TheoryEntrySchema = z.object({
  ticket: idSchema,
  subject: idSchema,
  formulation: z.string().min(1),
  skeleton: z.array(z.string().min(1)).min(3).max(5).optional(),
  reliesOn: z.array(idSchema).optional(),
}).strict();

export const BuiltPackSchema = z.object({
  id: idSchema,
  title: z.string(),
  subjects: PackSchema.shape.subjects,
  exams: PackSchema.shape.exams,
  items: z.array(ItemSchema),
  thresholds: ThresholdsSchema.optional(),
  tickets: z.array(BuiltTicketSchema).optional(),
  exam: z.array(BuiltExamTicketSchema).optional(),
  remap: RemapFileSchema.optional(),
  tests: z.array(BuiltTestSchema).optional(),
  cards: z.array(CardSchema).optional(),
  theory: z.array(TheoryEntrySchema).optional(),
}).strict();

export type Pack = z.infer<typeof PackSchema>;
export type ItemsFile = z.infer<typeof ItemsFileSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type BuiltPack = z.infer<typeof BuiltPackSchema>;
export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type BuiltTicket = z.infer<typeof BuiltTicketSchema>;
export type BuiltExamTicket = z.infer<typeof BuiltExamTicketSchema>;
export type BuiltTest = z.infer<typeof BuiltTestSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Card = z.infer<typeof CardSchema>;
export type TheoryEntry = z.infer<typeof TheoryEntrySchema>;
