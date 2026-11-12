// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { MemoryStore } from "../src/store/memory";
import { DataCtx } from "../src/ui/context";
import { Theory } from "../src/ui/modules/theory";

const pack: BuiltPack = {
  id: "theory-test", title: "Theory", subjects: [{ id: "math", name: "Математика" }], exams: [], items: [],
  tickets: [
    { id: "t1", subject: "math", title: "Первая теорема", key: true, src: "notes.tex:12" },
    { id: "t2", subject: "math", title: "Вторая теорема" },
  ],
  theory: [
    { ticket: "t1", subject: "math", formulation: "Первая формулировка $x^2$", skeleton: ["Шаг первый", "Шаг второй", "Шаг третий"], reliesOn: ["t2"] },
    { ticket: "t2", subject: "math", formulation: "Вторая формулировка", skeleton: ["Раз", "Два", "Три"] },
  ],
  tests: [],
};

describe("theory module", () => {
  it("opens a ticket and follows an relies-on link in the same sheet", async () => {
    const store = new MemoryStore({ items: [], attempts: [] });
    const root = document.createElement("div");
    document.body.replaceChildren(root);
    await act(() => render(<DataCtx.Provider value={{ pack, store, docs: [], loaded: true, canWrite: true, today: "2026-11-09", onError: () => {} }}><Theory /></DataCtx.Provider>, root));
    await act(() => (root.querySelector(".theory-ticket") as HTMLButtonElement).click());
    expect(root.querySelector('[role="dialog"]')?.textContent).toContain("Первая формулировка");
    expect(root.querySelector('[role="dialog"]')?.textContent).toContain("notes.tex:12");
    await act(() => (root.querySelector(".theory-relies button") as HTMLButtonElement).click());
    expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(root.querySelector('[role="dialog"]')?.textContent).toContain("Вторая формулировка");
  });
});
