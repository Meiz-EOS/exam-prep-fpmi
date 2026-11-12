// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { MemoryStore } from "../src/store/memory";
import { subjectReady } from "../src/core/ready";
import { Ready } from "../src/ui/modules/ready";
import { DataCtx } from "../src/ui/context";

const pack: BuiltPack = {
  id: "ready-fixture", title: "Ready", subjects: [{ id: "math", name: "Математика" }], exams: [], items: [],
  thresholds: { ud: { L0: 1, L1: 0 }, hor: { L0: 1, L1: 0, L2: 0, keyL2: false } },
  tickets: [{ id: "new-ticket", subject: "math", title: "Теорема", provisional: true }, { id: "outside-ticket", subject: "math", title: "Другая теорема" }],
  exam: [{ id: "exam-1", subject: "math", title: "Экзамен: пределы", confidence: "ours", includes: ["new-ticket"] }],
  remap: { "old-ticket": "new-ticket" },
  tests: [{ id: "test", subject: "math", title: "Тест", kind: "entry", minutes: 10, reuse: [], questions: [
    { id: "q1", ticket: "old-ticket", level: "L0", body: "Вопрос", points: ["a", "b"] },
  ] }],
};
const answers = [
  { q: "q1", text: "", self: 1, hits: [0, 1], at: "2026-11-01T12:00:00Z" },
  { q: "q1", text: "", self: 1, hits: [0, 1], at: "2026-11-02T12:00:00Z" },
  { q: "q1", text: "", self: 0.8, hits: [0], at: "2026-11-03T12:00:00Z" },
];

describe("ready module", () => {
  it("shows readiness numbers and applies the pack remap to attempt answers", async () => {
    expect(subjectReady("math", pack, [{ test: "test", startedAt: "", answers }], new Date(), pack.remap).shares.L0).toBe(1);
    const store = new MemoryStore({ items: [], attempts: [{ id: "a1", test: "test", startedAt: "2026-11-01T12:00:00Z", answers }] });
    const root = document.createElement("div");
    document.body.replaceChildren(root);
    await act(() => render(<DataCtx.Provider value={{ pack, store, docs: [], loaded: true, canWrite: true, today: "2026-11-08", onError: () => {} }}><Ready /></DataCtx.Provider>, root));
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(root.textContent).toContain("L0 100%");
    expect(root.textContent).toContain("L1 0%");
    expect(root.textContent).toContain("to pass");
    expect(root.textContent).toContain("met");
    expect(root.textContent).toContain("93%");
    expect(root.textContent).toContain("mastered");
    expect(root.textContent).toContain("provisional");
    expect(root.textContent).toContain("Nov 3");
    expect(root.textContent).toContain("Экзамен: пределы");
    expect(root.textContent).toContain("our stream");
    expect(root.textContent).toContain("Outside exam tickets");
    const examDetails = root.querySelector(".ready-exam") as HTMLDetailsElement;
    await act(() => { examDetails.open = true; examDetails.dispatchEvent(new Event("toggle")); });
    expect(root.textContent).toContain("Теорема");
  });
  it("excludes maxLevel L1 exam tickets from the L2 gap denominator", async () => {
    const capped: BuiltPack = {
      ...pack,
      tickets: [{ id: "definition", subject: "math", title: "Определение", maxLevel: "L1" }],
      exam: [{ id: "exam-definition", subject: "math", title: "Билет", confidence: "ours", includes: ["definition"] }],
      thresholds: { ud: { L0: 1, L1: 1 }, hor: { L0: 1, L1: 1, L2: 1, keyL2: false } },
      tests: [],
    };
    const store = new MemoryStore({ items: [], attempts: [] });
    const root = document.createElement("div");
    document.body.replaceChildren(root);
    await act(() => render(<DataCtx.Provider value={{ pack: capped, store, docs: [], loaded: true, canWrite: true, today: "2026-11-08", onError: () => {} }}><Ready /></DataCtx.Provider>, root));
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(root.textContent).not.toContain("L2: 0 of 1 mastered");
    // Р-54: a missing level reads «n/a», an unanswered one «—».
    expect(root.querySelector(".ready-exam-values")!.textContent).toBe("L0 —L1 —L2 n/a");
    const rowValues = [...root.querySelectorAll(".ready-ticket .ready-ticket-value .num")].map((node) => node.textContent);
    expect(rowValues).toEqual(["—", "—", "n/a"]);
  });
});
