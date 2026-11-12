import { describe, expect, it } from "vitest";
import { startServer } from "./server";
import { dataRoot, desktopEntry } from "./standalone";

describe("single-file build", () => {
  it("keeps data in the per-user folder of each OS", () => {
    expect(dataRoot("linux", {}, "/h/u")).toBe("/h/u/.local/share/zachetka");
    expect(dataRoot("linux", { XDG_DATA_HOME: "/x" }, "/h/u")).toBe("/x/zachetka");
    expect(dataRoot("darwin", {}, "/m/u")).toBe("/m/u/Library/Application Support/zachetka");
  });

  it("quotes the executable path in the menu shortcut", () => {
    expect(desktopEntry('/h/u/My "Apps"/zachetka')).toContain('Exec="/h/u/My \\"Apps\\"/zachetka"');
  });

  it("serves the embedded page without a dist folder", async () => {
    const html = new TextEncoder().encode("<!doctype html><title>Embedded</title>");
    const { port, close } = await startServer({ port: 0, pack: "p", data: "/nonexistent", dist: "", html });
    try {
      const text = await (await fetch(`http://127.0.0.1:${port}/`)).text();
      expect(text).toContain("Embedded");
    } finally {
      await close();
    }
  });
});
