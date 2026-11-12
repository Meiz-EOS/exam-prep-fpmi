import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildPack } from "../../tools/pack/build-pack";

// Characterization of buildPack error paths not covered elsewhere (safety net for refactoring build-pack.ts).
const fixture = (name: string) => resolve("engine/tests/fixtures", name);

function withCopy(name: string, change: (dir: string) => void, check: (dir: string) => void): void {
  const dir = mkdtempSync(`${tmpdir()}/pack-paths-`);
  try {
    cpSync(fixture(name), dir, { recursive: true });
    change(dir);
    check(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("buildPack error paths", () => {
  it("rejects an item without kind with path and id", () => {
    withCopy("pack-valid", (dir) => writeFileSync(`${dir}/items/math.yaml`, "- group: G\n  items:\n    - { id: no-kind, title: T }\n"),
      (dir) => expect(() => buildPack(dir)).toThrow(/items[\\/]math\.yaml:3: у "no-kind" не указан kind/));
  });

  it("names the item when a later group fails the schema", () => {
    withCopy("pack-valid", (dir) => writeFileSync(`${dir}/items/math.yaml`, "- group: A\n  kind: дз\n  items:\n    - { id: ok, title: T }\n- group: B\n  kind: дз\n  items:\n    - { id: fine, title: T }\n    - { id: broken, title: T, soft: \"2026-02-30\" }\n"),
      (dir) => expect(() => buildPack(dir)).toThrow(/items[\\/]math\.yaml:9: поле "soft" — такой даты нет в календаре, получено "2026-02-30" \(задача broken\)/));
  });

  it.each([
    ["pack-theory", "theory"],
    ["pack-knowledge", "tests"],
    ["pack-cards", "cards"],
  ])("rejects an unknown subject folder in %s/%s", (name, section) => {
    withCopy(name, (dir) => {
      mkdirSync(`${dir}/${section}/ghost`, { recursive: true });
      writeFileSync(`${dir}/${section}/ghost/01.md`, "");
    }, (dir) => expect(() => buildPack(dir)).toThrow(new RegExp(`${section}[\\\\/]ghost: предмет "ghost" не описан`)));
  });

  it("rejects a duplicate card id naming the file once", () => {
    withCopy("pack-cards", (dir) => writeFileSync(`${dir}/cards/math/limits.md`, "---\ndeck: D\ntickets: [math-t-1]\n---\n## math-c-1\nQ\n---\nA\n\n## math-c-1\nQ\n---\nA\n"),
      (dir) => expect(() => buildPack(dir)).toThrow(/^[^:]*limits\.md:10: id "math-c-1" повторяется/));
  });

  it("builds every fixture used above unchanged", () => {
    for (const name of ["pack-valid", "pack-theory", "pack-knowledge", "pack-cards"]) expect(() => buildPack(fixture(name)), name).not.toThrow();
  });
});
