// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import { Math, splitMath } from "../src/ui/math";

async function mount(text: string) {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  await act(() => { render(<Math text={text} />, root); });
  return root;
}

describe("Math", () => {
  it("renders inline formula and keeps plain text", async () => {
    const root = await mount("Пусть $x^2$ — квадрат");
    expect(root.querySelectorAll(".katex").length).toBe(1);
    expect(root.querySelector(".katex-display")).toBeNull();
    expect(root.textContent).toContain("Пусть ");
    expect(root.textContent).toContain(" — квадрат");
  });
  it("renders display formula", async () => {
    const root = await mount("до $$\\frac{a}{b}$$ после");
    expect(root.querySelector(".katex-display .katex")).not.toBeNull();
  });
  it("plain text has no formulas", async () => {
    const root = await mount("цена 5 рублей");
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toBe("цена 5 рублей");
  });
  it("bad formula shows its source and does not crash", async () => {
    const root = await mount("a $\\frac{1$ b $y$");
    expect(root.querySelector(".math-error")?.textContent).toBe("$\\frac{1$");
    expect(root.querySelectorAll(".katex").length).toBe(1);
  });
  it("\\$ outside a formula is a literal dollar", () => {
    expect(splitMath("5 \\$ and $x$").filter((p) => p.math).length).toBe(1);
    expect(splitMath("5 \\$ and 6 \\$").every((p) => !p.math)).toBe(true);
  });
});
