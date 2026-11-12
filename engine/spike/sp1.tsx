import "../src/store/claude-db";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";


function Probe() {
  const [lines, setLines] = useState<string[]>(["module script: ran"]);
  useEffect(() => {
    const add = (s: string) => setLines((l) => [...l, s]);
    add(`title: ${document.title}`);
    add(`window.claude.use: ${typeof window.claude?.use}`);
    (async () => {
      const db = window.claude?.use ? ((await window.claude.use("db")) as any) : null;
      add(`db: ${db ? "ok" : "null"}`);
      if (!db) return;
      try {
        await db.collection("probe").doc("sp1").set({
          moduleRan: true, title: document.title, at: new Date().toISOString(),
          ua: navigator.userAgent, width: window.innerWidth,
        });
        add("probe write: ok");
      } catch (e: any) { add(`probe write: ${e?.code ?? e}`); }
    })();
  }, []);
  return (
    <main style={{ padding: "16px", font: "15px system-ui, sans-serif", background: "#13161d", color: "#e4e7ef", minHeight: "100vh" }}>
      <h1>Зачётка · SP-1</h1>
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </main>
  );
}
const root = document.getElementById("app");
if (root) render(<Probe />, root);
