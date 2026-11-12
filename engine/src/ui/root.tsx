import { useEffect, useMemo, useState } from "preact/hooks";
import type { BuiltPack } from "../content/schema";
import { localISODate } from "../core/dates";
import type { ProgressDoc } from "../core/merge";
import { type ProgressStore, StoreError } from "../store/types";
import { App, type ConnState, type ModuleDef } from "./app";
import { DataCtx } from "./context";
import { t } from "./i18n";

/** Connects the store once, keeps the item documents and the connection state. */
export function Root({ pack, connect, modules, dev, frozen }: {
  pack: BuiltPack;
  connect: () => Promise<ProgressStore | null>;
  modules: ModuleDef[];
  dev?: boolean;
  /** Date shown on the frozen claude.ai page; the store must then be read-only. */
  frozen?: string;
}) {
  const [store, setStore] = useState<ProgressStore | null>(null);
  const [docs, setDocs] = useState<ProgressDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [conn, setConn] = useState<ConnState>("loading");
  const [canWrite, setCanWrite] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    void (async () => {
      const s = await connect();
      if (!alive) return;
      if (!s) { setConn("no_store"); setCanWrite(false); setLoaded(true); return; }
      setStore(s);
      const w = await s.canWrite();
      if (w === false) setCanWrite(false);
      let confirmed = false;
      let haveData = false;
      timer = setTimeout(() => { if (!confirmed) setConn(haveData ? "stale" : "offline"); }, 10_000);
      unsub = s.subscribe("items", (snap) => {
        haveData = true;
        setDocs(snap.docs);
        setLoaded(true);
        if (!snap.fromCache) {
          confirmed = true;
          clearTimeout(timer);
          setConn(dev ? "dev" : frozen ? "frozen" : w === false ? "read_only" : "ok");
        }
      }, (e) => {
        clearTimeout(timer);
        setLoaded(true);
        setConn(e.code === "revoked" ? "revoked" : "offline");
      });
    })();
    return () => { alive = false; unsub?.(); clearTimeout(timer); };
  }, []);

  const onError = (e: unknown) => {
    const code = e instanceof StoreError ? e.code : "unavailable";
    if (code === "read_only") { setCanWrite(false); setConn(frozen ? "frozen" : "read_only"); }
    setToast(code === "read_only" ? t.readOnly : code === "quota" ? t.quota : t.notSaved);
    setTimeout(() => setToast(null), 3500);
  };

  const today = localISODate(new Date());
  const data = useMemo(() => ({ pack, store, docs, loaded, canWrite, today, onError }), [pack, store, docs, loaded, canWrite, today]);
  return (
    <DataCtx.Provider value={data}>
      <App modules={modules} conn={conn} frozen={frozen} />
      {toast && <div class="toast" role="status">{toast}</div>}
    </DataCtx.Provider>
  );
}
