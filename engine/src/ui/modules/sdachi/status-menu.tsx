import { useEffect, useRef, useState } from "preact/hooks";
import { DONE, type Status, STATUSES } from "../../../core/status";
import { t } from "../../i18n";

const label = (s: string) => t.status[s] ?? s;

/** Fixed-width status pill; read-only when `onPick` is absent. */
export function StatusPill({ status, onPick }: { status: Status; onPick?: (s: Status) => void }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = (refocus = true) => { setAt(null); if (refocus) btn.current?.focus(); };
  useEffect(() => {
    if (!at) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const onMove = () => close(false);
    addEventListener("keydown", onKey, true);
    addEventListener("scroll", onMove, { passive: true, capture: true });
    addEventListener("resize", onMove);
    return () => {
      removeEventListener("keydown", onKey, true);
      removeEventListener("scroll", onMove, { capture: true });
      removeEventListener("resize", onMove);
    };
  }, [at]);

  const body = [<span class="dot" key="d" />, <span class="lbl" key="l">{label(status)}</span>];
  if (!onPick) return <span class="pill" data-s={status}>{body}</span>;

  const open = () => {
    // Measure before any re-render can replace the button.
    const r = btn.current!.getBoundingClientRect();
    const h = STATUSES.length * 46 + 12, w = 200;
    const below = r.bottom + 6 + h <= innerHeight;
    setAt({
      left: Math.max(12, Math.min(r.left, innerWidth - w - 12)),
      top: below ? r.bottom + 6 : Math.max(12, r.top - h - 6),
    });
  };
  return (
    <>
      <button type="button" class="pill" data-s={status} ref={btn} aria-haspopup="true" aria-expanded={at ? "true" : "false"}
        aria-label={`${t.fStatus}: ${label(status)}. ${t.changeStatus}`} onClick={() => (at ? close() : open())}>
        {body}<span class="car" aria-hidden="true">▾</span>
      </button>
      {at && (
        <>
          <div class="veil" onClick={() => close()} />
          <div class="pop" role="radiogroup" aria-label={t.fStatus} ref={menu} style={{ left: `${at.left}px`, top: `${at.top}px` }}>
            {STATUSES.map((s) => (
              <button type="button" role="radio" key={s} data-s={s} aria-checked={s === status ? "true" : "false"}
                onClick={() => { close(); if (s !== status) onPick(s); }}>
                <span class="dot" />{label(s)}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** All statuses as a row of buttons (inside the item card). */
export function StatusChoice({ status, onPick, disabled }: { status: Status; onPick: (s: Status) => void; disabled?: boolean }) {
  return (
    <div class="sh-status" role="radiogroup" aria-label={t.fStatus}>
      {STATUSES.map((s) => (
        <button type="button" role="radio" class="opt" key={s} data-s={s} disabled={disabled} aria-checked={s === status ? "true" : "false"}
          onClick={() => { if (s !== status) onPick(s); }}>
          <span class="dot" /><span>{label(s)}</span>
        </button>
      ))}
    </div>
  );
}

/** "Solved" checkbox for single problems; read-only when `onToggle` is absent. */
export function SolvedBox({ status, onToggle, big }: { status: Status; onToggle?: (checked: boolean) => void; big?: boolean }) {
  const on = DONE.has(status);
  const mark = <span class="box" aria-hidden="true">{on ? "✓" : ""}</span>;
  if (!onToggle && !big) return <span class={on ? "check on" : "check"} role="img" aria-label={on ? t.solved : t.unsolved}>{mark}</span>;
  return (
    <button type="button" role="checkbox" aria-checked={on ? "true" : "false"} class={`check${on ? " on" : ""}${big ? " big" : ""}`}
      disabled={!onToggle} aria-label={t.solved} onClick={() => onToggle?.(!on)}>
      {mark}{big && <span>{t.solved}</span>}
    </button>
  );
}
