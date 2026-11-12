import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TodayDocSchema } from "../src/content/schema.ts";
import { inputs } from "../../tools/agent/diff.ts";
import { writeToday } from "../../tools/agent/today.ts";

const root = resolve(import.meta.dirname, "../..");

describe("agent procedures on the PC data folder", () => {
  it("--data stands for items/ and attempts/", () => {
    expect(inputs({ data: "/d" })).toEqual({ docs: "/d/items", attempts: "/d/attempts" });
    expect(inputs({ docs: "/s/items" })).toEqual({ docs: "/s/items", attempts: undefined });
    expect(() => inputs({ data: "/d", docs: "/x" })).toThrow();
  });

  it("writeToday writes a schema-valid doc with updatedAt and leaves no temp file", () => {
    const dir = mkdtempSync(join(tmpdir(), "zach-today-"));
    const file = join(dir, "today.json");
    writeFileSync(file, "{}");
    const doc = { date: "2026-11-09", plan: [], anki: { at: "2026-11-09T10:00:00.000Z", due: 0, weak: [] } };
    writeToday(file, doc, "2026-11-09T10:00:01.000Z");
    const body = JSON.parse(readFileSync(file, "utf8"));
    expect(TodayDocSchema.parse(body)).toEqual(doc);
    expect(body.updatedAt).toBe("2026-11-09T10:00:01.000Z");
    expect(readdirSync(dir)).toEqual(["today.json"]);
  });

  it("diff.ts runs under plain node with --data", () => {
    const data = mkdtempSync(join(tmpdir(), "zach-data-"));
    mkdirSync(join(data, "items"));
    writeFileSync(join(data, "items/aig1-submit.json"), JSON.stringify({ status: "сдано", updatedAt: "2026-11-09T00:00:00Z" }));
    const out = execFileSync(process.execPath, ["tools/agent/diff.ts", "--data", data, "--pack", "packs/igor-2026w", "--no-save"], { cwd: root, encoding: "utf8" });
    expect(out.length).toBeGreaterThan(0);
  }, 30_000);
});
