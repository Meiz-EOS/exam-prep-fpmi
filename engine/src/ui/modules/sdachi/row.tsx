import type { ComponentChildren } from "preact";
import { activeDue } from "../../../core/hot";
import { isCheckKind } from "../../../core/kinds";
import type { ViewItem } from "../../../core/merge";
import { useData } from "../../context";
import { t } from "../../i18n";
import { dueClass, dueText, rowMeta } from "./format";
import { SolvedBox, StatusPill } from "./status-menu";

/** One item line: status pill (fixed width) + the rest of the row as one button that opens the item card. */
export function ItemRow({ item, context, status, onOpen }: {
  item: ViewItem;
  /** Show subject and group (used in the "due soon" block). */
  context?: string;
  /** Interactive status control from the editing layer; read-only pill otherwise. */
  status?: ComponentChildren;
  onOpen?: () => void;
}) {
  const { today } = useData();
  // Only the deadline that still applies: a handed-in item shows no date and is never "overdue".
  const due = activeDue(item, today);
  const meta = rowMeta(item, t, context);
  const cls = dueClass(due);
  const inner = [
    <span class="txt" key="t">
      <span class="t">
        {item.title}
        {item.star && <span class="star" title={t.star}> *</span>}
        {item.override && <span class="mark"> · {t.overridden}</span>}
      </span>
      {meta.length > 0 && <span class="meta">{meta.join(" · ")}</span>}
    </span>,
    due ? <span key="d" class={`due ${cls}`}>{dueText(due, t)}</span> : <span key="d" />,
  ];
  return (
    <div class="item">
      <div class={isCheckKind(item.kind) ? "row check-row" : "row"}>
        {status ?? (isCheckKind(item.kind) ? <SolvedBox status={item.status} /> : <StatusPill status={item.status} />)}
        {onOpen
          ? <button class="open-row" type="button" aria-haspopup="dialog" onClick={onOpen}>{inner}<span class="chev" aria-hidden="true">›</span></button>
          : <div class="open-row static">{inner}</div>}
      </div>
    </div>
  );
}
