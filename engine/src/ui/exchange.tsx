// ⇅ button and exchange sheet (docs/architecture/11-apk.md#ui).
import { useState } from "preact/hooks";
import { ExchangeError, type ExchangeFile, isExchangeCapable, parseExchange, planImport, type ImportPlan } from "../core/exchange";
import { useData } from "./context";
import { t } from "./i18n";
import { loadPref, savePref } from "./prefs";
import { Sheet } from "./sheet";

/** Saves the exported file. Browser default: download; the APK replaces it with Share (W10-08). */
export type SaveFile = (name: string, text: string) => Promise<void>;

async function download(name: string, text: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

let saveFile: SaveFile = download;
let saveLabel: "save" | "share" = "save";

/** Lets a platform (APK) replace how the export is handed over. */
export function setSaveFile(fn: SaveFile, label: "save" | "share" = "share"): void {
  saveFile = fn;
  saveLabel = label;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function exchangeFileName(pack: string, d = new Date()): string {
  return `zachetka-${pack}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

function when(iso: string | null): string {
  if (!iso) return t.xchNever;
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : t.xchNever;
}

function errorText(e: unknown): string {
  if (e instanceof ExchangeError) return e.code === "other_pack" ? t.xchOtherPack : t.xchNotFile;
  return t.notSaved;
}

type Pending = { file: ExchangeFile; plan: ImportPlan };

export function ExchangeButton() {
  const { store, pack, canWrite } = useData();
  const [open, setOpen] = useState(false);
  if (!isExchangeCapable(store) || !canWrite) return null;
  return (
    <>
      <button type="button" class="xch-btn" aria-label={t.xchTitle} title={t.xchTitle} onClick={() => setOpen(true)}>⇅</button>
      {open && <ExchangeSheet pack={pack.id} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExchangeSheet({ pack, onClose }: { pack: string; onClose: () => void }) {
  const { store } = useData();
  const ex = isExchangeCapable(store) ? store : null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [last, setLast] = useState(() => loadPref<{ export: string | null; import: string | null }>("exchange", { export: null, import: null }));
  const stamp = (k: "export" | "import") => {
    const next = { ...last, [k]: new Date().toISOString() };
    setLast(next);
    savePref("exchange", next);
  };
  if (!ex) return null;

  const doExport = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const file = await ex.exportFile();
      await saveFile(exchangeFileName(pack), `${JSON.stringify(file, null, 1)}\n`);
      stamp("export");
      setMsg({ text: t.xchExported });
    } catch (e) {
      setMsg({ text: errorText(e), err: true });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    setBusy(true);
    setMsg(null);
    setPending(null);
    try {
      let value: unknown;
      try {
        value = JSON.parse(await f.text());
      } catch {
        throw new ExchangeError("not_exchange", "not JSON");
      }
      const file = parseExchange(value, pack);
      const current = await ex.exportFile();
      setPending({ file, plan: planImport(current.collections, file) });
    } catch (e) {
      setMsg({ text: errorText(e), err: true });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const s = await ex.importFile(pending.file);
      stamp("import");
      setPending(null);
      setMsg({ text: t.xchImported(s.added, s.updated) });
    } catch (e) {
      setMsg({ text: errorText(e), err: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={t.xchTitle} onClose={onClose}>
      <p class="xch-hint">{t.xchHint}</p>
      <div class="xch-row">
        <button type="button" class="primary big" disabled={busy} onClick={doExport}>
          {saveLabel === "share" ? t.xchShare : t.xchSave}
        </button>
        <span class="meta">{t.xchLastExport(when(last.export))}</span>
      </div>
      <div class="xch-row">
        <label class={busy ? "ghost xch-pick disabled" : "ghost xch-pick"}>
          {t.xchLoad}
          <input type="file" accept=".json,application/json" disabled={busy}
            onChange={(e) => void pick(e.currentTarget)} />
        </label>
        <span class="meta">{t.xchLastImport(when(last.import))}</span>
      </div>
      {pending && (
        <div class="xch-confirm" role="alert">
          <p>{t.xchPlan(when(pending.file.exportedAt), pending.plan.added, pending.plan.updated, pending.plan.kept)}</p>
          <div class="xch-acts">
            <button type="button" class="ghost" disabled={busy} onClick={() => setPending(null)}>{t.xchCancel}</button>
            <button type="button" class="primary" disabled={busy || !pending.plan.writes.length} onClick={apply}>{t.xchApply}</button>
          </div>
        </div>
      )}
      {msg && <p class={msg.err ? "xch-msg err" : "xch-msg"} role="status">{msg.text}</p>}
    </Sheet>
  );
}
