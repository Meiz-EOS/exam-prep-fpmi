// Entry of the single-file PC build (npm run build:bin, docs/architecture/07-standalone.md#bin).
// The page and the pack id are SEA assets; progress goes to the per-user data folder.
// Usage: ./zachetka [--port 4317] [--data DIR] [--no-browser]
//   Already running on the port -> just opens the tab. On Linux also writes the menu shortcut.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { getAsset, isSea } from "node:sea";
import { parseArgs } from "node:util";
import { startServer } from "./server.ts";

const DEFAULT_PORT = 4317;

/** Per-user data root: XDG on Linux, Application Support on macOS, %APPDATA% on Windows. */
export function dataRoot(os = platform(), env = process.env, home = homedir()): string {
  if (os === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "zachetka");
  if (os === "darwin") return join(home, "Library", "Application Support", "zachetka");
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "zachetka");
}

export function desktopEntry(exec: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Зачётка",
    "Comment=Сроки, тесты и теория к сессии",
    `Exec="${exec.replace(/(["`$\\])/g, "\\$1")}"`,
    "Icon=accessories-dictionary",
    "Terminal=false",
    "Categories=Education;",
    "",
  ].join("\n");
}

/** Menu entry pointing at this file; rewritten only when the file moved. */
function installShortcut(): void {
  if (platform() !== "linux") return;
  try {
    const apps = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "applications");
    const file = join(apps, "zachetka.desktop");
    const text = desktopEntry(process.execPath);
    if (existsSync(file) && readFileSync(file, "utf8") === text) return;
    mkdirSync(apps, { recursive: true });
    writeFileSync(file, text);
    console.log(`shortcut: ${file}`);
  } catch (e) {
    console.error("shortcut:", e);
  }
}

function openBrowser(url: string): void {
  const os = platform();
  const [cmd, args] =
    os === "win32" ? ["cmd", ["/c", "start", "", url]] : os === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
    p.on("error", () => console.log(`open ${url} in a browser`));
    p.unref();
  } catch {
    console.log(`open ${url} in a browser`);
  }
}

async function healthy(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}api/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { port: { type: "string" }, data: { type: "string" }, "no-browser": { type: "boolean" } },
  });
  const pack = Buffer.from(getAsset("pack")).toString("utf8").trim();
  const html = new Uint8Array(getAsset("index.html"));
  const port = Number(values.port ?? DEFAULT_PORT);
  const data = values.data ?? join(dataRoot(), pack);
  const url = `http://127.0.0.1:${port}/`;
  const show = () => (values["no-browser"] ? console.log(url) : openBrowser(url));
  try {
    await startServer({ port, pack, data, dist: "", html });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE" && (await healthy(url))) {
      show(); // a copy is already running: just open the tab
      return;
    }
    console.error(e);
    process.exit(1);
  }
  console.log(`zachetka: ${url}  data=${data}`);
  installShortcut();
  show();
}

// Outside the single-file build (tests, plain node) importing this file does nothing.
if (isSea()) void main();
