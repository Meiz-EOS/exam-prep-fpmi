import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings } from "./settings.ts";

let top: string;  // <top>/clone is the repo root
let root: string;

function local(dir: string, body: unknown): void {
  writeFileSync(join(dir, "zachetka.local.json"), typeof body === "string" ? body : JSON.stringify(body));
}

beforeEach(() => {
  top = mkdtempSync(join(tmpdir(), "zach-settings-"));
  root = join(top, "clone");
  mkdirSync(join(root, "packs", "p1"), { recursive: true });
});

describe("loadSettings", () => {
  it("defaults: the only pack, data and android next to the clone", () => {
    const s = loadSettings({ root, env: {} });
    expect(s).toMatchObject({
      pack: join(root, "packs", "p1"), packName: "p1",
      dataDir: join(top, "zachetka-data"), packData: join(top, "zachetka-data", "p1"),
      androidDir: join(top, "android"),
    });
    expect(s.file).toBeUndefined();
  });

  it("several packs and no setting → error that names the file", () => {
    mkdirSync(join(root, "packs", "p2"));
    expect(() => loadSettings({ root, env: {} })).toThrow(/several packs in packs\/: .*zachetka\.local\.json/);
  });

  it("file values: dataDir/androidDir relative to the file, pack relative to the root", () => {
    mkdirSync(join(root, "packs", "p2"));
    local(root, { pack: "packs/p2", dataDir: "../d", androidDir: "/opt/a" });
    expect(loadSettings({ root, env: {} })).toMatchObject({ pack: join(root, "packs", "p2"), dataDir: join(top, "d"), androidDir: "/opt/a" });
  });

  it("bare pack name means packs/<name>", () => {
    local(root, { pack: "p1" });
    expect(loadSettings({ root, env: {} }).pack).toBe(join(root, "packs", "p1"));
  });

  it("environment wins over the file", () => {
    local(root, { pack: "packs/p1", dataDir: "/x", androidDir: "/y" });
    const s = loadSettings({ root, env: { ZACH_PACK: "packs/other", ZACHETKA_DATA: "/env-data", ZACH_ANDROID: "/env-android" } });
    expect(s).toMatchObject({ pack: join(root, "packs", "other"), dataDir: "/env-data", androidDir: "/env-android" });
  });

  it("worktree inside the main clone uses the main clone's file, but its own pack", () => {
    local(root, { pack: "packs/p1", dataDir: "../data" });
    const wt = join(root, ".claude", "worktrees", "w");
    mkdirSync(join(wt, "packs", "p1"), { recursive: true });
    const s = loadSettings({ root: wt, env: {} });
    expect(s).toMatchObject({ pack: join(wt, "packs", "p1"), dataDir: join(top, "data"), file: join(root, "zachetka.local.json") });
  });

  it("broken file → error with the path", () => {
    local(root, "{ nope");
    expect(() => loadSettings({ root, env: {} })).toThrow(/zachetka\.local\.json: not valid JSON/);
    local(root, { dataDir: 5 });
    expect(() => loadSettings({ root, env: {} })).toThrow(/"dataDir" must be a non-empty string/);
  });
});
