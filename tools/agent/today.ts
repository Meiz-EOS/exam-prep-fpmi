#!/usr/bin/env node
// Build the meta/today document (collection "meta", doc "today").
// PC: --write <data>/meta/today.json writes it in place; without --write it is printed (claude.ai: pass to `ArtifactData update`).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { TodayDocSchema, type BuiltPack, type TodayDoc } from "../../engine/src/content/schema.ts";
import { buildPack } from "../pack/build-pack.ts";
import { loadSettings } from "../lib/settings.ts";

type JsonObject = Record<string, unknown>;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function moscowDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function planFrom(value: string | undefined, file: string | undefined): unknown[] {
  if (value && file) throw new Error("Choose either --plan or --plan-file");
  const parsed: unknown = value ? JSON.parse(value) : file ? readJson(file) : [];
  if (!Array.isArray(parsed)) throw new Error("Plan must be a JSON array");
  return parsed;
}

function weakAnki(report: JsonObject, packTicketIds: Set<string>): { ticket: string; lapses: number }[] {
  const totals = report.lapses_by_tag;
  if (!totals || typeof totals !== "object" || Array.isArray(totals)) return [];
  return Object.entries(totals as Record<string, unknown>)
    .filter(([ticket, count]) => packTicketIds.has(ticket) && Number.isInteger(count) && (count as number) > 0)
    .map(([ticket, lapses]) => ({ ticket, lapses: lapses as number }))
    .sort((a, b) => b.lapses - a.lapses || a.ticket.localeCompare(b.ticket))
    .slice(0, 5);
}

export function buildTodayDoc(
  pack: Pick<BuiltPack, "tickets">,
  ankiReport: JsonObject,
  plan: unknown[],
  date: string,
  at: string,
  note?: string,
): TodayDoc {
  const ticketIds = new Set((pack.tickets ?? []).map(({ id }) => id));
  return TodayDocSchema.parse({
    date,
    plan,
    anki: {
      at,
      due: Array.isArray(ankiReport.due) ? ankiReport.due.length : 0,
      weak: weakAnki(ankiReport, ticketIds),
    },
    ...(note ? { note } : {}),
  });
}

function main(): void {
const { values } = parseArgs({
  options: {
    pack: { type: "string" },
    anki: { type: "string" },
    plan: { type: "string" },
    "plan-file": { type: "string" },
    date: { type: "string" },
    note: { type: "string" },
    write: { type: "string" },
  },
});
if (!values.anki) throw new Error("--anki is required");

const pack = buildPack(values.pack ? resolve(values.pack) : loadSettings().pack);
const report = readJson(values.anki) as JsonObject;
const plan = planFrom(values.plan, values["plan-file"]);
const doc = buildTodayDoc(pack, report, plan, values.date ?? moscowDate(new Date()), new Date().toISOString(), values.note);
if (values.write) writeToday(values.write, doc, new Date().toISOString());
else process.stdout.write(`${JSON.stringify(doc)}\n`);
}

/** Writes the checked document straight into the PC data folder (meta/today.json), atomically. */
export function writeToday(file: string, doc: TodayDoc, at: string): void {
  const body = { ...TodayDocSchema.parse(doc), updatedAt: at };
  const tmp = join(dirname(file), `.today.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(tmp, file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

