#!/usr/bin/env bash
# Re-apply roles, databases and privileges on pg-prod and pg-nonprod
# (docker/postgres/bootstrap/*.sql). Idempotent. First start does the same
# automatically through /docker-entrypoint-initdb.d.
#
# Usage: sudo db-bootstrap.sh [--set-passwords]
#   --set-passwords  re-apply every role password from /etc/foa/secrets
#                    (after rotating a secret; also rerun bootstrap-secrets.sh
#                    and update Vercel).
set -euo pipefail

for c in foa-pg-prod foa-pg-nonprod; do
  echo "== $c"
  docker exec -u postgres "$c" /opt/foa/bootstrap/bootstrap.sh "$@"
done
