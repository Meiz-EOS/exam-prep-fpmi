import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { BuiltPack } from "../content/schema";
import type { ISODate } from "../core/dates";
import type { ProgressDoc } from "../core/merge";
import type { ProgressStore } from "../store/types";

export interface AppData {
  pack: BuiltPack;
  store: ProgressStore | null;
  docs: ProgressDoc[];
  loaded: boolean;
  canWrite: boolean;
  today: ISODate;
  /** Report a failed write; the root decides what to show. */
  onError: (e: unknown) => void;
}

export const DataCtx = createContext<AppData | null>(null);

export function useData(): AppData {
  const d = useContext(DataCtx);
  if (!d) throw new Error("DataCtx missing");
  return d;
}
