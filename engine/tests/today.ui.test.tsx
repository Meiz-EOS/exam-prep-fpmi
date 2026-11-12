// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { MemoryStore } from "../src/store/memory";
import type { Doc, Snapshot } from "../src/store/types";
import { Today } from "../src/ui/modules/today";
import { Root } from "../src/ui/root";

const pack: BuiltPack = { id: "today-test", title: "Test", subjects: [], exams: [], items: [] };
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

async function mount(initial: Record<string, unknown>[] = []) {
  const store = new MemoryStore({ items: [], meta: initial.map((doc) => ({ id: "today", ...doc })) });
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  await act(() => render(<Root pack={pack} connect={async () => store} modules={[{ id: "today", title: "Today", component: Today }]} />, root));
  await flush();
  return { store, root };
}

describe("today module (memory store)", () => {
  it("writes a plan checkbox to meta/today and undo restores it", async () => {
    const { store, root } = await mount([{ date: "2026-11-09", plan: [{ id: "p1", text: "Review", done: false }] }]);
    await act(() => (root.querySelector(".today-check") as HTMLButtonElement).click());
    await flush();
    expect((root.querySelector(".today-check") as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    let snapshot: Snapshot | undefined;
    store.subscribe("meta", (value) => { snapshot = value; }, () => {});
    await flush();
    expect((snapshot?.docs[0] as Doc & { plan?: { done?: boolean }[] } | undefined)?.plan?.[0]?.done).toBe(true);
    await act(() => (root.querySelector(".toast.undo button") as HTMLButtonElement).click());
    await flush();
    expect((snapshot?.docs[0] as Doc & { plan?: { done?: boolean }[] } | undefined)?.plan?.[0]?.done).toBe(false);
  });

  it("dims stale plans and hides plan and Anki when the document is absent", async () => {
    const stale = await mount([{ date: "2026-11-08", plan: [{ id: "p1", text: "Old" }] }]);
    expect(stale.root.querySelector(".today-plan.stale")).not.toBeNull();
    const empty = await mount();
    expect(empty.root.querySelector(".today-plan")).toBeNull();
    expect(empty.root.querySelector(".today-anki")).toBeNull();
  });
});
