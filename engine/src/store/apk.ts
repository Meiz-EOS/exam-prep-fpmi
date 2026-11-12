import { setSaveFile } from "../ui/exchange";
import { CapacitorStore } from "./capacitor";
import { capacitorDisk, shareFile } from "./capacitor-disk";
import type { ProgressStore } from "./types";

/** Store of the APK build (11-apk.md#adapter). Loaded only by dynamic import in mode "apk". */
export async function connectApk(pack: string): Promise<ProgressStore> {
  setSaveFile(shareFile, "share");
  return new CapacitorStore(capacitorDisk, pack);
}
