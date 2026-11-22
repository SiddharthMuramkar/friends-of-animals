#!/usr/bin/env bash
# Drop preview databases on pg-nonprod whose PR is closed or branch is gone.
#
# Preview builds create foa_pr_<n>_<fp> / foa_br_<slug>_<hash>_<fp> from foa_seed and
# label them with a database comment:
#   'foa-preview pr=<n>'         dropped once GitHub reports the PR closed
#   'foa-preview branch=<ref>'   dropped once the branch no longer exists
# The comment identifies the PR or branch and must match the name's
# storage prefix.
# Anything uncertain (API error, rate limit, unexpected name or comment) is
# kept. foa_seed, foa_staging, postgres and the templates are never touched.
#
# Optional /etc/foa/sweeper.env: GITHUB_TOKEN=... (read-only token; raises the
# API rate limit and is needed if the repository becomes private).
#
# Records each drop before it happens. Hooks run for inactive previews
# after all databases sharing their storage prefix are gone. Failed hooks
# keep their record for a later sweep.
#
# Usage: sudo sweep-preview-dbs.sh [--dry-run]
set -euo pipefail

REPO=SiddharthMuramkar/friends-of-animals
CONTAINER=foa-pg-nonprod
DRY_RUN=0
HOOKS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-preview-dropped-hooks.sh"
SWEEPER_ENV="${FOA_SWEEPER_ENV:-/etc/foa/sweeper.env}"
PURGE_STATE="${FOA_PREVIEW_PURGE_STATE:-/var/lib/foa/preview-purge}"

case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

if [ -z "${GITHUB_TOKEN:-}" ] && [ -r "$SWEEPER_ENV" ]; then
  # shellcheck disable=SC1091
  . "$SWEEPER_ENV"
fi

say() { echo "sweep: $*"; }

if [ "$DRY_RUN" -eq 0 ]; then
  umask 077
  mkdir -p "$PURGE_STATE"
  exec 9>"$PURGE_STATE/lock"
  if ! flock -n 9; then
    say "another sweep is running"
    exit 0
  fi
fi

psql_nonprod() {
  docker exec -i -u postgres "$CONTAINER" \
    psql -X -q -At -v ON_ERROR_STOP=1 -h /var/run/postgresql -d postgres "$@"
}

# pr_state N -> prints open|closed|unknown
pr_state() {
  local body
  if ! body="$(
    {
      if [ -n "${GITHUB_TOKEN:-}" ]; then
        printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN"
      fi
    } | curl -fsS --max-time 20 --config - \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      "https://api.github.com/repos/$REPO/pulls/$1" 2>/dev/null
  )"; then
    echo unknown
    return
  fi
  case "$(jq -r '.state // empty' <<<"$body")" in
    open) echo open ;;
    closed) echo closed ;;
    *) echo unknown ;;
  esac
}

# branch_state REF -> prints present|gone|unknown
branch_state() {
  local rc=0
  (
    # Token via environment (never argv), in a subshell.
    if [ -n "${GITHUB_TOKEN:-}" ]; then
      export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader
      GIT_CONFIG_VALUE_0="Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)"
      export GIT_CONFIG_VALUE_0
    fi
    export GIT_TERMINAL_PROMPT=0
    exec timeout 30 git ls-remote --exit-code --heads \
      "https://github.com/$REPO.git" "refs/heads/$1" >/dev/null 2>&1
  ) || rc=$?
  case "$rc" in
    0) echo present ;;
    2) echo gone ;;
    *) echo unknown ;;
  esac
}

# Keep in step with storagePrefixForDatabase in the Files module.
preview_prefix() {
  if [[ "$1" =~ ^foa_pr_([1-9][0-9]*)_[0-9a-f]{8}$ ]]; then
    printf 'pr-%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$1" =~ ^foa_br_([a-z0-9_]+_)?([0-9a-f]{8})_[0-9a-f]{8}$ ]]; then
    printf 'br-%s\n' "${BASH_REMATCH[2]}"
  else
    return 1
  fi
}

preview_state() {
  local prefix="$1" label="$2" ref hash
  if [[ "$label" =~ ^pr=([1-9][0-9]{0,8})$ && "$prefix" = "pr-${BASH_REMATCH[1]}" ]]; then
    pr_state "${label#pr=}"
  elif [[ "$prefix" = br-* && "$label" =~ ^branch=([A-Za-z0-9][A-Za-z0-9._/+@-]{0,200})$ ]]; then
    ref="${label#branch=}"
    hash="$(printf '%s' "$ref" | sha256sum)"
    if [ "$prefix" = "br-${hash:0:8}" ]; then
      branch_state "$ref"
    else
      echo unknown
    fi
  else
    echo unknown
  fi
}

drop_db() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "would drop $1 (preview inactive)"
    return
  fi
  local record
  record="$(mktemp "$PURGE_STATE/.pending.XXXXXX")"
  printf '%s\n' "$2" > "$record"
  sync "$record"
  mv -f -- "$record" "$PURGE_STATE/$1.pending"
  sync "$PURGE_STATE"
  # The name has already been validated by preview_prefix.
  printf 'DROP DATABASE IF EXISTS "%s" WITH (FORCE);\n' "$1" | psql_nonprod
  say "dropped $1 (preview inactive)"
}

replay_purges() {
  local record db label prefix state live
  # Include unlabelled databases: a surviving fingerprint or another
  # branch with the same short hash makes the prefix unsafe to purge.
  local -A occupied=()
  live="$(psql_nonprod -c "SELECT datname FROM pg_database WHERE datname ~ '^foa_(pr|br)_'")"
  while IFS= read -r db; do
    if prefix="$(preview_prefix "$db")"; then occupied["$prefix"]=1; fi
  done <<< "$live"
  for record in "$PURGE_STATE"/*.pending; do
    [ -f "$record" ] || continue
    db="${record##*/}"
    db="${db%.pending}"
    if ! prefix="$(preview_prefix "$db")" || ! IFS= read -r label < "$record"; then
      say "kept an invalid purge record"
      continue
    fi
    if [ -n "${occupied[$prefix]:-}" ]; then
      say "keep purge for $db: a database still uses the prefix"
      continue
    fi
    state="$(preview_state "$prefix" "$label")"
    if [[ "$state" != closed && "$state" != gone ]]; then
      say "keep purge for $db: preview $state"
      continue
    fi
    if "$HOOKS" "$db" 9>&-; then
      rm -- "$record"
    else
      say "hooks failed for $db (will retry on a later sweep)"
    fi
  done
}

rows="$(psql_nonprod -F $'\t' -c "
  SELECT d.datname, shobj_description(d.oid, 'pg_database')
    FROM pg_database AS d
   WHERE shobj_description(d.oid, 'pg_database') LIKE 'foa-preview %'
   ORDER BY 1")"

checked=0 dropped=0 kept=0
while IFS=$'\t' read -r db comment; do
  [ -n "$db" ] || continue
  checked=$((checked + 1))
  case "$db" in
    foa_seed | foa_staging | postgres | template0 | template1)
      say "skip $db: protected"; kept=$((kept + 1)); continue ;;
  esac
  if ! prefix="$(preview_prefix "$db")"; then
    say "skip $db: not a preview database name"; kept=$((kept + 1)); continue
  fi
  label="${comment#foa-preview }"
  state="$(preview_state "$prefix" "$label")"
  if [[ "$state" = closed || "$state" = gone ]]; then
    drop_db "$db" "$label"; dropped=$((dropped + 1))
  else
    say "keep $db: preview $state"; kept=$((kept + 1))
  fi
done <<<"$rows"

if [ "$DRY_RUN" -eq 0 ]; then replay_purges; fi
mode=""; [ "$DRY_RUN" -eq 1 ] && mode=" (dry run)"
say "checked $checked, $( [ "$DRY_RUN" -eq 1 ] && echo "would drop" || echo dropped ) $dropped, kept $kept$mode"
