// Binds the APK store to @capacitor/filesystem and the export to @capacitor/share (11-apk.md#adapter, #ui).
// Imported only from store/apk.ts, which only the "apk" build loads.
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { Disk } from "./capacitor";

const DATA = Directory.Data;

async function exists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: DATA });
    return true;
  } catch {
    return false;
  }
}

export const capacitorDisk: Disk = {
  async read(path) {
    try {
      const r = await Filesystem.readFile({ path, directory: DATA, encoding: Encoding.UTF8 });
      return typeof r.data === "string" ? r.data : await r.data.text();
    } catch (e) {
      if (!(await exists(path))) return null;
      throw e;
    }
  },
  async write(path, text) {
    await Filesystem.writeFile({ path, directory: DATA, data: text, encoding: Encoding.UTF8, recursive: true });
  },
  async rename(from, to) {
    await Filesystem.rename({ from, to, directory: DATA, toDirectory: DATA });
  },
  async remove(path) {
    await Filesystem.deleteFile({ path, directory: DATA });
  },
  async list(dir) {
    try {
      return (await Filesystem.readdir({ path: dir, directory: DATA })).files.map((f) => f.name);
    } catch {
      return [];
    }
  },
};

/** Export on the phone: a file in the app cache handed to the system share sheet (→ Telegram → Saved Messages). */
export async function shareFile(name: string, text: string): Promise<void> {
  const { uri } = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: text, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: name, files: [uri] });
  } catch (e) {
    // Closing the share sheet without choosing an app is not an error.
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}
