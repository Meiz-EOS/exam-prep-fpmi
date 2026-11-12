// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { MemoryStore } from "../src/store/memory";
import { Root } from "../src/ui/root";
import { SdachiEditable } from "../src/ui/modules/sdachi/edit";

const pack: BuiltPack = {
  id: "t", title: "T", subjects: [{ id: "aig", name: "АиГ" }, { id: "cpp", name: "C++" }], exams: [],
  items: [
    { id: "a1", subject: "aig", group: "АиГ задание 1", kind: "дз", title: "Задание 1: сдать тетрадь" },
    { id: "a2", subject: "aig", group: "АиГ задание 2", kind: "дз", title: "Задание 2: сдать тетрадь" },
    { id: "a2-1", subject: "aig", group: "АиГ задание 2 · неделя 1", kind: "дз-задача", title: "С 1.1" },
    { id: "a2-2", subject: "aig", group: "АиГ задание 2 · неделя 2", kind: "дз-задача", title: "С 2.1" },
    { id: "a3", subject: "aig", group: "АиГ задание 3", kind: "дз", title: "Задание 3: сдать тетрадь" },
    { id: "a3-1", subject: "aig", group: "АиГ задание 3 · неделя 1", kind: "дз-задача", title: "С 3.1" },
    { id: "c1", subject: "cpp", group: "C++ задачи", kind: "задача-cpp", title: "String" },
  ],
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount(hide: boolean) {
  localStorage.clear();
  localStorage.setItem("zachetka.hideDone", JSON.stringify(hide));
  const store = new MemoryStore({ items: [
    { id: "a1", status: "принято" },        // assignment 1 handed in → whole group goes
    { id: "a2-1", status: "принято" },      // week 1 done, week 2 not → week 1 goes, group stays
    { id: "a3", status: "сдано" },          // handed in, tasks unticked → whole group goes
    { id: "a3-1", status: "не начато" },
    { id: "c1", status: "сдано" },          // every item done → group and subject go
  ] });
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  await act(() => { render(<Root pack={pack} connect={async () => store} modules={[{ id: "s", title: "S", component: SdachiEditable }]} />, root); });
  await flush();
  const names = [...root.querySelectorAll("section.subject details.group > summary .gname")].map((e) => e.textContent);
  const subjects = [...root.querySelectorAll("section.subject h3")].map((e) => e.textContent);
  return { names, subjects };
}

describe("hide submitted", () => {
  it("shows everything when off", async () => {
    const { names, subjects } = await mount(false);
    expect(subjects).toEqual(["АиГ", "C++"]);
    expect(names.filter((n) => /задание [13]$/.test(n ?? ""))).toHaveLength(2);
  });

  it("hides finished assignments whole, finished weeks, and empty subjects", async () => {
    const { names, subjects } = await mount(true);
    expect(subjects).toEqual(["АиГ"]);
    expect(names.some((n) => /задание 1$/.test(n ?? ""))).toBe(false);
    expect(names.some((n) => /задание 3/.test(n ?? ""))).toBe(false);
    expect(names.some((n) => /задание 2$/.test(n ?? ""))).toBe(true);
    expect(names.some((n) => /неделя 1/.test(n ?? ""))).toBe(false);
    expect(names.some((n) => /неделя 2/.test(n ?? ""))).toBe(true);
  });
});
