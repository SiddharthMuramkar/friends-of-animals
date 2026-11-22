#!/usr/bin/env bash
# Runs the post-drop hooks for one dropped preview database: every
# executable *.sh in preview-dropped.d (next to this script), in name
# order, each with the database's name as $1. sweep-preview-dbs.sh calls
# it after each DROP DATABASE. A failing hook doesn't stop the others; the
# exit status is 1 if any failed, so the sweeper can say so.
#
# Hooks run only for a closed PR's or a gone branch's databases, and the
# sweeper drops all of a PR's (or branch's) databases in the same run. A
# hook may therefore clean up after the whole preview (50-purge-files.sh
# deletes its pr-<n>/ files). If the sweeper ever drops one superseded
# database of a live preview, it must not call this for it.
#
# Usage: run-preview-dropped-hooks.sh <database>
set -euo pipefail

db="${1:-}"
if [ -z "$db" ]; then
  echo "usage: $0 <dropped database>" >&2
  exit 2
fi

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/preview-dropped.d"
# Long enough to purge a large preview; well inside the sweep's 15 minutes.
HOOK_TIMEOUT="${FOA_PREVIEW_HOOK_TIMEOUT:-5m}"

failed=()
shopt -s nullglob
for hook in "$HOOK_DIR"/*.sh; do
  [ -f "$hook" ] && [ -x "$hook" ] || continue
  name="$(basename "$hook")"
  if timeout "$HOOK_TIMEOUT" "$hook" "$db"; then
    echo "hook $name: done for $db"
  else
    echo "hook $name: failed for $db (exit $?)" >&2
    failed+=("$name")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "hooks failed for $db: ${failed[*]}" >&2
  exit 1
fi
