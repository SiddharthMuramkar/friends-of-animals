#!/usr/bin/env bash
# Purges a dropped preview's files (#63): every object under its prefix
# (pr-<n>/ or br-<hash>/) in the non-production bucket. Run by
# ../run-preview-dropped-hooks.sh after the sweeper drops the database,
# with the database's name as $1.
#
# It runs `pnpm files:purge-preview --database <name>` in the worker image
# (FOA_WORKER_IMAGE, default foa-workers/worker-preview; never pulled, so a
# look-alike image from a registry can't receive the credentials). The
# command maps the name to its prefix and refuses anything that isn't a
# preview database, or APP_ENV=production.
#
# Credentials: the NON-PRODUCTION bucket's R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
# R2_SECRET_ACCESS_KEY and R2_BUCKET in /etc/foa/preview-files.env (root,
# 0600; owner residue HR-08). Never production's. They reach the container
# through --env-file, never on a command line. The hook sets APP_ENV=preview
# itself, so the file must not set it.
#
# Usage: 50-purge-files.sh <database>
set -euo pipefail

db="${1:-}"
# The sweeper's own check for a preview database's name.
if ! [[ "$db" =~ ^foa_(pr|br)_[a-z0-9_]{1,56}$ ]]; then
  echo "purge-files: not a preview database name: '$db'" >&2
  exit 2
fi

ENV_FILE="${FOA_PREVIEW_FILES_ENV:-/etc/foa/preview-files.env}"
IMAGE="${FOA_WORKER_IMAGE:-foa-workers/worker-preview}"

if ! [ -r "$ENV_FILE" ]; then
  echo "purge-files: no credentials at $ENV_FILE (owner residue HR-08);" \
    "the files of $db were not purged" >&2
  exit 1
fi
if grep -Eq '^[[:space:]]*(export[[:space:]]+)?APP_ENV=' "$ENV_FILE"; then
  echo "purge-files: $ENV_FILE sets APP_ENV; remove it (the hook runs" \
    "with APP_ENV=preview)" >&2
  exit 2
fi

docker run --rm --pull never \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$ENV_FILE" --env APP_ENV=preview \
  "$IMAGE" pnpm files:purge-preview --database "$db"
