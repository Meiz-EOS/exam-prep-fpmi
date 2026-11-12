import { render } from "preact";
import pack from "virtual:pack";
import { ClaudeDbStore } from "./store/claude-db";
import { HttpStore } from "./store/http";
import { readOnly } from "./store/read-only";
import { MemoryStore } from "./store/memory";
import type { ProgressStore } from "./store/types";
import type { ModuleDef } from "./ui/app";
import { t } from "./ui/i18n";
import { SdachiEditable } from "./ui/modules/sdachi/edit";
import { Tests } from "./ui/modules/tests";
import { Ready } from "./ui/modules/ready";
import { Today } from "./ui/modules/today";
import { Theory } from "./ui/modules/theory";
import { Root } from "./ui/root";

const modules: ModuleDef[] = [
  { id: "today", title: t.navToday, component: Today },
  ...(pack.tickets?.length ? [{ id: "theory", title: t.navTheory, component: Theory }] : []),
  { id: "sdachi", title: t.navSdachi, component: () => <SdachiEditable /> },
  // The nav entry exists only when the pack has tests.
  ...(pack.tests?.length ? [{ id: "tests", title: t.navTests, component: Tests }] : []),
  ...(pack.tickets?.length ? [{ id: "ready", title: t.navReady, component: Ready }] : []),
];

// Frozen claude.ai page: VITE_FROZEN holds the date of the move (07-standalone.md#migration).
const FROZEN: string | undefined = import.meta.env.VITE_FROZEN || undefined;

async function connect(): Promise<ProgressStore | null> {
  if (import.meta.env.DEV) {
    // Local development only: empty progress in memory. Stripped from production builds.
    return new MemoryStore();
  }
  // The build mode picks the adapter; the other one is dropped from the bundle.
  if (import.meta.env.MODE === "pc") return new HttpStore();
  if (import.meta.env.MODE === "apk") return (await import("./store/apk")).connectApk(pack.id);
  const store = await ClaudeDbStore.connect();
  return store && FROZEN ? readOnly(store) : store;
}

const root = document.getElementById("app");
if (root) render(<Root pack={pack} connect={connect} modules={modules} dev={import.meta.env.DEV} frozen={FROZEN} />, root);
