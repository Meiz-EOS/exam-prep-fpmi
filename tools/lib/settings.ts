// Local settings of a clone (docs/architecture/13-classmates.md#settings).
// Order for each value: environment variable → zachetka.local.json → default.
//   pack       ZACH_PACK      "pack"        default: the only folder in packs/
//   dataDir    ZACHETKA_DATA  "dataDir"     default: ../zachetka-data next to the clone
//   androidDir ZACH_ANDROID   "androidDir"  default: ../android next to the clone
// zachetka.local.json is looked up in the repo root, then in its parents (so a git worktree inside the
// main clone uses the main clone's file). dataDir/androidDir are relative to the file's folder;
// pack is always relative to the repo root that runs the tool ("igor-2026w" alone means packs/igor-2026w).
// CLI for shell scripts: node tools/lib/settings.ts <pack|packName|dataDir|packData|androidDir>
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SETTINGS_FILE = "zachetka.local.json";

export interface Settings {
  root: string;       // repo root
  pack: string;       // absolute pack folder
  packName: string;   // basename of pack
  dataDir: string;    // absolute data root (one folder per pack inside)
  packData: string;   // dataDir/packName: items/, attempts/, meta/
  androidDir: string; // JDK + Android SDK (11-apk.md#toolchain)
  file?: string;      // settings file that was read, if any
}

interface LocalFile { pack?: string; dataDir?: string; androidDir?: string }

const REPO_ROOT = resolve(import.meta.dirname, "../..");

export function findSettingsFile(root: string): string | undefined {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const f = join(dir, SETTINGS_FILE);
    if (existsSync(f)) return f;
    if (dirname(dir) === dir) return undefined;
  }
}

function readLocal(file: string): LocalFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: not valid JSON (${(e as Error).message})`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${file}: expected an object like zachetka.local.example.json`);
  const out: LocalFile = {};
  for (const k of ["pack", "dataDir", "androidDir"] as const) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || !v) throw new Error(`${file}: "${k}" must be a non-empty string`);
    out[k] = v;
  }
  return out;
}

/** "igor-2026w" → <root>/packs/igor-2026w; anything with a slash is a path relative to root. */
export function packPath(root: string, value: string): string {
  return /[\\/]/.test(value) ? resolve(root, value) : join(root, "packs", value);
}

function defaultPack(root: string): string {
  const dir = join(root, "packs");
  const packs = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".") && statSync(join(dir, n)).isDirectory()) : [];
  if (packs.length === 1) return join(dir, packs[0]!);
  const hint = `set "pack" in ${SETTINGS_FILE} (see zachetka.local.example.json) or ZACH_PACK`;
  throw new Error(packs.length ? `several packs in packs/: ${packs.join(", ")} — ${hint}` : `no pack in packs/ — ${hint}`);
}

export function loadSettings(o: { root?: string; env?: NodeJS.ProcessEnv } = {}): Settings {
  const root = resolve(o.root ?? REPO_ROOT);
  const env = o.env ?? process.env;
  const file = findSettingsFile(root);
  const local = file ? readLocal(file) : {};
  const base = file ? dirname(file) : root;
  const packValue = env.ZACH_PACK || local.pack;
  const pack = packValue ? packPath(root, packValue) : defaultPack(root);
  const dataDir = env.ZACHETKA_DATA ? resolve(env.ZACHETKA_DATA) : resolve(base, local.dataDir ?? "../zachetka-data");
  const androidDir = env.ZACH_ANDROID ? resolve(env.ZACH_ANDROID) : resolve(base, local.androidDir ?? "../android");
  const packName = basename(pack);
  return { root, pack, packName, dataDir, packData: join(dataDir, packName), androidDir, ...(file ? { file } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const key = process.argv[2] as keyof Settings | undefined;
  const keys = ["pack", "packName", "dataDir", "packData", "androidDir"];
  try {
    if (!key || !keys.includes(key)) throw new Error(`usage: node tools/lib/settings.ts <${keys.join("|")}>`);
    console.log(loadSettings()[key]);
  } catch (e) {
    console.error(`zachetka settings: ${(e as Error).message}`);
    process.exit(1);
  }
}
