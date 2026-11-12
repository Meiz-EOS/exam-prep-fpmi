import type { ProgressDoc } from "./merge.ts";

/** Writes sent but not yet confirmed: document id → merged patch. */
export type Pending = ReadonlyMap<string, Record<string, unknown>>;

/**
 * Show unconfirmed writes at once: top-level fields of each patch replace the stored ones,
 * `null` removes a field. A patch for an unknown id adds the document.
 */
export function overlayPending(docs: readonly ProgressDoc[], pending: Pending): ProgressDoc[] {
  if (pending.size === 0) return docs as ProgressDoc[];
  const apply = (doc: ProgressDoc, patch: Record<string, unknown>): ProgressDoc => {
    const out: ProgressDoc = { ...doc };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
    return out;
  };
  const seen = new Set<string>();
  const out = docs.map((d) => {
    const p = pending.get(d.id);
    if (!p) return d;
    seen.add(d.id);
    return apply(d, p);
  });
  for (const [id, p] of pending) if (!seen.has(id)) out.push(apply({ id }, p));
  return out;
}

/** True when the stored document already shows every field of the patch (`null` = field absent). */
export function reflects(doc: ProgressDoc | undefined, patch: Record<string, unknown>): boolean {
  return Object.entries(patch).every(([k, v]) =>
    v === null ? doc?.[k] === undefined || doc?.[k] === null : JSON.stringify(doc?.[k]) === JSON.stringify(v));
}
