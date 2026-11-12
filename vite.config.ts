import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { packPlugin } from "./tools/pack/build-pack";
import { katexWoff2Only } from "./tools/build/katex-woff2";
import { loadSettings } from "./tools/lib/settings.ts";

// Mode "pc" = PC version (07-standalone.md#build-local); "apk" = Android wrapper (11-apk.md#build); default mode = claude.ai page.
export default defineConfig(({ mode }) => ({
  root: "engine",
  plugins: [katexWoff2Only(), preact(), packPlugin(loadSettings().pack), viteSingleFile()],
  build: {
    outDir: process.env.ZACH_OUT ?? (mode === "pc" ? "../dist/local" : mode === "apk" ? "../dist/apk" : "../dist/claude"),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    rollupOptions: process.env.ZACH_ENTRY ? { input: process.env.ZACH_ENTRY } : undefined,
  },
  test: { root: ".", include: ["engine/tests/**/*.test.{ts,tsx}", "tools/**/*.test.{ts,tsx}"] },
}));
