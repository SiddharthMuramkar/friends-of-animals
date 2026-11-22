#!/usr/bin/env bash
# Create the background workers' database roles (#61) and their secrets.
# Idempotent: an existing secret is kept and its password re-applied, so
# rotating one is: replace the file, rerun this, restart its worker.
#
#   /etc/foa/secrets/pg_prod_foa_worker_password          foa_worker
#   /etc/foa/secrets/pg_nonprod_staging_worker_password   staging_worker
#   /etc/foa/secrets/pg_nonprod_nonprod_worker_password   nonprod_worker
#
# Each file is 0400, owned by uid 1000 (`node` in the worker image), which
# reads it as a Compose secret (docker/workers.yml). The roles come from
# docker/postgres/bootstrap/workers-{prod,nonprod}.sql, run as `postgres`
# inside the database containers (mounted at /opt/foa/bootstrap). Passwords
# reach psql through the environment, never a command line (ps).
#
# Usage: sudo worker-roles.sh     (after compose.yml's stack is up)
set -euo pipefail
umask 077

SECRETS=/etc/foa/secrets
NODE_UID=1000 # node in node:26-trixie-slim

if [ "$(id -u)" -ne 0 ]; then
  echo "worker-roles: run as root" >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "worker-roles: openssl not found" >&2; exit 1; }
[ -d "$SECRETS" ] || { echo "worker-roles: run bootstrap-secrets.sh first" >&2; exit 1; }

# new_secret NAME: create $SECRETS/NAME with 32 random bytes as hex if missing.
new_secret() {
  local path="$SECRETS/$1" tmp
  if [ -s "$path" ]; then
    echo "kept     $path"
  else
    tmp="$(mktemp "$SECRETS/.tmp.XXXXXX")"
    openssl rand -hex 32 | tr -d '\n' >"$tmp"
    mv -f "$tmp" "$path"
    echo "created  $path"
  fi
  chown "$NODE_UID:$NODE_UID" "$path"
  chmod 0400 "$path"
}

new_secret pg_prod_foa_worker_password
new_secret pg_nonprod_staging_worker_password
new_secret pg_nonprod_nonprod_worker_password

# apply CONTAINER FILE VAR...: run FILE as postgres; each VAR is passed by name.
apply() {
  local container=$1 file=$2
  shift 2
  local env_args=()
  for var in "$@"; do env_args+=(-e "$var"); done
  echo "== $container: $file"
  docker exec -i "${env_args[@]}" -u postgres "$container" \
    psql -X -q -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d postgres \
    -f "/opt/foa/bootstrap/$file"
}

FOA_WORKER_PASSWORD="$(cat "$SECRETS/pg_prod_foa_worker_password")" \
  apply foa-pg-prod workers-prod.sql FOA_WORKER_PASSWORD
STAGING_WORKER_PASSWORD="$(cat "$SECRETS/pg_nonprod_staging_worker_password")" \
NONPROD_WORKER_PASSWORD="$(cat "$SECRETS/pg_nonprod_nonprod_worker_password")" \
  apply foa-pg-nonprod workers-nonprod.sql STAGING_WORKER_PASSWORD NONPROD_WORKER_PASSWORD

echo "worker-roles: foa_worker, staging_worker and nonprod_worker are in place"
