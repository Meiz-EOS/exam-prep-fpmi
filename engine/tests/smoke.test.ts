import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parse } from "yaml";

describe("toolchain", () => {
  it("parses YAML and validates with zod", () => {
    const schema = z.object({ id: z.string(), date: z.iso.date() });
    expect(schema.parse(parse("id: aig\ndate: 2026-12-26"))).toEqual({ id: "aig", date: "2026-12-26" });
  });
});
