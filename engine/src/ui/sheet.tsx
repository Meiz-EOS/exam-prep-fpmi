import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { t } from "./i18n";

/** Panel sliding up from the bottom (item card). Closes on the shade, ✕ and Escape. */
export function Sheet({ title, sub, onClose, children }: {
  title: ComponentChildren;
  sub?: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => { removeEventListener("keydown", onKey); back?.focus?.(); };
  }, []);
  return (
    <>
      <div class="shade" onClick={onClose} />
      <div class="sheet" role="dialog" aria-modal="true" tabIndex={-1} ref={box}>
        <div class="sheet-in">
          <div class="grab" aria-hidden="true" />
          <div class="sh-head">
            <div class="sh-txt">
              <span class="sh-title">{title}</span>
              {sub && <span class="meta">{sub}</span>}
            </div>
            <button type="button" class="x" aria-label={t.close} onClick={onClose}>✕</button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
