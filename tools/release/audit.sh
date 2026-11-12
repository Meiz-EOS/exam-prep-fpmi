#!/bin/bash
# Leak check of the tree before publishing (docs/architecture/13-classmates.md#scrub). Empty output = ok.
# Usage: tools/release/audit.sh [DIR]
#   no DIR: tracked files of this clone minus tools/release/exclude.txt (what W12-08 publishes);
#   DIR:    every file under DIR (an exported tree).
# Patterns (extended regex, one per line, # = comment):
#   tools/release/patterns.txt                 generic: absolute paths, claude.ai pages, sheet ids, e-mails…
#   <dataDir>/release/audit-patterns.txt       personal: logins, surname, ids — kept outside the repo
#   (or ZACH_AUDIT_PATTERNS=<file>; dataDir comes from tools/lib/settings.ts)
# Exit: 0 clean, 1 hits found, 2 usage error.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

strip() { grep -vE '^\s*(#|$)' "$1" || true; }
strip "$HERE/patterns.txt" >"$TMP/patterns"
personal="${ZACH_AUDIT_PATTERNS:-}"
if [ -z "$personal" ]; then
  data=$(node "$REPO/tools/lib/settings.ts" dataDir 2>/dev/null) || data=""
  [ -n "$data" ] && personal="$data/release/audit-patterns.txt"
fi
if [ -n "$personal" ] && [ -f "$personal" ]; then
  strip "$personal" >>"$TMP/patterns"
  echo "audit: generic + personal patterns ($personal)" >&2
else
  echo "audit: generic patterns only" >&2
fi

if [ $# -ge 1 ]; then
  [ -d "$1" ] || { echo "audit: no such folder: $1" >&2; exit 2; }
  cd "$1"
  find . -type f -not -path './.git/*' -not -path './node_modules/*' -printf '%P\n' | sort >"$TMP/files"
else
  cd "$REPO"
  git ls-files >"$TMP/all"
  # exclude.txt: shell globs of paths that are not published.
  : >"$TMP/files"
  while IFS= read -r f; do
    skip=0
    while IFS= read -r g; do
      # shellcheck disable=SC2053
      [[ "$f" == $g ]] && { skip=1; break; }
    done < <(strip "$HERE/exclude.txt")
    [ "$skip" = 0 ] && echo "$f" >>"$TMP/files"
  done <"$TMP/all"
fi
# The pattern list itself is not content.
grep -vxF 'tools/release/patterns.txt' "$TMP/files" >"$TMP/scan" || true

hits=0
if [ -s "$TMP/scan" ]; then
  tr '\n' '\0' <"$TMP/scan" | xargs -0 grep -HnIE -f "$TMP/patterns" -- >"$TMP/hits" 2>/dev/null || true
  if [ -s "$TMP/hits" ]; then
    cut -c1-200 "$TMP/hits"
    hits=$(wc -l <"$TMP/hits")
  fi
fi
echo "audit: $(wc -l <"$TMP/scan") files, $hits hit(s)" >&2
[ "$hits" = 0 ]
