// Keeps only the woff2 source of every KaTeX font: woff and ttf fallbacks would
// be inlined as data: URIs too and triple the font weight inside the HTML.
import type { Plugin } from "vite";

export function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id.split("?")[0] ?? "")) return null;
      return code.replace(/,url\([^)]*\.woff\) format\("woff"\),url\([^)]*\.ttf\) format\("truetype"\)/g, "");
    },
  };
}
