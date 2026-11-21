#!/usr/bin/env bash
# Client-side checks of the public endpoint db.shipped-it.dev:6432, run from
# a throwaway postgres:18.7-trixie container on the host network with the
# credentials from /etc/foa/vercel-urls.env (never printed). Exit 1 if any
# check fails.
#
# No password ever appears on a command line, where `ps` on the host would
# show it: the URLs are split here into user, password and database, written
# to a 0600 env file (removed on exit) and handed over with `docker run
# --env-file`. Inside the container `use <connection>` exports PGUSER,
# PGPASSWORD and PGDATABASE for one of them; PGHOST, PGPORT, PGSSLMODE and
# PGSSLROOTCERT are set for every check. Connections: prod_app, prod_migrator,
# staging_app, staging_migrator, preview_app, preview_migrator (the
# *_DATABASE_URL and *_DIRECT_URL keys).
#
# Scratch databases (t_check*) are made through PgBouncer as nonprod_migrator
# and dropped again as the superuser over pg-nonprod's local socket, before
# and after the run: DROP ... WITH (FORCE) as nonprod_migrator cannot end
# nonprod_app's pooled server connection.
#
# libpq needs a CA bundle for sslmode=verify-full; the official image has none,
# so the host's bundle is mounted read-only as one file (PGSSLROOTCERT). The
# path is resolved first: on Fedora /etc/ssl/certs/ca-certificates.crt is an
# absolute symlink into /etc/pki/ca-trust, which would dangle inside the
# container if the directory were mounted. Node/postgres.js uses its built-in
# CA store instead.
#
# Needs: docker, the stack up with the real Let's Encrypt certificate
# installed (cert-renew.sh), db.shipped-it.dev resolving to this host, and
# Docker Hub reachable for the postgres:18.7-trixie pull on first run.
#
# Usage: sudo smoke-test.sh
set -uo pipefail

URLS=/etc/foa/vercel-urls.env
SU_SECRET=/etc/foa/secrets/pg_prod_postgres_password
IMAGE=postgres:18.7-trixie
NONPROD=foa-pg-nonprod
SCRATCH_DBS=(t_check t_check_staging t_check_timeout)
DBHOST=db.shipped-it.dev
DBPORT=6432
passed=0 failed=0

die() { echo "smoke-test: $*" >&2; exit 2; }
[ -r "$URLS" ] || die "cannot read $URLS (run as root)"
command -v docker >/dev/null || die "docker not found"

# Host CA bundle, symlinks resolved: Debian/Ubuntu ship a real file at the
# first path; Fedora/RHEL link it (and the others) to
# /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem.
CA_BUNDLE=""
for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
  /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/cert.pem; do
  if [ -s "$f" ]; then CA_BUNDLE="$(readlink -f "$f")"; break; fi
done
[ -n "$CA_BUNDLE" ] && [ -s "$CA_BUNDLE" ] || die "no CA bundle found on the host"
CA_IN_CONTAINER=/run/foa_ca_bundle.pem

drop_scratch_dbs() {
  local db
  for db in "${SCRATCH_DBS[@]}"; do
    docker exec -u postgres "$NONPROD" psql -X -q -h /var/run/postgresql -d postgres \
      -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" ||
      echo "smoke-test: WARNING: could not drop $db on $NONPROD" >&2
  done
}

umask 077
ENV_FILE="$(mktemp /tmp/foa-smoke-test.XXXXXX)" || die "mktemp failed"
trap 'rm -f "$ENV_FILE"; drop_scratch_dbs' EXIT
trap 'exit 130' INT TERM HUP
drop_scratch_dbs

# The env file: libpq defaults, then <CONNECTION>_{USER,PASSWORD,DATABASE}.
# Only shell builtins touch the values (no external command gets them as
# arguments).
pct_decode() { printf '%b' "${1//%/\\x}"; }
{
  printf '%s\n' "PGHOST=$DBHOST" "PGPORT=$DBPORT" PGSSLMODE=verify-full \
    "PGSSLROOTCERT=$CA_IN_CONTAINER" PGCONNECT_TIMEOUT=10 \
    PGAPPNAME=foa-smoke-test
  url_re='^postgres(ql)?://([^:@/]+):([^@/]+)@([^:/?]+):([0-9]+)/([^?/]+)\?(.*)$'
  found=0
  while IFS='=' read -r key value; do
    case "$key" in
      PROD_DATABASE_URL) conn=PROD_APP ;;
      PROD_DIRECT_URL) conn=PROD_MIGRATOR ;;
      STAGING_DATABASE_URL) conn=STAGING_APP ;;
      STAGING_DIRECT_URL) conn=STAGING_MIGRATOR ;;
      PREVIEW_DATABASE_URL) conn=PREVIEW_APP ;;
      PREVIEW_DIRECT_URL) conn=PREVIEW_MIGRATOR ;;
      *) continue ;;
    esac
    [[ "$value" =~ $url_re ]] || die "$key in $URLS is not postgres://user:password@host:port/database?..."
    [ "${BASH_REMATCH[4]}:${BASH_REMATCH[5]}" = "$DBHOST:$DBPORT" ] || die "$key does not point at $DBHOST:$DBPORT"
    [[ "&${BASH_REMATCH[7]}&" == *"&sslmode=verify-full&"* ]] || die "$key lacks sslmode=verify-full"
    printf '%s_USER=%s\n' "$conn" "$(pct_decode "${BASH_REMATCH[2]}")"
    printf '%s_PASSWORD=%s\n' "$conn" "$(pct_decode "${BASH_REMATCH[3]}")"
    printf '%s_DATABASE=%s\n' "$conn" "${BASH_REMATCH[6]}"
    found=$((found + 1))
  done <"$URLS"
  [ "$found" -eq 6 ] || die "expected 6 URLs in $URLS, found $found"
} >"$ENV_FILE" || exit 2

# Prepended to every snippet. `use NAME` selects a connection; $PSQL is psql
# with quiet, unaligned, tuples-only output, stopping at the first error.
PRELUDE='
use() {
  local c="${1^^}"; local u="${c}_USER" p="${c}_PASSWORD" d="${c}_DATABASE"
  [ -n "${!u:-}" ] || { echo "smoke-test: unknown connection $1" >&2; exit 2; }
  export PGUSER="${!u}" PGPASSWORD="${!p}" PGDATABASE="${!d}"
}
PSQL="psql -X -q -A -t -v ON_ERROR_STOP=1"
'

# check NAME ok|fail 'expected ERE' <<'SH' ... SH   (snippet on stdin)
# ok: the snippet exits 0 and its output matches; fail: it exits non-zero and
# its output (stderr included) matches.
check() {
  local name=$1 want=$2 pattern=$3 snippet out rc=0 result=FAIL
  snippet="$(cat)"
  out="$(docker run --rm --network host \
    --env-file "$ENV_FILE" \
    -v "$CA_BUNDLE:$CA_IN_CONTAINER:ro" \
    -v "$SU_SECRET:/run/su_password:ro" \
    "$IMAGE" bash -c "$PRELUDE$snippet" 2>&1)" || rc=$?
  if [ "$want" = ok ] && [ "$rc" -eq 0 ] && grep -Eq -- "$pattern" <<<"$out"; then result=PASS; fi
  if [ "$want" = fail ] && [ "$rc" -ne 0 ] && grep -Eq -- "$pattern" <<<"$out"; then result=PASS; fi
  if [ "$result" = PASS ]; then passed=$((passed + 1)); else failed=$((failed + 1)); fi
  printf '%s  %s\n      -> %s\n' "$result" "$name" "$(tr '\n' ' ' <<<"$out" | cut -c1-160)"
}

REFUSED='no pg_hba.conf entry|rejects connection|permission denied for database'

# Logins: each URL reaches its role and database --------------------------------------
check "prod DATABASE_URL: foa_app, transaction pool, verify-full" ok '^foa_app\|foa$' <<'SH'
use prod_app; $PSQL -c 'select current_user, current_database()'
SH
check "prod DIRECT_URL: foa_migrator, session pool" ok '^foa_migrator\|foa$' <<'SH'
use prod_migrator; $PSQL -c 'select current_user, current_database()'
SH
check "staging DATABASE_URL: staging_app" ok '^staging_app\|foa_staging$' <<'SH'
use staging_app; $PSQL -c 'select current_user, current_database()'
SH
check "staging DIRECT_URL: staging_migrator" ok '^staging_migrator\|foa_staging$' <<'SH'
use staging_migrator; $PSQL -c 'select current_user, current_database()'
SH

# TLS ----------------------------------------------------------------------------------
check "direct TLS negotiation (sslnegotiation=direct)" ok '^foa_app$' <<'SH'
use prod_app; PGSSLNEGOTIATION=direct $PSQL -c 'select current_user'
SH
check "TLS 1.3 negotiated" ok '^TLSv1\.3$' <<'SH'
echo | openssl s_client -connect "$PGHOST:$PGPORT" -starttls postgres -servername "$PGHOST" 2>/dev/null |
  sed -n 's/^ *Protocol *: *//p' | head -1
SH
check "plaintext (sslmode=disable) is refused" fail 'SSL required' <<'SH'
use prod_app; PGSSLMODE=disable $PSQL -c 'select 1'
SH
check "verify-full rejects a host name not on the certificate" fail 'does not match host name' <<'SH'
use prod_app; PGHOST=189.72.156.29 $PSQL -c 'select 1'
SH

# Transaction pool ------------------------------------------------------------------------
check "parameterized query through the transaction pool (unnamed statement)" ok '^42$' <<'SH'
use prod_app; printf '%s\n' 'select $1::int + 1 \bind 41 \g' | $PSQL
SH
check "named prepared statement through the transaction pool" ok '^42$' <<'SH'
use prod_app
printf '%s\n' 'select $1::int * 6 \parse s1' '\bind_named s1 7 \g' '\bind_named s1 7 \g' | $PSQL | tail -1
SH

# Privileges -------------------------------------------------------------------------------
check "foa_app cannot CREATE TABLE in public" fail 'permission denied for schema public' <<'SH'
use prod_app; $PSQL -c 'create table public.smoke_test (id int)'
SH
check "foa_migrator can CREATE TABLE in public (dropped again)" ok '^ok$' <<'SH'
use prod_migrator
$PSQL -c 'create table public.smoke_test (id int)' -c 'drop table public.smoke_test' -c "select 'ok'"
SH
check "nonprod_migrator: CREATE DATABASE t_check TEMPLATE foa_seed via db postgres (dropped again)" ok '^t_check\|nonprod_migrator\|foa-preview smoke$' <<'SH'
use preview_migrator
$PSQL -d postgres -c 'create database t_check template foa_seed' \
  -c "comment on database t_check is 'foa-preview smoke'" \
  -c "select datname, pg_get_userbyid(datdba), shobj_description(oid, 'pg_database') from pg_database where datname = 't_check'" \
  -c 'drop database t_check with (force)'
SH
check "nonprod_app cannot CREATE DATABASE (no CONNECT on postgres, no CREATEDB)" fail 'permission denied (for database "postgres"|to create database)' <<'SH'
use preview_app; $PSQL -d postgres -c 'create database t_nope'
SH
check "staging_migrator cannot CREATE DATABASE (no CREATEDB)" fail 'permission denied to create database' <<'SH'
use staging_migrator; $PSQL -c 'create database t_nope'
SH

# Staging and previews are kept apart --------------------------------------------------------
check "nonprod_migrator (previews) cannot connect to foa_staging" fail "$REFUSED" <<'SH'
use preview_migrator; $PSQL -d foa_staging -c 'select 1'
SH
check "nonprod_app (previews) cannot connect to foa_staging" fail "$REFUSED" <<'SH'
use preview_app; $PSQL -d foa_staging -c 'select 1'
SH
check "staging_migrator cannot connect to postgres" fail "$REFUSED" <<'SH'
use staging_migrator; $PSQL -d postgres -c 'select 1'
SH
check "staging_app cannot connect to postgres" fail "$REFUSED" <<'SH'
use staging_app; $PSQL -d postgres -c 'select 1'
SH
check "staging_migrator cannot connect to a preview database (made and dropped here)" fail "$REFUSED" <<'SH'
use preview_migrator
$PSQL -d postgres -c 'create database t_check_staging template foa_seed' || exit 0
use staging_migrator; $PSQL -d t_check_staging -c 'select 1'
SH

# Refusals --------------------------------------------------------------------------------------
check "superuser postgres through 6432 is refused" fail 'no such user|authentication failed' <<'SH'
PGUSER=postgres PGPASSWORD="$(cat /run/su_password)" $PSQL -d foa -c 'select 1'
SH
check "superuser postgres through 6432 to db postgres is refused" fail 'no such user|authentication failed' <<'SH'
PGUSER=postgres PGPASSWORD="$(cat /run/su_password)" $PSQL -d postgres -c 'select 1'
SH
check "PgBouncer admin console is refused" fail 'not allowed|bouncer config error|authentication failed' <<'SH'
use prod_app; $PSQL -d pgbouncer -c 'show pools'
SH
check "connecting to foa_seed is refused" fail 'not currently accepting connections' <<'SH'
use preview_migrator; $PSQL -d foa_seed -c 'select 1'
SH
check "prod role cannot log in to non-prod databases" fail 'authentication failed' <<'SH'
use prod_app; $PSQL -d foa_staging -c 'select 1'
SH
check "staging role cannot log in to foa" fail 'authentication failed' <<'SH'
use staging_app; $PSQL -d foa -c 'select 1'
SH
check "preview role cannot log in to foa" fail 'authentication failed' <<'SH'
use preview_migrator; $PSQL -d foa -c 'select 1'
SH
check "foa_app cannot reach pg-prod's postgres DB through the auth-only entry" fail 'no pg_hba.conf entry|rejects connection|permission denied|authentication failed' <<'SH'
use prod_app; $PSQL -d pgbouncer_auth_prod -c 'select 1'
SH

# Timeouts (role settings, so they must survive the transaction pool) -------------------------------
check "app roles: statement_timeout 15s, idle_in_transaction_session_timeout 1min" ok '^foa_app=15s/1min staging_app=15s/1min nonprod_app=15s/1min$' <<'SH'
q="select current_setting('statement_timeout') || '/' || current_setting('idle_in_transaction_session_timeout')"
a="$(use prod_app; $PSQL -c "$q")"
b="$(use staging_app; $PSQL -c "$q")"
use preview_migrator; $PSQL -d postgres -c 'create database t_check_timeout template foa_seed'
c="$(use preview_app; $PSQL -d t_check_timeout -c "$q")"
echo "foa_app=$a staging_app=$b nonprod_app=$c"
SH
check "migrator roles: no statement_timeout, lock_timeout 30s" ok '^foa_migrator=0/30s staging_migrator=0/30s nonprod_migrator=0/30s$' <<'SH'
q="select current_setting('statement_timeout') || '/' || current_setting('lock_timeout')"
a="$(use prod_migrator; $PSQL -c "$q")"
b="$(use staging_migrator; $PSQL -c "$q")"
c="$(use preview_migrator; $PSQL -d postgres -c "$q")"
echo "foa_migrator=$a staging_migrator=$b nonprod_migrator=$c"
SH
check "foa_app: statement_timeout cancels a 16 s query through the transaction pool" fail 'canceling statement due to statement timeout' <<'SH'
use prod_app; $PSQL -c 'select pg_sleep(16)'
SH

echo
echo "smoke-test: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
