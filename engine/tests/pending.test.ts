import { describe, expect, it } from "vitest";
import { overlayPending, reflects } from "../src/core/pending";

describe("overlayPending", () => {
  const docs = [{ id: "a", status: "не начато", note: "x" }, { id: "b", status: "сдано" }];
  it("returns the same docs when nothing is pending", () => {
    expect(overlayPending(docs, new Map())).toBe(docs);
  });
  it("replaces fields, null removes, unknown ids are added, others untouched", () => {
    const out = overlayPending(docs, new Map([["a", { status: "принято", note: null }], ["c", { title: "new", custom: true }]]));
    expect(out).toEqual([{ id: "a", status: "принято" }, { id: "b", status: "сдано" }, { id: "c", title: "new", custom: true }]);
    expect(out[1]).toBe(docs[1]);
    expect(docs[0]).toEqual({ id: "a", status: "не начато", note: "x" });
  });
});

describe("reflects", () => {
  it("compares fields, null means absent, objects by value", () => {
    expect(reflects({ id: "a", status: "сдано", override: { soft: "2026-11-12" } }, { status: "сдано", override: { soft: "2026-11-12" } })).toBe(true);
    expect(reflects({ id: "a", status: "сдано" }, { note: null })).toBe(true);
    expect(reflects({ id: "a", status: "сдано" }, { status: "принято" })).toBe(false);
    expect(reflects(undefined, { status: "сдано" })).toBe(false);
  });
});
