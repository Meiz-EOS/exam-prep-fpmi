import { describe, expect, it } from "vitest";
import { fixLinks, trimTasksReadme } from "../../tools/release/export.ts";

describe("release export", () => {
  const files = new Set(["docs/a.md", "docs/architecture/README.md", "README.md"]);
  const exists = (p: string) => files.has(p);
  const dropped = new Set(["docs/architecture/tasks/W1-13.md"]);

  it("unlinks links to dropped files, keeps the rest", () => {
    const text =
      "see [W1-13](architecture/tasks/W1-13.md), [a](a.md#x), [up](../README.md), " +
      "[web](https://example.org), [here](#top)";
    const r = fixLinks("docs/x.md", text, exists, dropped);
    expect(r.broken).toEqual([]);
    expect(r.text).toBe(
      "see W1-13, [a](a.md#x), [up](../README.md), [web](https://example.org), [here](#top)",
    );
  });

  it("reports links that point nowhere", () => {
    const r = fixLinks("docs/x.md", "[gone](missing.md) ![pic](architecture/tasks/W1-13.md)", exists, dropped);
    expect(r.broken).toEqual(["docs/x.md: missing.md", "docs/x.md: architecture/tasks/W1-13.md"]);
  });

  it("ignores links outside the repo", () => {
    expect(fixLinks("docs/x.md", "[m](../../mipt/a.md)", exists, dropped).broken).toEqual([]);
  });

  it("keeps only the current wave in tasks/README", () => {
    const out = trimTasksReadme("# Задачи\n\n## Волна W1\n| [W1-01](W1-01.md) |\n\n## Волна W12: доступ\n\nтекст\n");
    expect(out).not.toContain("W1-01");
    expect(out).toContain("## Волна W12: доступ\n\nтекст\n");
  });
});
