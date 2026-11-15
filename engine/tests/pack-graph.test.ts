import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPack, collectPack } from "../../tools/pack/build-pack";
import { checkPack } from "../../tools/pack/check-pack";
import { formatProblem } from "../../tools/pack/problems";

// graph/<subject>.yaml (docs/architecture/14-graph-plan.md): the topics get into the pack in the canonical order,
// every mistake has its own message, the entry pool is checked with warnings only.
const fixture = resolve("engine/tests/fixtures/pack-graph");
const dirs: string[] = [];
function copy(change: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "pack-graph-"));
  dirs.push(dir);
  cpSync(fixture, dir, { recursive: true });
  change(dir);
  return dir;
}
const edit = (dir: string, file: string, from: string, to: string): void => {
  const path = join(dir, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} has no ${from}`);
  writeFileSync(path, text.replace(from, to));
};
const lines = (dir: string, list: "problems" | "warnings" = "problems"): string[] => collectPack(dir)[list].map((problem) => formatProblem(problem, dir));
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("graph in the pack", () => {
  it("builds the topics in the canonical order, with defaults, next to a subject that has no graph", () => {
    const pack = buildPack(fixture);
    expect(pack.graph?.map((topic) => topic.id)).toEqual(["math-g-sets", "math-g-limits", "math-g-deriv", "phys-g-kinematics"]);
    expect(pack.graph?.[0]).toEqual({ id: "math-g-sets", subject: "math", title: "Sets and maps", tickets: ["math-t-1", "math-t-2"], requires: [] });
    expect(pack.graph?.[2]).toMatchObject({ requires: ["math-g-limits"], minutes: 30 });
    expect(pack.graph?.[3]).toMatchObject({ subject: "phys", requires: ["math-g-deriv"] }); // a cross-subject edge
    expect(checkPack(fixture).summary).toMatch(/, 4 topics\)$/);
    expect(lines(fixture, "warnings")).toEqual([]);
  });

  it("a pack without graph/ has no graph field; the real pack still builds", () => {
    expect(buildPack(resolve("engine/tests/fixtures/pack-knowledge")).graph).toBeUndefined();
    expect(collectPack("packs/igor-2026w").problems).toEqual([]);
  });

  it("minutes of an entry test are optional (built as 12), of other kinds required", () => {
    expect(buildPack(fixture).tests?.map((test) => test.minutes)).toEqual([12, 12]);
    const dir = copy((root) => edit(root, "tests/math/math-entry.md", "kind: entry", "kind: retest"));
    expect(lines(dir)).toEqual([expect.stringMatching(/^tests\/math\/math-entry\.md:\d+: для kind: retest нужно поле "minutes" \(тест math-entry\)$/)]);
  });

  it.each<[string, (dir: string) => void, RegExp]>([
    ["unknown subject", (dir) => writeFileSync(join(dir, "graph/bio.yaml"), "topics: []\n"), /^graph\/bio\.yaml: предмет "bio" не описан в pack\.yaml/],
    ["unknown ticket", (dir) => edit(dir, "graph/phys.yaml", "[phys-t-1]", "[phys-t-1, phys-t-404]"), /^graph\/phys\.yaml:4: тема "phys-g-kinematics" содержит неизвестный тикет "phys-t-404"$/],
    ["ticket of another subject", (dir) => edit(dir, "graph/phys.yaml", "[phys-t-1]", "[phys-t-1, chem-t-1]"), /^graph\/phys\.yaml:4: тема "phys-g-kinematics" содержит тикет "chem-t-1" другого предмета \(chem\)$/],
    ["ticket in two topics", (dir) => edit(dir, "graph/math.yaml", "[math-t-3, math-t-4]", "[math-t-3, math-t-4, math-t-1]"), /^graph\/math\.yaml:12: тема "math-g-limits": тикет "math-t-1" уже входит в тему "math-g-sets"/],
    ["ticket outside the graph", (dir) => edit(dir, "graph/math.yaml", "[math-t-3, math-t-4]", "[math-t-3]"), /^graph\/math\.yaml: в граф не вошли тикеты предмета \(1\): "math-t-4" — при графе каждый тикет/],
    ["unknown requires", (dir) => edit(dir, "graph/math.yaml", "requires: [math-g-sets]", "requires: [math-t-1]"), /^graph\/math\.yaml:13: тема "math-g-limits" требует неизвестную тему "math-t-1"/],
    ["self requires", (dir) => edit(dir, "graph/math.yaml", "requires: [math-g-sets]", "requires: [math-g-limits]"), /^graph\/math\.yaml:13: тема "math-g-limits" требует саму себя$/],
    ["cycle through another subject", (dir) => edit(dir, "graph/math.yaml", "tickets: [math-t-1, math-t-2]", "tickets: [math-t-1, math-t-2]\n    requires: [phys-g-kinematics]"),
      /^graph\/math\.yaml:2: цикл в графе тем: math-g-deriv → math-g-limits → math-g-sets → phys-g-kinematics → math-g-deriv/],
    ["duplicate id", (dir) => edit(dir, "graph/phys.yaml", "id: phys-g-kinematics", "id: math-t-1"), /^graph\/phys\.yaml:2: id "math-t-1" повторяется — он уже занят \(tickets\/math\.yaml:2\)/],
    ["no tickets", (dir) => edit(dir, "graph/phys.yaml", "[phys-t-1]", "[]"), /^graph\/phys\.yaml:4: поле "tickets" — не меньше 1 элементов, получено 0 \(тема phys-g-kinematics\)$/],
    ["stray field", (dir) => edit(dir, "graph/phys.yaml", "requires:", "needs:"), /^graph\/phys\.yaml:5: лишнее поле "needs" — такого поля в формате нет \(опечатка\?\) \(тема phys-g-kinematics\)$/],
    ["deck separator in a title", (dir) => edit(dir, "graph/phys.yaml", "\"Kinematics\"", "\"Kinematics::basics\""), /^graph\/phys\.yaml:3: тема "phys-g-kinematics": в названии нельзя «::»/],
  ])("%s is an error with its place", (_name, change, words) => {
    const found = lines(copy(change));
    expect(found.filter((line) => words.test(line)), found.join("\n")).toHaveLength(1);
    expect(found.length, found.join("\n")).toBeLessThanOrEqual(2); // the mistake itself, at most one consequence
  });

  it("warns (and still builds) when the entry pool does not fit the graph", () => {
    const dir = copy((root) => {
      edit(root, "tests/math/math-entry.md", "ticket: math-t-5 · level: L0", "ticket: math-t-5 · level: L2");
      edit(root, "tests/math/math-entry.md", "What is a set?", "Дайте определение множества и сформулируйте его отрицание.");
      edit(root, "tests/math/math-entry.md", "- all later terms are close", "- all later terms are close\n- four\n");
      rmSync(join(root, "tests/phys"), { recursive: true });
    });
    expect(lines(dir)).toEqual([]);
    expect(buildPack(dir).graph).toHaveLength(4);
    expect(lines(dir, "warnings")).toEqual([
      'tests/math/math-entry.md:6: входной пул "math-entry": вопрос "math-q-001" просит ещё и отрицание — во входном пуле один вопрос проверяет одно',
      'tests/math/math-entry.md:13: входной пул "math-entry": вопрос "math-q-002": в эталоне 4 пунктов, во входном пуле — 2–3 (ответ за минуту)',
      'tests/math/math-entry.md:30: входной пул "math-entry": вопрос "math-q-004" уровня L2 — во входном тесте он не задаётся (нужны L0 и L1)',
      'graph/math.yaml: во входном пуле нет вопросов (L0/L1) по темам (1): "math-g-deriv" — такие темы входной тест определяет только по соседним',
      'graph/phys.yaml: у предмета "phys" есть граф, но нет входного пула (tests/phys/phys-entry.md, kind: entry) — входной тест по нему не пройти',
    ]);
    expect(checkPack(dir).warnings).toHaveLength(5);
  });
});
