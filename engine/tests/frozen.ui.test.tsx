// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import type { BuiltPack } from "../src/content/schema";
import { MemoryStore } from "../src/store/memory";
import { readOnly } from "../src/store/read-only";
import { Root } from "../src/ui/root";
import { SdachiEditable } from "../src/ui/modules/sdachi/edit";

const pack: BuiltPack = {
  id: "t", title: "T", subjects: [{ id: "cpp", name: "C++" }], exams: [],
  items: [{ id: "cpp-string", subject: "cpp", group: "C++ задачи", kind: "задача-cpp", title: "String", soft: "2099-01-10" }],
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("frozen claude.ai page", () => {
  it("readOnly() passes reads and rejects writes", async () => {
    const s = readOnly(new MemoryStore({ items: [{ id: "a", status: "сдано" }] }));
    const seen: unknown[] = [];
    s.subscribe("items", (snap) => seen.push(snap.docs), () => {});
    await flush();
    expect(seen.at(-1)).toEqual([{ id: "a", status: "сдано" }]);
    await expect(s.update("items", "a", { status: "принято" })).rejects.toMatchObject({ code: "read_only" });
    await expect(s.create("attempts", {})).rejects.toMatchObject({ code: "read_only" });
    expect(await s.canWrite()).toBe(false);
  });

  it("shows the moved banner with the date and no status menu", async () => {
    const root = document.createElement("div");
    document.body.replaceChildren(root);
    const store = readOnly(new MemoryStore({ items: [{ id: "cpp-string", status: "сдано" }] }));
    await act(() => {
      render(<Root pack={pack} connect={async () => store} frozen="09.11.2026"
        modules={[{ id: "sdachi", title: "S", component: SdachiEditable }]} />, root);
    });
    await flush();
    const banner = root.querySelector(".banner")?.textContent ?? "";
    expect(banner).toContain("09.11.2026");
    expect(banner).not.toBe("");
    expect(root.querySelector("button.pill")).toBeNull();
    expect(root.querySelector(".pill")).not.toBeNull();
  });
});
