// Exported tree for the public repo (docs/architecture/13-classmates.md#scrub, W12-08).
// Usage: node tools/release/export.ts OUT_DIR     (OUT_DIR must not exist; put it off NTFS)
//   1. `git archive HEAD` -> OUT_DIR (file modes from the index, so +x survives);
//   2. drop paths matching tools/release/exclude.txt;
//   3. docs/architecture/tasks/README.md -> only the current wave (past cards stay in the archive);
//   4. Markdown links to dropped files become plain text; any other broken relative link is an error
//      (packs/ is skipped: its LaTeX looks like links);
//   5. tools/release/audit.sh OUT_DIR must be clean.
// Exit: 0 ok, 1 broken links or audit hits, 2 usage error.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(import.meta.dirname, "../..");
const TASKS_README = "docs/architecture/tasks/README.md";
const CURRENT_WAVE = /^## Волна W12\b/m;

function globToRe(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${body}$`);
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p)];
  });
}

export function trimTasksReadme(text: string): string {
  const m = CURRENT_WAVE.exec(text);
  if (!m) throw new Error(`${TASKS_README}: no "## Волна W12" section`);
  return (
    "# Задачи\n\n" +
    "Карточки прошлых волн (W1…W11) остались в архиве автора и не публикуются; " +
    "что сделано — [CHANGELOG](../../../CHANGELOG.md) и документы [архитектуры](../README.md).\n\n" +
    text.slice(m.index)
  );
}

const LINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/** Unlinks links to `dropped` files; returns the new text and the links that point nowhere. */
export function fixLinks(
  file: string,
  text: string,
  exists: (p: string) => boolean,
  dropped: Set<string>,
): { text: string; broken: string[] } {
  const broken: string[] = [];
  const out = text.replace(LINK, (all, bang: string, label: string, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return all;
    const path = decodeURI(href.split("#")[0] ?? "");
    const target = join(dirname(file), path).replace(/\/$/, "");
    if (target.startsWith("..")) return all; // outside the repo (e.g. ../mipt/…): not ours to check
    if (exists(target)) return all;
    if (dropped.has(target) && !bang) return label;
    broken.push(`${file}: ${href}`);
    return all;
  });
  return { text: out, broken };
}

function main() {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node tools/release/export.ts OUT_DIR");
    process.exit(2);
  }
  const OUT = resolve(out);
  if (existsSync(OUT)) {
    console.error(`export: ${OUT} already exists`);
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  const sha = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const tar = execFileSync("git", ["-C", REPO, "archive", "--format=tar", "HEAD"], { maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", OUT], { input: tar, maxBuffer: 1 << 30 });

  const globs = readFileSync(join(REPO, "tools/release/exclude.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map(globToRe);
  const dropped = new Set<string>();
  for (const f of walk(OUT)) {
    if (globs.some((re) => re.test(f))) {
      rmSync(join(OUT, f));
      dropped.add(f);
    }
  }

  const readme = join(OUT, TASKS_README);
  writeFileSync(readme, trimTasksReadme(readFileSync(readme, "utf8")));

  const exists = (p: string) => existsSync(join(OUT, p));
  const broken: string[] = [];
  let unlinked = 0;
  // packs/: content with LaTeX like $[x^n](AB)$, not documentation links.
  for (const f of walk(OUT).filter((f) => f.endsWith(".md") && !f.startsWith("packs/"))) {
    const p = join(OUT, f);
    const before = readFileSync(p, "utf8");
    const r = fixLinks(f, before, exists, dropped);
    broken.push(...r.broken);
    if (r.text !== before) {
      unlinked += (before.match(LINK)?.length ?? 0) - (r.text.match(LINK)?.length ?? 0);
      writeFileSync(p, r.text);
    }
  }
  console.error(`export: ${sha.slice(0, 7)} -> ${OUT}; dropped ${dropped.size} file(s), unlinked ${unlinked} link(s)`);
  if (broken.length) {
    console.error(`export: ${broken.length} broken link(s):\n${broken.join("\n")}`);
    process.exit(1);
  }
  try {
    execFileSync(join(REPO, "tools/release/audit.sh"), [OUT], { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
