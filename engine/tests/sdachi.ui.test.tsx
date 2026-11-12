// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { MemoryStore } from "../src/store/memory";
import type { Snapshot } from "../src/store/types";
import { Root } from "../src/ui/root";
import { SdachiEditable } from "../src/ui/modules/sdachi/edit";

const pack: BuiltPack = {
  id: "t", title: "T", subjects: [{ id: "cpp", name: "C++" }], exams: [],
  items: [
    { id: "cpp-string", subject: "cpp", group: "C++ задачи", kind: "задача-cpp", title: "String", soft: "2099-01-10" },
    { id: "cpp-p1", subject: "cpp", group: "C++ задание · неделя 1", kind: "дз-задача", title: "С 1.1" },
  ],
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let store: MemoryStore;
let docs: Snapshot["docs"] = [];
let root: HTMLElement;

async function mount() {
  store = new MemoryStore({ items: [] });
  store.subscribe("items", (s) => { docs = s.docs; }, () => {});
  root = document.createElement("div");
  document.body.replaceChildren(root);
  localStorage.clear();
  await act(() => {
    render(<Root pack={pack} connect={async () => store} modules={[{ id: "sdachi", title: "S", component: SdachiEditable }]} />, root);
  });
  await flush();
  // open the group
  const det = root.querySelector("details.group") as HTMLDetailsElement;
  det.open = true;
  det.dispatchEvent(new Event("toggle"));
  await flush();
}
const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
const qa = (sel: string) => [...root.querySelectorAll(sel)];
async function change(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  await act(() => { el.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}

describe("sdachi editing (memory store)", () => {
  beforeEach(mount);

  it("deadline is for handing in: a handed-in item shows no due date in its row", async () => {
    const dueOfString = () => (qa(".group .open-row") as HTMLElement[]).find((r) => r.textContent!.includes("String"))!.querySelector(".due")?.textContent ?? "";
    expect(dueOfString()).toContain("10.01");
    await act(() => q<HTMLButtonElement>(".group button.pill").click());
    const handedIn = (qa(".pop button") as HTMLButtonElement[]).find((b) => b.dataset.s === "сдано")!;
    await act(() => handedIn.click());
    await flush();
    expect(dueOfString()).toBe("");
  });

  it("status menu: tap the pill, pick any status; shown at once, undo restores it", async () => {
    await act(() => q<HTMLButtonElement>(".group button.pill").click());
    expect(q(".pop")).not.toBeNull();
    const accepted = (qa(".pop button") as HTMLButtonElement[]).find((b) => b.dataset.s === "принято")!;
    await act(() => accepted.click());
    expect(q(".pop")).toBeNull();
    // optimistic: the pill shows the new status before the store answers
    expect(q(".group button.pill").getAttribute("data-s")).toBe("принято");
    await flush();
    expect(docs.find((d) => d.id === "cpp-string")?.status).toBe("принято");
    await act(() => q<HTMLButtonElement>(".toast.undo button").click());
    await flush();
    expect(docs.find((d) => d.id === "cpp-string")?.status).toBe("не начато");
  });

  it("Escape closes the status menu without a change", async () => {
    await act(() => q<HTMLButtonElement>(".group button.pill").click());
    await act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(q(".pop")).toBeNull();
    await flush();
    expect(docs.find((d) => d.id === "cpp-string")).toBeUndefined();
  });

  it("the row opens the item card; status buttons in the card write", async () => {
    await act(() => q<HTMLButtonElement>(".group button.open-row").click());
    expect(q(".sheet")).not.toBeNull();
    const work = (qa(".sheet .opt") as HTMLButtonElement[]).find((b) => b.dataset.s === "в работе")!;
    await act(() => work.click());
    await flush();
    expect(docs.find((d) => d.id === "cpp-string")?.status).toBe("в работе");
    await act(() => q<HTMLButtonElement>(".sheet .primary").click());
    expect(q(".sheet")).toBeNull();
  });

  it("editing a pack item's date writes an override, marks it, and can be reset", async () => {
    await act(() => q<HTMLButtonElement>(".group button.open-row").click());
    await flush();
    await change(q<HTMLInputElement>("#sf-cpp-string"), "2099-01-12");
    expect(docs.find((d) => d.id === "cpp-string")?.override).toEqual({ soft: "2099-01-12" });
    expect(root.textContent).toContain("12.01");
    expect(q(".mark")).not.toBeNull();
    // pack items cannot be deleted
    expect(q(".danger")).toBeNull();
    await act(() => q<HTMLButtonElement>(".sheet .ghost").click());
    await flush();
    expect(docs.find((d) => d.id === "cpp-string")?.override).toBeNull();
    expect(q(".mark")).toBeNull();
  });

  it("adds a custom item and deletes it only after confirmation", async () => {
    q<HTMLDetailsElement>("details.add").open = true;
    const title = q<HTMLInputElement>("#add-title");
    title.value = "Устная String";
    await act(() => { title.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(() => { q<HTMLFormElement>(".add form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const added = docs.find((d) => d.custom === true);
    expect(added).toMatchObject({ title: "Устная String", subject: "cpp", status: "не начато" });
    // open the custom group and its editor
    for (const d of qa("details.group") as HTMLDetailsElement[]) { d.open = true; d.dispatchEvent(new Event("toggle")); }
    await flush();
    const btn = (qa(".group button.open-row") as HTMLButtonElement[]).find((b) => b.textContent?.includes("Устная String"))!;
    await act(() => btn.click());
    await flush();
    await act(() => q<HTMLButtonElement>(".danger").click());
    await flush();
    expect(docs.some((d) => d.id === added!.id)).toBe(true);
    await act(() => q<HTMLButtonElement>(".danger").click());
    await flush();
    expect(docs.some((d) => d.id === added!.id)).toBe(false);
  });

  it("single problems have a solved checkbox instead of statuses, in the row and in the card", async () => {
    const box = q<HTMLButtonElement>('button.check[role="checkbox"]');
    expect(box.getAttribute("aria-checked")).toBe("false");
    await act(() => box.click());
    expect(q('button.check[role="checkbox"]').getAttribute("aria-checked")).toBe("true");
    await flush();
    expect(docs.find((d) => d.id === "cpp-p1")?.status).toBe("принято");
    const row = (qa(".group button.open-row") as HTMLButtonElement[]).find((b) => b.textContent?.includes("С 1.1"))!;
    await act(() => row.click());
    expect(q(".sheet .sh-status")).toBeNull();
    expect(q(".sheet #sc-cpp-p1")).toBeNull(); // no score or dates for a single problem
    await act(() => q<HTMLButtonElement>(".sheet button.check.big").click());
    await flush();
    expect(docs.find((d) => d.id === "cpp-p1")?.status).toBe("не начато");
  });
});
