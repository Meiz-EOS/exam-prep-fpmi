import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { isCheckKind, KINDS } from "../../../core/kinds";
import { mergeView, type ViewItem } from "../../../core/merge";
import { overlayPending, reflects } from "../../../core/pending";
import { CHECKED, type Status, UNCHECKED } from "../../../core/status";
import { DataCtx, useData } from "../../context";
import { t } from "../../i18n";
import { Sheet } from "../../sheet";
import { dueText, shortDate } from "./format";
import { dueOf } from "../../../core/dates";
import { activeDue } from "../../../core/hot";
import { Sdachi } from "./index";
import { SolvedBox, StatusChoice, StatusPill } from "./status-menu";

type Write = (id: string, patch: Record<string, unknown>) => void;

/** Sdachi with editing: status menu, item card (bottom sheet), add/delete own items; changes show at once. */
export function SdachiEditable() {
  const data = useData();
  const { pack, store, canWrite, onError } = data;
  const ro = !store || !canWrite;

  // Unconfirmed writes (id → merged patch), shown on top of the stored documents
  // until a snapshot arrives after the store confirmed them.
  const pend = useRef(new Map<string, Record<string, unknown>>());
  const confirmed = useRef(new Set<Record<string, unknown>>());
  const [ver, setVer] = useState(0);
  const bump = () => setVer((v) => v + 1);
  const latest = useRef(data.docs);
  latest.current = data.docs;
  useEffect(() => {
    if (!confirmed.current.size) return;
    for (const [id, p] of pend.current) if (confirmed.current.has(p)) pend.current.delete(id);
    confirmed.current.clear();
    bump();
  }, [data.docs]);

  const [sticky, setSticky] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ msg: string; run: () => void } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const write: Write = (id, patch) => {
    if (!store) return;
    const mine = { ...(pend.current.get(id) ?? {}), ...patch };
    pend.current.set(id, mine);
    bump();
    store.update("items", id, patch).then(
      () => {
        // The snapshot may have arrived before the promise: then drop the overlay now, else on the next snapshot.
        if (pend.current.get(id) !== mine) return;
        if (reflects(latest.current.find((d) => d.id === id), mine)) { pend.current.delete(id); bump(); }
        else confirmed.current.add(mine);
      },
      (e) => {
        if (pend.current.get(id) === mine) pend.current.delete(id);
        bump();
        setUndo(null);
        onError(e);
      },
    );
  };

  const docs = useMemo(() => overlayPending(data.docs, pend.current), [data.docs, ver]);
  const view = useMemo(() => mergeView(pack, docs), [pack, docs]);
  const open = openId ? view.items.find((i) => i.id === openId) ?? view.orphans.find((i) => i.id === openId) : undefined;

  const setStatus = (it: ViewItem, s: Status) => {
    const prev = it.status;
    write(it.id, { status: s });
    setSticky((x) => new Set(x).add(it.id));
    clearTimeout(undoTimer.current);
    setUndo({ msg: t.statusChanged(it.title, t.status[s] ?? s), run: () => write(it.id, { status: prev }) });
    undoTimer.current = setTimeout(() => setUndo(null), 4000);
  };

  return (
    <DataCtx.Provider value={{ ...data, docs }}>
      <Sdachi
        extras={{
          renderStatus: (it) => isCheckKind(it.kind)
            ? <SolvedBox status={it.status} onToggle={ro ? undefined : (on) => write(it.id, { status: on ? CHECKED : UNCHECKED })} />
            : <StatusPill status={it.status} onPick={ro ? undefined : (s) => setStatus(it, s)} />,
          onOpen: (it) => setOpenId(it.id),
          sticky,
          footer: ro ? null : <AddForm />,
        }}
      />
      {open && (
        <Sheet title={open.title} sub={<ItemSub item={open} />} onClose={() => setOpenId(null)}>
          <Editor item={open} ro={ro} write={write} setStatus={(s) => setStatus(open, s)} onDone={() => setOpenId(null)} />
        </Sheet>
      )}
      {undo && (
        <div class="toast undo" role="status">
          <span>{undo.msg}</span>
          <button type="button" onClick={() => { undo.run(); setUndo(null); }}>{t.undo}</button>
        </div>
      )}
    </DataCtx.Provider>
  );
}

function ItemSub({ item }: { item: ViewItem }) {
  const { pack, today } = useData();
  const due = activeDue(item, today);
  // Handed in: the deadline no longer counts, show it as a plain date.
  const past = due ? null : dueOf(item, today);
  const subj = pack.subjects.find((s) => s.id === item.subject)?.name ?? item.subject;
  return <>{[subj, item.group, due ? dueText(due, t) : past ? t.dueWas(shortDate(past.date)) : null].filter(Boolean).join(" · ")}</>;
}

function Editor({ item, ro, write, setStatus, onDone }: {
  item: ViewItem; ro: boolean; write: Write; setStatus: (s: Status) => void; onDone: () => void;
}) {
  const { store, onError } = useData();
  const [armed, setArmed] = useState(false);
  const id = item.id;
  const isCustom = item.source === "custom";
  // Pack items keep catalog fields in the pack; phone edits go to `override` (Р-4).
  const setCatalog = (field: "soft" | "hard" | "title", value: string) => {
    const v = value.trim() || null;
    if (isCustom) write(id, { [field]: v });
    // null (not undefined) so a cleared field replaces the old value under the store's recursive merge.
    else write(id, { override: { ...(item.override ?? {}), [field]: v } });
  };
  const upd = item.updatedAt ? new Date(item.updatedAt) : null;
  return (
    <>
      {isCheckKind(item.kind)
        ? <SolvedBox big status={item.status} onToggle={ro ? undefined : (on) => write(id, { status: on ? CHECKED : UNCHECKED })} />
        : <StatusChoice status={item.status} onPick={setStatus} disabled={ro} />}
      {item.packNote && <div class="pack-note">{item.packNote}</div>}
      <div class="edit">
        {!isCheckKind(item.kind) && <>
        <label>{t.fScore}
          <input id={`sc-${id}`} inputMode="decimal" disabled={ro} value={item.score ?? ""}
            onChange={(e) => { const v = e.currentTarget.value.trim(); const n = Number(v.replace(",", ".")); write(id, { score: v === "" ? null : Number.isFinite(n) ? n : v }); }} />
        </label>
        <label>{t.fSoft}
          <input id={`sf-${id}`} type="date" disabled={ro} value={item.soft ?? ""} onChange={(e) => setCatalog("soft", e.currentTarget.value)} />
        </label>
        <label>{t.fHard}
          <input id={`hd-${id}`} type="date" disabled={ro} value={item.hard ?? ""} onChange={(e) => setCatalog("hard", e.currentTarget.value)} />
        </label>
        </>}
        <label class="wide">{t.fTitle}
          <input id={`ti-${id}`} disabled={ro} value={item.title} onChange={(e) => setCatalog("title", e.currentTarget.value)} />
        </label>
        <label class="wide">{t.fNote}
          <textarea id={`nt-${id}`} disabled={ro} value={item.note ?? ""} onChange={(e) => write(id, { note: e.currentTarget.value.trim() || null })} />
        </label>
      </div>
      <div class="acts">
        <span>{upd && !Number.isNaN(upd.getTime()) ? t.changedAt(upd.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })) : t.savedAtOnce}</span>
        <span class="acts-btns">
          {!isCustom && item.override && (
            <button type="button" class="ghost" disabled={ro} onClick={() => write(id, { override: null })}>{t.resetOverride}</button>
          )}
          {isCustom && (
            <button type="button" class="danger" disabled={ro} onClick={() => {
              if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
              onDone();
              store?.remove("items", id).catch(onError);
            }}>{armed ? t.delConfirm : t.del}</button>
          )}
          <button type="button" class="primary" onClick={onDone}>{t.done}</button>
        </span>
      </div>
    </>
  );
}

function AddForm() {
  const { pack, store, onError } = useData();
  const [f, setF] = useState({ subject: pack.subjects[0]?.id ?? "", kind: "кр", title: "", group: "", soft: "", hard: "" });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });
  return (
    <details class="add">
      <summary>{t.addTitle}</summary>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!store || !f.title.trim()) return;
        store.create("items", {
          custom: true, subject: f.subject, kind: f.kind, title: f.title.trim(), group: f.group.trim() || null,
          soft: f.soft || null, hard: f.hard || null, status: "не начато",
        }).then(() => setF({ ...f, title: "", soft: "", hard: "" })).catch(onError);
      }}>
        <label>{t.fSubject}<select id="add-subject" value={f.subject} onChange={set("subject")}>
          {pack.subjects.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}
        </select></label>
        <label>{t.fKind}<select id="add-kind" value={f.kind} onChange={set("kind")}>
          {KINDS.map((k) => <option value={k} key={k}>{k}</option>)}
        </select></label>
        <label class="wide">{t.fTitle}<input id="add-title" required value={f.title} onInput={set("title")} /></label>
        <label class="wide">{t.fGroup}<input id="add-group" list="add-groups" value={f.group} onInput={set("group")} /></label>
        <datalist id="add-groups">{[...new Set(pack.items.map((i) => i.group))].map((g) => <option value={g} key={g} />)}</datalist>
        <label>{t.fSoft}<input id="add-soft" type="date" value={f.soft} onInput={set("soft")} /></label>
        <label>{t.fHard}<input id="add-hard" type="date" value={f.hard} onInput={set("hard")} /></label>
        <div class="wide"><button class="primary" type="submit">{t.addBtn}</button></div>
      </form>
    </details>
  );
}
