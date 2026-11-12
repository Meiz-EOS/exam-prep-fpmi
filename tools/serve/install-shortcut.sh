#!/bin/sh
# Install the «Зачётка» shortcut into the applications menu (and onto the desktop with --desktop).
# Builds the PC page first if it is missing.
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
NODE=$(readlink -f "$(command -v node)")
APPS=${XDG_DATA_HOME:-$HOME/.local/share}/applications
mkdir -p "$APPS"
[ -f "$REPO/dist/local/index.html" ] || (cd "$REPO" && npm run build:local >/dev/null)
sed -e "s|@REPO@|$REPO|g" -e "s|@NODE@|$NODE|g" "$REPO/tools/serve/zachetka.desktop.in" >"$APPS/zachetka.desktop"
chmod +x "$REPO/tools/serve/open.sh"
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
echo "installed: $APPS/zachetka.desktop"
if [ "${1:-}" = "--desktop" ]; then
  DESK=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")
  cp "$APPS/zachetka.desktop" "$DESK/zachetka.desktop"
  chmod +x "$DESK/zachetka.desktop"
  command -v gio >/dev/null && gio set "$DESK/zachetka.desktop" metadata::trusted true 2>/dev/null || true
  echo "installed: $DESK/zachetka.desktop"
fi
