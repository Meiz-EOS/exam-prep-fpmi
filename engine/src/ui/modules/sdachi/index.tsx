import { useMemo, useState } from "preact/hooks";
import { daysUntil } from "../../../core/dates";
import { hotList } from "../../../core/hot";
import { mergeView, type ViewItem } from "../../../core/merge";
import { nestGroups } from "../../../core/nest";
import { groupProgress } from "../../../core/progress";
import type { Status } from "../../../core/status";
import { DONE } from "../../../core/status";
import { useData } from "../../context";
import { t } from "../../i18n";
import { loadPref, savePref } from "../../prefs";
import { shortDate } from "./format";
import { ItemRow } from "./row";
import "./sdachi.css";

/** Hooks the editing layer (W1-10) plugs into; the view works without them. */
export interface RowExtras {
  renderStatus?: (item: ViewItem) => preact.ComponentChildren;
  /** Open the item card. */
  onOpen?: (item: ViewItem) => void;
  /** Items changed in this session: they stay in the "due soon" block even when done. */
  sticky?: ReadonlySet<string>;
  footer?: preact.ComponentChildren;
}

export function Sdachi({ extras = {} }: { extras?: RowExtras }) {
  const { pack, docs, today, loaded } = useData();
  const view = useMemo(() => mergeView(pack, docs), [pack, docs]);
  const [filter, setFilter] = useState<string>(() => loadPref("filter", "all"));
  const [hideDone, setHideDone] = useState<boolean>(() => loadPref("hideDone", false));
  const [openGroups, setOpenGroups] = useState<string[]>(() => loadPref("openGroups", []));

  const subjects = pack.subjects;
  const nameOf = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;
  const row = (it: ViewItem, key: string, context?: string) => (
    <ItemRow
      key={key}
      item={it}
      context={context}
      status={extras.renderStatus?.(it)}
      onOpen={extras.onOpen ? () => extras.onOpen!(it) : undefined}
    />
  );

  const setF = (f: string) => { setFilter(f); savePref("filter", f); };
  const toggleGroup = (k: string, open: boolean) => {
    const next = open ? [...new Set([...openGroups, k])] : openGroups.filter((x) => x !== k);
    setOpenGroups(next);
    savePref("openGroups", next);
  };

  const hot = hotList(view.items, today, extras.sticky ? (it) => extras.sticky!.has(it.id) : undefined);
  const shownSubjects = filter === "all" ? subjects.map((s) => s.id) : [filter];
  const extraSubjects = [...new Set(view.items.map((i) => i.subject))].filter((s) => !subjects.some((x) => x.id === s));

  return (
    <div class="sdachi">
      {view.exams.length > 0 && (
        <section class="exams" aria-label="exams">
          {view.exams.map((e) => {
            const n = daysUntil(today, e.date) ?? 0;
            return (
              <div class={n < 0 ? "exam done" : "exam"} key={e.id}>
                <span class="s">{e.title}</span>
                <span class="d num">{shortDate(e.date)}.{e.date.slice(0, 4)}</span>
                <span class="left num">{n < 0 ? (e.score !== undefined ? t.examScore(String(e.score)) : t.examPast) : n === 0 ? t.examToday : t.examIn(n)}</span>
              </div>
            );
          })}
        </section>
      )}

      <section class="hot" aria-labelledby="hot-h">
        <h2 id="hot-h">{t.hotTitle}</h2>
        {!loaded ? <p class="calm">…</p>
          : hot.length === 0 ? <p class="calm">{t.hotNone}</p>
          : <div class="list">{hot.map(({ item }) => row(item, `h:${item.id}`, `${nameOf(item.subject)} · ${item.group || item.kind}`))}</div>}
      </section>

      <div class="bar" role="toolbar" aria-label={t.filterLabel}>
        {["all", ...subjects.map((s) => s.id)].map((id) => (
          <button type="button" class="chip" aria-pressed={filter === id ? "true" : "false"} onClick={() => setF(id)} key={id}>
            {id === "all" ? t.filterAll : nameOf(id)}
          </button>
        ))}
        <label class="toggle">
          <input type="checkbox" id="hide-done" checked={hideDone} onChange={(e) => { const v = e.currentTarget.checked; setHideDone(v); savePref("hideDone", v); }} />
          {t.hideDone}
        </label>
      </div>

      {loaded && view.items.length === 0 && view.orphans.length === 0 && <p class="calm">{t.empty}</p>}

      {[...shownSubjects, ...(filter === "all" ? extraSubjects : [])].map((sid) => {
        const mine = view.items.filter((i) => i.subject === sid);
        if (!mine.length) return null;
        const groups = new Map<string, ViewItem[]>();
        for (const it of mine) {
          const g = it.source === "custom" && !it.group ? t.customGroup : it.group || t.customGroup;
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g)!.push(it);
        }
        // "hide submitted" hides whole assignments: submitted hand-in item, or nothing left to do.
        const nodes = nestGroups([...groups.keys()]).filter((node) => !hideDone || !groupDone(
          groups.get(node.name) ?? [], node.children.flatMap((c) => groups.get(c.name) ?? []),
        ));
        if (!nodes.length) return null;
        return (
          <section class="subject" key={sid}>
            <h3>{nameOf(sid)}</h3>
            {nodes.map((node) => {
              const own = groups.get(node.name) ?? [];
              const parts = node.children.map((c) => ({ ...c, list: groups.get(c.name) ?? [] }))
                .filter((c) => !hideDone || !c.list.every((i) => DONE.has(i.status)));
              // With parts (weeks), the header counts the parts' items; the group's own items (e.g. "submit") are rows on top.
              const counted = parts.length ? parts.flatMap((c) => c.list) : own;
              const gk = `${sid}:${node.name}`;
              const body = (list: ViewItem[]) => {
                const shown = hideDone ? list.filter((i) => !DONE.has(i.status)) : list;
                return shown.map((it) => row(it, `l:${it.id}`));
              };
              const ownRows = body(own);
              return (
                <details class="group" key={gk} open={openGroups.includes(gk)} onToggle={(e) => toggleGroup(gk, (e.currentTarget as HTMLDetailsElement).open)}>
                  <GroupHead label={node.label} statuses={counted.map((i) => i.status)} />
                  <div class="rows">
                    {ownRows}
                    {parts.map((c) => {
                      const ck = `${sid}:${c.name}`;
                      const rows = body(c.list);
                      return (
                        <details class="group sub" key={ck} open={openGroups.includes(ck)} onToggle={(e) => { e.stopPropagation(); toggleGroup(ck, (e.currentTarget as HTMLDetailsElement).open); }}>
                          <GroupHead label={c.label} statuses={c.list.map((i) => i.status)} />
                          <div class="rows">{rows.length ? rows : <p class="calm pad">{t.allDoneInGroup}</p>}</div>
                        </details>
                      );
                    })}
                    {!ownRows.length && !parts.length && <p class="calm pad">{t.allDoneInGroup}</p>}
                  </div>
                </details>
              );
            })}
          </section>
        );
      })}

      {filter === "all" && view.orphans.length > 0 && (
        <section class="subject">
          <h3>{t.orphansGroup}</h3>
          <div class="group open-static"><div class="rows">{view.orphans.map((it) => row(it, `o:${it.id}`))}</div></div>
        </section>
      )}
      {extras.footer}
    </div>
  );
}

/** An assignment is finished when its hand-in item (kind "дз") is submitted, or every item is. */
function groupDone(own: readonly ViewItem[], parts: readonly ViewItem[]): boolean {
  const all = [...own, ...parts];
  return own.some((i) => i.kind === "дз" && DONE.has(i.status)) || (all.length > 0 && all.every((i) => DONE.has(i.status)));
}

function GroupHead({ label, statuses }: { label: string; statuses: Status[] }) {
  const p = groupProgress(statuses);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return (
    <summary>
      <span class="gname">{label}</span>
      <span class="gcount num">{p.done}/{p.total}</span>
      <span class="gchev" aria-hidden="true">›</span>
      <span class="meter" aria-hidden="true">
        <i class="m-ok" style={{ width: pct(p.shares.accepted) }} />
        <i class="m-sent" style={{ width: pct(p.shares.submitted) }} />
        <i class="m-work" style={{ width: pct(p.shares.working) }} />
      </span>
    </summary>
  );
}
