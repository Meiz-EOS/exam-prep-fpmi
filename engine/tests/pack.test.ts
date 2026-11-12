import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { buildPack } from "../../tools/pack/build-pack";
import { loadPack } from "../src/content/load";

const fixture = (name: string) => resolve("engine/tests/fixtures", name);

describe("pack building", () => {
  it("builds a valid pack and ignores private files", () => {
    const pack = buildPack(fixture("pack-valid"));
    expect(pack.items).toHaveLength(2);
    expect(pack.items[0]).toMatchObject({ id: "hw-one", subject: "math", kind: "дз", group: "Homework" });
    expect(pack.items[1]).toMatchObject({ id: "hw-two", kind: "дз-задача", star: true });
    expect(JSON.stringify(pack)).not.toContain("secret");
  });

  it("rejects duplicate ids across exams and items with path and id", () => {
    expect(() => buildPack(fixture("pack-duplicate"))).toThrow(/items[\\/]math\.yaml.*same-id/);
  });

  it("rejects impossible calendar dates and identifies the item", () => {
    expect(() => buildPack(fixture("pack-invalid-date"))).toThrow(/math\.yaml.*bad-date/);
  });

  it("rejects soft dates after hard dates and identifies the item", () => {
    expect(() => buildPack(fixture("pack-soft-hard"))).toThrow(/math\.yaml.*reversed-dates/);
  });

  it("rejects item files for unknown subjects with their path", () => {
    expect(() => buildPack(fixture("pack-unknown-subject"))).toThrow(/items[\\/]math\.yaml.*math/);
  });

  it("validates built output in loadPack", () => {
    expect(() => loadPack({ id: "oops", title: "", subjects: [], exams: [], items: [{ id: "x", subject: "x", group: "g", title: "t" }] })).toThrow();
  });
});
