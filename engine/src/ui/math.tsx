// Text with $…$ (inline) and $$…$$ (display) formulas rendered by KaTeX.
// CSS and woff2 fonts are bundled into the single HTML (Р-8, 03-build.md#katex).
import katex from "katex";
import "katex/dist/katex.min.css";

type Part = { math: false; text: string } | { math: true; display: boolean; tex: string; src: string };

// `\$` outside a formula is a literal dollar sign.
const FORMULA = /\\\$|\$\$([\s\S]+?)\$\$|\$((?:\\.|[^$\\])+?)\$/g;

export function splitMath(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(FORMULA)) {
    if (m.index > last) parts.push({ math: false, text: text.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[0] === "\\$") { parts.push({ math: false, text: "$" }); continue; }
    const display = m[1] !== undefined;
    parts.push({ math: true, display, tex: (m[1] ?? m[2])!, src: m[0] });
  }
  if (last < text.length) parts.push({ math: false, text: text.slice(last) });
  return parts;
}

function renderTex(tex: string, display: boolean): string | null {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "html", trust: false });
  } catch {
    return null;
  }
}

export function Math({ text }: { text: string }) {
  return (
    <>
      {splitMath(text).map((p) => {
        if (!p.math) return p.text;
        const html = renderTex(p.tex, p.display);
        if (html === null) return <span class="math-error">{p.src}</span>;
        const Tag = p.display ? "div" : "span";
        return <Tag dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </>
  );
}
