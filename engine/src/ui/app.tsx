import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ExchangeButton } from "./exchange";
import { t } from "./i18n";
import { routeFromHash } from "./router";
import "./theme.css";

export type ConnState = "loading" | "ok" | "offline" | "stale" | "no_store" | "read_only" | "frozen" | "revoked" | "dev";

export interface ModuleDef {
  id: string;
  title: string;
  component: ComponentType;
}

const BANNER: Partial<Record<ConnState, { text: string; err?: boolean }>> = {
  loading: { text: t.loading },
  offline: { text: t.offline, err: true },
  stale: { text: t.stale, err: true },
  no_store: { text: t.noStore, err: true },
  read_only: { text: t.readOnly },
  revoked: { text: t.revoked, err: true },
  dev: { text: t.devStore },
};

export function App({ modules, conn, frozen }: { modules: ModuleDef[]; conn: ConnState; frozen?: string }) {
  const ids = modules.map((m) => m.id);
  const [route, setRoute] = useState(() => routeFromHash(location.hash, ids));
  useEffect(() => {
    const on = () => setRoute(routeFromHash(location.hash, ids));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [ids.join()]);
  const active = modules.find((m) => m.id === route);
  const banner = conn === "frozen" ? { text: t.frozen(frozen ?? ""), err: false } : BANNER[conn];
  return (
    <div class="app">
      <header class="topbar">
        <h1>{t.appTitle}</h1>
        {modules.length > 1 && (
          <nav class="nav">
            {modules.map((m) => (
              <a href={`#${m.id}`} aria-current={m.id === route ? "page" : undefined}>{m.title}</a>
            ))}
          </nav>
        )}
        <ExchangeButton />
      </header>
      {banner && <div class={banner.err ? "banner err" : "banner"} role="status">{banner.text}</div>}
      {active ? <active.component /> : <p class="banner">{t.moduleSoon}</p>}
    </div>
  );
}
