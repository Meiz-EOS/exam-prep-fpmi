#!/bin/bash
# Android build environment for build:apk (docs/architecture/11-apk.md#toolchain). Source it: `. tools/apk/env.sh`.
# Tools live outside the repo: ZACH_ANDROID, else "androidDir" in zachetka.local.json, else ../android (tools/lib/settings.ts).
ZACH_ANDROID="${ZACH_ANDROID:-$(node "$(dirname "${BASH_SOURCE[0]:-$0}")/../lib/settings.ts" androidDir)}" || return 1
# Local layout wins when present; otherwise keep JAVA_HOME/ANDROID_HOME from the environment (CI: setup-java, setup-android).
if [ -d "$ZACH_ANDROID/jdk-21" ]; then export JAVA_HOME="$ZACH_ANDROID/jdk-21"; fi
if [ -d "$ZACH_ANDROID/sdk" ]; then export ANDROID_HOME="$ZACH_ANDROID/sdk"; fi
: "${JAVA_HOME:?no JDK 21: put it in $ZACH_ANDROID/jdk-21 or set JAVA_HOME (11-apk.md#toolchain)}"
: "${ANDROID_HOME:?no Android SDK: put it in $ZACH_ANDROID/sdk or set ANDROID_HOME (11-apk.md#toolchain)}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$PATH"
# Signing key and passwords (11-apk.md#signing); CI sets ZACH_KEYSTORE* from Secrets instead.
if [ -f "$HOME/.config/zachetka/keystore.env" ]; then
  set -a; . "$HOME/.config/zachetka/keystore.env"; set +a
fi
