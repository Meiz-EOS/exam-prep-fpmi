// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { buildExchange, type Collections, type ExchangeFile, type ImportStats } from "../src/core/exchange";
import { MemoryStore } from "../src/store/memory";
import { exchangeFileName, setSaveFile } from "../src/ui/exchange";
import { Root } from "../src/ui/root";

const pack: BuiltPack = { id: "t", title: "T", subjects: [], exams: [], items: [] };
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** MemoryStore plus a scripted exchange capability. */
class XStore extends MemoryStore {
  imported: ExchangeFile[] = [];
  constructor(public cols: Collections) { super(); }
  async exportFile() { return buildExchange("t", this.cols, new Date("2026-11-11T20:00:00Z")); }
  async importFile(f: ExchangeFile): Promise<ImportStats> { this.imported.push(f); return { added: 1, updated: 0, kept: 0 }; }
}

async function mount(store: MemoryStore) {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  await act(() => { render(<Root pack={pack} connect={async () => store} modules={[{ id: "a", title: "A", component: () => null }]} />, root); });
  await flush();
  return root;
}

async function choose(root: HTMLElement, text: string) {
  const input = root.ownerDocument.querySelector<HTMLInputElement>(".xch-pick input")!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File([text], "p.json", { type: "application/json" })] });
  await act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
  await flush();
}

const open = async (root: HTMLElement) => {
  await act(() => { root.querySelector<HTMLButtonElement>(".xch-btn")!.click(); });
  await flush();
};
const goodFile = JSON.stringify(buildExchange("t", { items: [{ id: "n1", updatedAt: "2026-11-11T09:00:00.000Z" }] }));

afterEach(() => { document.body.replaceChildren(); });

describe("exchange sheet", () => {
  it("has no button for a store without exchange", async () => {
    const root = await mount(new MemoryStore());
    expect(root.querySelector(".xch-btn")).toBeNull();
  });

  it("a bad file shows an error and writes nothing", async () => {
    const store = new XStore({ items: [], attempts: [], meta: [] });
    const root = await mount(store);
    await open(root);
    await choose(root, "{not json");
    expect(document.querySelector(".xch-msg.err")?.textContent).toBeTruthy();
    await choose(root, JSON.stringify({ ...JSON.parse(goodFile), pack: "other" }));
    expect(document.querySelector(".xch-msg.err")?.textContent).toMatch(/курс|course/);
    expect(document.querySelector(".xch-confirm")).toBeNull();
    expect(store.imported).toEqual([]);
  });

  it("a good file shows the counts; cancel writes nothing, apply imports", async () => {
    const store = new XStore({ items: [{ id: "o1", updatedAt: "2026-11-10T00:00:00.000Z" }], attempts: [], meta: [] });
    const root = await mount(store);
    await open(root);
    await choose(root, goodFile);
    expect(document.querySelector(".xch-confirm")?.textContent).toMatch(/1.*0.*0/);
    await act(() => { document.querySelector<HTMLButtonElement>(".xch-confirm .ghost")!.click(); });
    await flush();
    expect(store.imported).toEqual([]);
    await choose(root, goodFile);
    await act(() => { document.querySelector<HTMLButtonElement>(".xch-confirm .primary")!.click(); });
    await flush();
    expect(store.imported).toHaveLength(1);
    expect(document.querySelector(".xch-msg:not(.err)")?.textContent).toBeTruthy();
  });

  it("export hands the file to the platform saver", async () => {
    const saved: { name: string; text: string }[] = [];
    setSaveFile(async (name, text) => { saved.push({ name, text }); }, "save");
    const store = new XStore({ items: [{ id: "o1", updatedAt: "2026-11-10T00:00:00.000Z" }], attempts: [], meta: [] });
    const root = await mount(store);
    await open(root);
    await act(() => { document.querySelector<HTMLButtonElement>(".xch-row .primary")!.click(); });
    await flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toMatch(/^zachetka-t-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(JSON.parse(saved[0]!.text).collections.items[0].id).toBe("o1");
  });

  it("names files by local time", () => {
    vi.useFakeTimers();
    expect(exchangeFileName("igor-2026w", new Date(2026, 10, 11, 9, 5))).toBe("zachetka-igor-2026w-2026-11-11-0905.json");
    vi.useRealTimers();
  });
});
