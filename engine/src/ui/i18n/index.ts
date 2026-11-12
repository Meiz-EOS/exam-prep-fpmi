import { en } from "./en";
import { ru, type Strings } from "./ru";

export type Lang = "ru" | "en";

/** UI language from the system: ru* → ru, anything else → en. Pack content is never translated. */
export function pickLang(languages: readonly string[]): Lang {
  return languages[0]?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function strings(lang: Lang): Strings {
  return lang === "ru" ? ru : en;
}

const lang: Lang = pickLang(typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : ["ru"]);
export const t: Strings = strings(lang);
export type { Strings };
