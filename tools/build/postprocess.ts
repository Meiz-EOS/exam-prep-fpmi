// claude.ai wraps a published file in its own <!doctype><html><head><body> skeleton,
// so the page must be content only: <title>, metas and styles first, then the body.
// Usage: node tools/build/postprocess.ts dist/claude/index.html
import { readFileSync, writeFileSync } from "node:fs";

export function unwrapDocument(html: string): string {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  // The platform's skeleton already sets charset and viewport.
  const keep = head
    .replace(/<meta\s+charset[^>]*>\s*/gi, "")
    .replace(/<meta\s+name="viewport"[^>]*>\s*/gi, "")
    .trim();
  const title = /<title>[\s\S]*?<\/title>/i.exec(keep)?.[0] ?? "";
  const rest = keep.replace(title, "").trim();
  return `${title}\n${rest}\n${body.trim()}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: postprocess.ts <file>");
  writeFileSync(path, unwrapDocument(readFileSync(path, "utf8")));
}
