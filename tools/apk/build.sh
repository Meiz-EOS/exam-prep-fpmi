#!/bin/bash
# npm run build:apk — signed release APK (docs/architecture/11-apk.md#build) → dist/apk-out/zachetka-<versionName>.apk
set -euo pipefail
cd "$(dirname "$0")/../.."
. tools/apk/env.sh
: "${ZACH_KEYSTORE:?no signing key: ~/.config/zachetka/keystore.env (11-apk.md#signing)}"
export ZACH_VERSION_CODE=$(( ($(date -u +%s) - $(date -u -d 2026-01-01 +%s)) / 60 ))
export ZACH_VERSION_NAME="$(date +%Y-%m-%d)-$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . ':!dist' || echo -dirty)"
npx vite build --mode apk
npx cap sync android
(cd android && ./gradlew --quiet assembleRelease)
mkdir -p dist/apk-out
out="dist/apk-out/zachetka-$ZACH_VERSION_NAME.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$out"
apksigner verify "$out"
echo "$out  versionCode=$ZACH_VERSION_CODE"
