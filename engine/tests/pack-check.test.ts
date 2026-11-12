import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkPack } from "../../tools/pack/check-pack";
import { formatProblem } from "../../tools/pack/problems";
import { buildPack } from "../../tools/pack/build-pack";

// `npm run check:pack` (Р-74): every problem of a pack as `file:line: text`, with the same wording buildPack throws.
const fixture = (name: string) => resolve("engine/tests/fixtures", name);
const lines = (dir: string): string[] => checkPack(dir, resolve("engine/tests/fixtures")).problems.map((problem) => formatProblem(problem, resolve("engine/tests/fixtures")));

describe("check:pack", () => {
  it("accepts the real pack and the valid fixtures", () => {
    expect(lines("packs/igor-2026w")).toEqual([]);
    for (const name of ["pack-valid", "pack-theory", "pack-knowledge", "pack-cards", "pack-exam", "pack-ticket-test"]) expect(lines(fixture(name)), name).toEqual([]);
    expect(checkPack("packs/igor-2026w").summary).toMatch(/^ok: packs[\\/]igor-2026w \(\d+ subjects, \d+ items, /);
  });

  // fixture → the one problem it must give: `file:line` prefix and the words that say what is wrong
  it.each<[string, string, RegExp]>([
    ["pack-duplicate", "pack-duplicate/items/math.yaml:4", /id "same-id" повторяется/],
    ["pack-invalid-date", "pack-invalid-date/items/math.yaml:6", /поле "soft" — такой даты нет в календаре, получено "2026-02-30" \(задача bad-date\)/],
    ["pack-soft-hard", "pack-soft-hard/items/math.yaml:6", /"reversed-dates" мягкий срок soft \(2026-11-17\) позже жёсткого hard \(2026-11-16\)/],
    ["pack-unknown-subject", "pack-unknown-subject/items/math.yaml", /предмет "math" не описан в pack\.yaml/],
    ["pack-cards-bad-ticket", "pack-cards-bad-ticket/cards/math/limits.md:5", /карточка "math-c-1" ссылается на неизвестный тикет "math-t-404"/],
    ["pack-cards-cross-ticket", "pack-cards-cross-ticket/cards/math/limits.md:5", /другого предмета \(phys\)/],
    ["pack-kn-bad-level", "pack-kn-bad-level/tests/math/entry.md:20", /поле "level" — допустимо: L0, L1, L2; получено "L9" \(вопрос math-q-002\)/],
    ["pack-kn-few-points", "pack-kn-few-points/tests/math/entry.md:20", /поле "points" — не меньше 2 элементов, получено 1/],
    ["pack-kn-bad-ticket", "pack-kn-bad-ticket/tests/math/entry.md:20", /вопрос "math-q-002" ссылается на неизвестный тикет "math-t-9999"/],
    ["pack-kn-bad-reuse", "pack-kn-bad-reuse/tests/math/retest.md:2", /reuse ссылается на неизвестный вопрос "math-q-777"/],
    ["pack-kn-bad-remap", "pack-kn-bad-remap/tickets/math.remap.yaml:2", /"math-old-2" ведёт на неизвестный тикет "math-t-4040"/],
    ["pack-kn-current-remap", "pack-kn-current-remap/tickets/math.remap.yaml:1", /"math-t-0201" — это текущий id тикета/],
    ["pack-kn-dup-id", "pack-kn-dup-id/tests/math/retest.md:8", /id "math-q-001" повторяется — он уже занят \(tests[\\/]math[\\/]entry\.md:8\)/],
    ["pack-kn-bad-ticket-file", "pack-kn-bad-ticket-file/tickets/math.yaml:4", /поле "key" — нужен тип «да\/нет \(true или false\)», получено 5 \(тикет math-t-0207\)/],
    ["pack-theory-bad-ticket", "pack-theory-bad-ticket/theory/math/01.md:1", /неизвестный тикет "math-t-404"/],
    ["pack-theory-few-steps", "pack-theory-few-steps/theory/math/01.md:1", /поле "skeleton" — не меньше 3 элементов, получено 2/],
    ["pack-theory-duplicate", "pack-theory-duplicate/theory/math/02.md:1", /теория для тикета "math-t-1" уже есть/],
  ])("%s gives one problem with its place", (name, prefix, words) => {
    const found = lines(fixture(name));
    expect(found).toHaveLength(1);
    expect(found[0]!.startsWith(`${prefix}: `), found[0]).toBe(true);
    expect(found[0]).toMatch(words);
  });

  it("reports every mistake of a pack at once, in several files, and what is wrong with each", () => {
    const found = lines(fixture("pack-multi-broken"));
    const has = (prefix: string, words: RegExp) => expect(found.some((line) => line.startsWith(`${prefix}: `) && words.test(line)), `${prefix} ${words}\n${found.join("\n")}`).toBe(true);
    has("pack-multi-broken/items/math.yaml:5", /лишнее поле "due"/);
    has("pack-multi-broken/items/math.yaml:5", /лишнее поле "colour"/);
    has("pack-multi-broken/items/math.yaml:6", /поле "hard" — нужна дата ГГГГ-ММ-ДД, получено "15 ноября" \(задача exam-math\)/);
    has("pack-multi-broken/items/math.yaml:6", /id "exam-math" повторяется — он уже занят \(pack\.yaml:6\)/);
    has("pack-multi-broken/tickets/math.yaml:2", /поле "key" — нужен тип «да\/нет/);
    has("pack-multi-broken/cards/math/limits.md:10", /карточка "math-c-2" ссылается на неизвестный тикет "math-t-404"/);
    has("pack-multi-broken/theory/math/01.md:1", /поле "skeleton" — не меньше 3 элементов/);
    expect(found).toHaveLength(7); // a broken tickets file does not make its tickets "unknown" in cards
  });

  it("shows the line of a missing field, of a YAML syntax error, and of a stray key", () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-check-"));
    try {
      cpSync(fixture("pack-valid"), dir, { recursive: true });
      writeFileSync(join(dir, "items/math.yaml"), "- group: G\n  kind: дз\n  items:\n    - { id: a }\n");
      expect(lines(dir).map((line) => line.replace(/^.*?items/, "items"))).toEqual(['items/math.yaml:4: не указано обязательное поле "title" (строка) (задача a)']);
      writeFileSync(join(dir, "items/math.yaml"), "- group: G\n  items: [\n");
      const [problem] = lines(dir);
      expect(problem).toMatch(/items[\\/]math\.yaml:\d+: ошибка YAML/);
      writeFileSync(join(dir, "pack.yaml"), "title: no id\nsubjects: []\nexams: []\n");
      expect(lines(dir)).toEqual([expect.stringMatching(/pack\.yaml:1: не указано обязательное поле "id"/)]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("buildPack throws the same lines the check prints", () => {
    const dir = fixture("pack-multi-broken");
    expect(() => buildPack(dir)).toThrow(/items[\\/]math\.yaml:5: лишнее поле "due"[\s\S]*cards[\\/]math[\\/]limits\.md:10: /);
  });

  it("says so when the folder is not a pack", () => {
    expect(lines(fixture("no-such-pack"))).toEqual(['no-such-pack: нет файла pack.yaml — это не папка пакета']);
  });
});
