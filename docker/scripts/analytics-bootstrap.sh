#!/usr/bin/env bash
# Umami's secrets and its database role on pg-prod (#118, analytics.yml).
# Idempotent: an existing secret is never replaced. Prints file names, never
# values.
#
#   1. /etc/foa/analytics.env (0600 root): DATABASE_URL with a random password
#      for role umami, APP_SECRET, TWO_FACTOR_ENCRYPTION_KEY (32 random bytes
#      as hex each) and DISABLE_TELEMETRY=1. Missing values are added, the
#      rest kept.
#   2. postgres/bootstrap/umami.sql in foa-pg-prod: role and database umami,
#      with that password, passed over stdin and never as an argument. Then
#      pg_reload_conf(), so pg_hba.prod.conf's umami rule applies.
#   3. The tunnel token: if /etc/foa/secrets/cloudflared_tunnel_token exists,
#      make it 0400 for cloudflared's user (65532); else say how to create it.
#
# Run after `git pull` in /srv/foa and with the database stack up, before
# `docker compose -f docker/analytics.yml up -d --wait` (docker/README.md).
#
# Usage: sudo analytics-bootstrap.sh
# The functions above main() are tested by analytics-bootstrap.test.ts, which
# sources this file.
set -euo pipefail

ENV_FILE=/etc/foa/analytics.env
TOKEN_FILE=/etc/foa/secrets/cloudflared_tunnel_token
CLOUDFLARED_UID=65532 # nonroot in the distroless cloudflared image
PG_CONTAINER=foa-pg-prod
PG_HOST=10.112.12.10 # pg-prod on network db (compose.yml)
SQL_FILE=/opt/foa/bootstrap/umami.sql # postgres/bootstrap, mounted in pg-prod

usage() {
  cat <<EOF
Usage: $0
Writes Umami's env file, creates its role and database on pg-prod and checks
the Cloudflare Tunnel token. Idempotent; run as root.
EOF
}

die() {
  echo "analytics-bootstrap: $1" >&2
  exit 1
}

# is_hex64 VALUE: whether VALUE is 32 bytes as lower-case hex.
is_hex64() { [[ $1 =~ ^[0-9a-f]{64}$ ]]; }

new_hex() { openssl rand -hex 32; }

# env_value FILE KEY: the last KEY=value in FILE, or nothing.
env_value() {
  local file=$1 key=$2 line value=""
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    [[ $line == "$key="* ]] && value=${line#"$key="}
  done <"$file"
  printf '%s' "$value"
}

# db_password URL: the password in a postgresql:// URL, or nothing.
db_password() {
  [[ $1 =~ ^postgresql://umami:([^@]*)@ ]] && printf '%s' "${BASH_REMATCH[1]}"
  return 0
}

# write_env FILE: create or complete Umami's env file, keeping every value.
write_env() {
  local file=$1 url pw secret key tmp
  url="$(env_value "$file" DATABASE_URL)"
  pw="$(db_password "$url")"
  if [ -n "$url" ] && ! is_hex64 "$pw"; then
    die "the umami password in $file must be 64 hex characters (openssl rand -hex 32)"
  fi
  [ -n "$pw" ] || pw="$(new_hex)"
  secret="$(env_value "$file" APP_SECRET)"
  [ -n "$secret" ] || secret="$(new_hex)"
  key="$(env_value "$file" TWO_FACTOR_ENCRYPTION_KEY)"
  [ -n "$key" ] || key="$(new_hex)"

  tmp="$(mktemp "$(dirname "$file")/.analytics.env.XXXXXX")"
  chmod 0600 "$tmp"
  {
    echo "# Umami (docker/analytics.yml). Written by scripts/analytics-bootstrap.sh;"
    echo "# values are kept on reruns. 0600 root."
    echo "DATABASE_URL=postgresql://umami:$pw@$PG_HOST:5432/umami"
    echo "APP_SECRET=$secret"
    echo "TWO_FACTOR_ENCRYPTION_KEY=$key"
    echo "DISABLE_TELEMETRY=1"
  } >"$tmp"
  if [ -f "$file" ] && cmp -s "$tmp" "$file"; then
    rm -f "$tmp"
    echo "kept $file"
  else
    mv -f "$tmp" "$file"
    echo "wrote $file"
  fi
}

# apply_sql PASSWORD: run umami.sql in pg-prod with psql variable pw set.
# printf is a builtin, so the password reaches psql's stdin without ever
# being an argument of a process.
apply_sql() {
  local pw=$1
  is_hex64 "$pw" || die "the umami password must be 64 hex characters"
  printf "\\\\set pw '%s'\n\\\\i %s\nSELECT pg_reload_conf() AS reloaded \\\\gset\n" \
    "$pw" "$SQL_FILE" |
    docker exec -i -u postgres "$PG_CONTAINER" \
      psql -X -q -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d postgres
}

check_token() {
  if [ -s "$TOKEN_FILE" ]; then
    chown "$CLOUDFLARED_UID:$CLOUDFLARED_UID" "$TOKEN_FILE"
    chmod 0400 "$TOKEN_FILE"
    echo "kept $TOKEN_FILE"
  else
    echo "missing $TOKEN_FILE: paste the tunnel token into" \
      "sudo install -m 0400 -o $CLOUDFLARED_UID -g $CLOUDFLARED_UID /dev/stdin $TOKEN_FILE" \
      "(end with Ctrl-D), then rerun"
  fi
}

main() {
  case "${1:-}" in
    "") ;;
    -h | --help) usage; return 0 ;;
    *) echo "analytics-bootstrap: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  [ "$(id -u)" -eq 0 ] || die "run as root"
  command -v openssl >/dev/null || die "openssl not found"
  command -v docker >/dev/null || die "docker not found"
  umask 077

  install -d -m 0700 -o root -g root "$(dirname "$ENV_FILE")" "$(dirname "$TOKEN_FILE")"
  write_env "$ENV_FILE"
  apply_sql "$(db_password "$(env_value "$ENV_FILE" DATABASE_URL)")"
  echo "applied umami.sql on $PG_CONTAINER and reloaded its configuration"
  check_token
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
