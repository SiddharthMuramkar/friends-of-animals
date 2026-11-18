#!/usr/bin/env bash
# Client-side checks of the public endpoint db.shipped-it.dev:6432, run from
# a throwaway postgres:18.7-trixie container on the host network with the
# URLs from /etc/foa/vercel-urls.env (never printed). Exit 1 if any check fails.
#
# libpq needs a CA bundle for sslmode=verify-full; the official image has none,
# so the host's bundle is mounted read-only (PGSSLROOTCERT). Node/postgres.js
# uses its built-in CA store instead.
#
# Usage: sudo smoke-test.sh
set -uo pipefail

ENV_FILE=/etc/foa/vercel-urls.env
SU_SECRET=/etc/foa/secrets/pg_prod_postgres_password
IMAGE=postgres:18.7-trixie
passed=0 failed=0

# check NAME ok|fail 'expected ERE' <<'SH' ... SH   (snippet on stdin)
# The snippet runs under bash in the throwaway container; the URLs are in its
# environment, $PSQL is psql with quiet, unaligned, tuples-only output.
check() {
  local name=$1 want=$2 pattern=$3 snippet out rc=0 result=FAIL
  snippet="$(cat)"
  out="$(docker run --rm -i --network host \
    --env-file "$ENV_FILE" \
    -e PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt \
    -e PGCONNECT_TIMEOUT=10 \
    -e PGAPPNAME=foa-smoke-test \
    -e PSQL='psql -X -q -A -t -v ON_ERROR_STOP=1' \
    -e DBHOST=db.shipped-it.dev \
    -v /etc/ssl/certs:/etc/ssl/certs:ro \
    -v "$SU_SECRET:/run/su_password:ro" \
    "$IMAGE" bash -c "$snippet" 2>&1)" || rc=$?
  if [ "$want" = ok ] && [ "$rc" -eq 0 ] && grep -Eq -- "$pattern" <<<"$out"; then result=PASS; fi
  if [ "$want" = fail ] && [ "$rc" -ne 0 ] && grep -Eq -- "$pattern" <<<"$out"; then result=PASS; fi
  if [ "$result" = PASS ]; then passed=$((passed + 1)); else failed=$((failed + 1)); fi
  printf '%s  %s\n      -> %s\n' "$result" "$name" "$(tr '\n' ' ' <<<"$out" | cut -c1-160)"
}

check "prod DATABASE_URL: foa_app, transaction pool, verify-full" ok '^foa_app\|foa$' <<'SH'
$PSQL "$PROD_DATABASE_URL" -c 'select current_user, current_database()'
SH
check "prod DIRECT_URL: foa_migrator, session pool" ok '^foa_migrator\|foa$' <<'SH'
$PSQL "$PROD_DIRECT_URL" -c 'select current_user, current_database()'
SH
check "staging DATABASE_URL: nonprod_app" ok '^nonprod_app\|foa_staging$' <<'SH'
$PSQL "$STAGING_DATABASE_URL" -c 'select current_user, current_database()'
SH
check "staging DIRECT_URL: nonprod_migrator" ok '^nonprod_migrator\|foa_staging$' <<'SH'
$PSQL "$STAGING_DIRECT_URL" -c 'select current_user, current_database()'
SH
check "direct TLS negotiation (sslnegotiation=direct)" ok '^foa_app$' <<'SH'
$PSQL "$PROD_DATABASE_URL&sslnegotiation=direct" -c 'select current_user'
SH
check "TLS 1.3 negotiated" ok '^TLSv1\.3$' <<'SH'
echo | openssl s_client -connect "$DBHOST:6432" -starttls postgres -servername "$DBHOST" 2>/dev/null |
  sed -n 's/^ *Protocol *: *//p' | head -1
SH
check "parameterized query through the transaction pool (unnamed statement)" ok '^42$' <<'SH'
printf '%s\n' 'select $1::int + 1 \bind 41 \g' | $PSQL "$PROD_DATABASE_URL"
SH
check "named prepared statement through the transaction pool" ok '^42$' <<'SH'
printf '%s\n' 'select $1::int * 6 \parse s1' '\bind_named s1 7 \g' '\bind_named s1 7 \g' |
  $PSQL "$PROD_DATABASE_URL" | tail -1
SH
check "foa_app cannot CREATE TABLE in public" fail 'permission denied for schema public' <<'SH'
$PSQL "$PROD_DATABASE_URL" -c 'create table public.smoke_test (id int)'
SH
check "foa_migrator can CREATE TABLE in public (dropped again)" ok '^ok$' <<'SH'
$PSQL "$PROD_DIRECT_URL" -c 'create table public.smoke_test (id int)' \
  -c 'drop table public.smoke_test' -c "select 'ok'"
SH
check "nonprod_migrator: CREATE DATABASE t_check TEMPLATE foa_seed via db postgres (dropped again)" ok '^t_check\|nonprod_migrator\|foa-preview smoke$' <<'SH'
u="${PREVIEW_DIRECT_URL/\/foa_pr\?//postgres?}"
$PSQL "$u" -c 'create database t_check template foa_seed' \
  -c "comment on database t_check is 'foa-preview smoke'" \
  -c "select datname, pg_get_userbyid(datdba), shobj_description(oid, 'pg_database') from pg_database where datname = 't_check'" \
  -c 'drop database t_check with (force)'
SH
check "nonprod_app cannot CREATE DATABASE (no CONNECT on postgres, no CREATEDB)" fail 'permission denied (for database "postgres"|to create database)' <<'SH'
$PSQL "${PREVIEW_DATABASE_URL/\/foa_pr\?//postgres?}" -c 'create database t_nope'
SH
check "superuser postgres through 6432 is refused" fail 'no such user|authentication failed' <<'SH'
PGPASSWORD="$(cat /run/su_password)" $PSQL "host=$DBHOST port=6432 user=postgres dbname=foa sslmode=verify-full" -c 'select 1'
SH
check "superuser postgres through 6432 to db postgres is refused" fail 'no such user|authentication failed' <<'SH'
PGPASSWORD="$(cat /run/su_password)" $PSQL "host=$DBHOST port=6432 user=postgres dbname=postgres sslmode=verify-full" -c 'select 1'
SH
check "PgBouncer admin console is refused" fail 'not allowed|bouncer config error|authentication failed' <<'SH'
$PSQL "${PROD_DATABASE_URL/\/foa\?//pgbouncer?}" -c 'show pools'
SH
check "connecting to foa_seed is refused" fail 'not currently accepting connections' <<'SH'
$PSQL "${STAGING_DIRECT_URL/\/foa_staging\?//foa_seed?}" -c 'select 1'
SH
check "prod role cannot log in to non-prod databases" fail 'authentication failed' <<'SH'
$PSQL "${PROD_DATABASE_URL/\/foa\?//foa_staging?}" -c 'select 1'
SH
check "non-prod role cannot log in to foa" fail 'authentication failed' <<'SH'
$PSQL "${STAGING_DATABASE_URL/\/foa_staging\?//foa?}" -c 'select 1'
SH
check "foa_app cannot reach pg-prod's postgres DB through the auth-only entry" fail 'no pg_hba.conf entry|rejects connection|permission denied|authentication failed' <<'SH'
$PSQL "${PROD_DATABASE_URL/\/foa\?//pgbouncer_auth_prod?}" -c 'select 1'
SH
check "plaintext (sslmode=disable) is refused" fail 'SSL required' <<'SH'
$PSQL "${PROD_DATABASE_URL/sslmode=verify-full/sslmode=disable}" -c 'select 1'
SH
check "verify-full rejects a host name not on the certificate" fail 'does not match host name' <<'SH'
$PSQL "${PROD_DATABASE_URL/@db.shipped-it.dev:/@189.72.156.29:}" -c 'select 1'
SH

echo
echo "smoke-test: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
