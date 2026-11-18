#!/usr/bin/env bash
# Idempotent role and database bootstrap for a FOA Postgres container.
#
# Runs inside pg-prod or pg-nonprod as the OS user `postgres`, over the
# container-local socket:
#   - on first start, from /docker-entrypoint-initdb.d (empty volume only);
#   - any time later, from the host: docker/scripts/db-bootstrap.sh.
#
# Passwords come from /run/secrets (compose secrets from /etc/foa/secrets). A
# role's password is set when the role has none yet; pass --set-passwords to
# re-apply every password from its secret file (after a rotation).
set -euo pipefail

role="${FOA_PG_ROLE:?FOA_PG_ROLE must be prod or nonprod}"
case "$role" in
  prod | nonprod) ;;
  *) echo "bootstrap: FOA_PG_ROLE must be prod or nonprod, got '$role'" >&2; exit 2 ;;
esac

set_passwords=0
case "${1:-}" in
  "") ;;
  --set-passwords) set_passwords=1 ;;
  *) echo "usage: $0 [--set-passwords]" >&2; exit 2 ;;
esac

secrets=(postgres_password migrator_password app_password pgbouncer_auth_password)
# pg-nonprod: migrator_password and app_password are the preview roles'.
[ "$role" = nonprod ] && secrets+=(staging_migrator_password staging_app_password)
for s in "${secrets[@]}"; do
  if [ ! -s "/run/secrets/$s" ]; then
    echo "bootstrap: missing or empty secret /run/secrets/$s" >&2
    exit 1
  fi
done

dir="$(dirname "$(readlink -f "$0")")"

for file in common.sql "$role.sql"; do
  psql -X -q -v ON_ERROR_STOP=1 -v set_passwords="$set_passwords" \
    -h /var/run/postgresql -U postgres -d postgres -f "$dir/$file"
done

echo "bootstrap: $role roles and databases are in place"
