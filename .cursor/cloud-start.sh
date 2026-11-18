#!/usr/bin/env bash
# Cursor cloud-agent boot. Starts Postgres and makes the dev login exist.
# Safe to run again. Does not migrate: run `pnpm db:migrate` when a task needs
# the schema.
set -euo pipefail

if ! command -v pg_isready >/dev/null 2>&1; then
  echo "Postgres is not installed. .cursor/cloud-install.sh has not been run." >&2
  exit 1
fi

if ! pg_isready -h 127.0.0.1 -q; then
  if command -v pg_lsclusters >/dev/null 2>&1; then
    pg_lsclusters --no-header | while read -r ver name _; do
      [ -n "$ver" ] || continue
      sudo pg_ctlcluster "$ver" "$name" start || true
    done
  else
    sudo service postgresql start
  fi
fi

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if pg_isready -h 127.0.0.1 -q; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Postgres did not become ready on 127.0.0.1:5432" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env.example
set +a

url="${DATABASE_URL#postgres://}"
url="${url#postgresql://}"
userpass="${url%%@*}"
user="${userpass%%:*}"
pass="${userpass#*:}"
hostpath="${url#*@}"
db="${hostpath#*/}"
db="${db%%\?*}"

case "$user" in
  "" | *[!A-Za-z0-9_]*) echo "Refusing unsafe database user from .env.example" >&2; exit 1 ;;
esac
case "$db" in
  "" | *[!A-Za-z0-9_]*) echo "Refusing unsafe database name from .env.example" >&2; exit 1 ;;
esac

sudo -u postgres psql -v ON_ERROR_STOP=1 -v user="$user" -v pass="$pass" -v db="$db" <<'SQL'
SELECT format(
  'DO $body$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = %L) THEN
       CREATE ROLE %I LOGIN PASSWORD %L SUPERUSER;
     ELSE
       ALTER ROLE %I WITH LOGIN PASSWORD %L SUPERUSER;
     END IF;
   END $body$;',
  :'user', :'user', :'pass', :'user', :'pass'
) \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db')
\gexec
SQL

PGPASSWORD="$pass" psql -h 127.0.0.1 -U "$user" -d "$db" -v ON_ERROR_STOP=1 -c 'SELECT 1'
echo "Postgres is ready for ${user}@127.0.0.1/${db}"
