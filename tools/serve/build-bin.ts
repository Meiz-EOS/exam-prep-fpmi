// Single-file PC build (docs/architecture/07-standalone.md#bin): server + page + pack in one executable.
// Usage: npm run build:local && npm run build:bin   -> dist/bin/zachetka-<os>-<arch>[.exe]
// Pack: the same as build:local (ZACH_PACK / zachetka.local.json / the only folder in packs/).
// Node SEA (node --build-sea) makes a binary for the OS and CPU of the Node that runs this script.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { rolldown } from "rolldown";
import { loadSettings } from "../lib/settings.ts";

const s = loadSettings();
const root = s.root;
const page = join(root, "dist/local/index.html");
if (!existsSync(page)) {
  console.error("build:bin: no dist/local/index.html — run npm run build:local first");
  process.exit(1);
}
const out = join(root, "dist/bin");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// One CommonJS file: SEA runs a CommonJS main. import.meta.* only feed repo paths the binary never uses.
const bundle = await rolldown({
  input: join(root, "tools/serve/standalone.ts"),
  platform: "node",
  transform: { define: { "import.meta.dirname": "__dirname", "import.meta.url": '"file:///zachetka"' } },
  logLevel: "warn",
});
const main = join(out, "standalone.cjs");
await bundle.write({ file: main, format: "cjs", codeSplitting: false });
await bundle.close();

const pack = basename(s.pack);
writeFileSync(join(out, "pack.txt"), `${pack}\n`);
const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform;
const exe = join(out, `zachetka-${os}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`);
const config = join(out, "sea-config.json");
writeFileSync(
  config,
  JSON.stringify({
    main,
    output: exe,
    disableExperimentalSEAWarning: true,
    assets: { "index.html": page, pack: join(out, "pack.txt") },
  }),
);
execFileSync(process.execPath, ["--build-sea", config], { stdio: "inherit" });
for (const f of [main, config, join(out, "pack.txt")]) rmSync(f);
console.log(`build:bin: ${resolve(exe)} (pack ${pack})`);
