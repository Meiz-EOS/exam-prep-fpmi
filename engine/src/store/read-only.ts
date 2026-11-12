import { type ProgressStore, StoreError } from "./types";

/** Wraps a store so it only reads: the frozen claude.ai page after the move to the PC (07-standalone.md#migration). */
export function readOnly(inner: ProgressStore): ProgressStore {
  const deny = () => Promise.reject(new StoreError("read_only"));
  return {
    subscribe: (col, next, error) => inner.subscribe(col, next, error),
    update: deny,
    create: deny,
    remove: deny,
    canWrite: async () => false,
  };
}
