#!/usr/bin/env bash
# Run a heavy command (pnpm check, pnpm build) while holding one of a few CPU
# slots shared by every foa-factory agent on this box, so ~30 agents don't run
# 30 test suites at once and push load past 60 (which makes PGlite tests time out).
#
#   gate.sh pnpm check
#   gate.sh bash -c 'DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build'
#
# FOA_POOL=merge uses the merge pane's own slot (it never queues behind prep panes).
# Waiting for a slot can take minutes: run this with the Bash tool's run_in_background.
set -u
pool=${FOA_POOL:-shared}
if [ "$pool" = merge ]; then n=1; else n=${FOA_SLOTS:-4}; fi
start=$(date +%s)
while :; do
  for i in $(seq 1 "$n"); do
    exec {fd}>"/tmp/foa-cpu-$pool.$i"
    if flock -n "$fd"; then
      waited=$(( $(date +%s) - start ))
      echo "[gate] slot $pool.$i after ${waited}s wait: $*" >&2
      VITEST_MAX_WORKERS=${VITEST_MAX_WORKERS:-2} nice -n 10 "$@"
      rc=$?
      echo "[gate] exit $rc after $(( $(date +%s) - start - waited ))s" >&2
      exit "$rc"
    fi
    exec {fd}>&-
  done
  sleep 3
done
