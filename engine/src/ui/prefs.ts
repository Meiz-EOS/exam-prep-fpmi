/** Per-device conveniences only (filter, open groups); storage may be missing. */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`zachetka.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`zachetka.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
