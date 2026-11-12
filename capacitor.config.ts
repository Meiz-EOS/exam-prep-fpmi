import type { CapacitorConfig } from "@capacitor/cli";

// APK wrapper (docs/architecture/11-apk.md#build). appId is fixed forever after the first install.
const config: CapacitorConfig = {
  appId: "app.zachetka",
  appName: "Зачётка",
  webDir: "dist/apk",
};

export default config;
