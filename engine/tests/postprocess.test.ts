import { describe, expect, it } from "vitest";
import { unwrapDocument } from "../../tools/build/postprocess";

describe("unwrapDocument", () => {
  it("keeps title first, drops the document skeleton", () => {
    const out = unwrapDocument(`<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><title>Зачётка</title><meta name="viewport" content="x"><meta name="claude:viewport-fit-sides" content="cover"><script type="module">go()</script><style>a{}</style></head><body><div id="app"></div></body></html>`);
    expect(out.startsWith("<title>Зачётка</title>")).toBe(true);
    expect(out).not.toMatch(/<!doctype|<html|<head|<body|charset|name="viewport"/i);
    expect(out).toContain('<meta name="claude:viewport-fit-sides" content="cover">');
    expect(out).toContain("<script type=\"module\">go()</script>");
    expect(out.trimEnd().endsWith('<div id="app"></div>')).toBe(true);
  });
});
