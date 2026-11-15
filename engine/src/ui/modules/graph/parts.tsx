import type { TopicState } from "../../../core/graph";
import { t } from "../../i18n";
import "./graph.css";

/** Topic state as a small coloured label. */
export function StateBadge({ state }: { state: TopicState }) {
  return <span class={`gstate gstate-${state}`}>{t.topicState[state]}</span>;
}

/** One-of-many chips (the subject of the plan, of the map). */
export function Chips({ label, options, value, onChange, disabled }: {
  label: string; options: readonly { id: string; name: string }[]; value: string | null; onChange: (id: string) => void; disabled?: boolean;
}) {
  if (options.length < 2) return null;
  return <div class="bar gchips" role="group" aria-label={label}>
    {options.map((option) => <button type="button" class="chip" key={option.id} aria-pressed={option.id === value ? "true" : "false"} disabled={disabled && option.id !== value} onClick={() => onChange(option.id)}>{option.name}</button>)}
  </div>;
}
