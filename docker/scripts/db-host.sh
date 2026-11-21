# shellcheck shell=bash
# Sourced by bootstrap-secrets.sh, cert-renew.sh, install-cert.sh and
# smoke-test.sh: sets DB_HOST, PgBouncer's public host name, from
# FOA_DB_DOMAIN (default db.friendsofanimals.dev).
#
# The name goes into vercel-urls.env, the certificate order and file paths,
# so a value that isn't a host name stops the script (exit 2) before it
# reads or writes anything. That catches a typo, and a comment after a value
# in /etc/foa/db-host.env, which systemd's EnvironmentFile= keeps as part of
# the value.

# is_host_name NAME: lower-case DNS labels (a-z, 0-9, '-' inside a label),
# at least two, joined by dots; the last one starts with a letter.
is_host_name() {
  local re='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
  [ "${#1}" -le 253 ] && [[ $1 =~ $re ]]
}

# require_host_name SETTING NAME: exit 2 unless NAME is a host name.
require_host_name() {
  if ! is_host_name "$2"; then
    local script=${0##*/}
    printf '%s: %s: %q is not a host name\n' "${script%.sh}" "$1" "$2" >&2
    exit 2
  fi
}

DB_HOST="${FOA_DB_DOMAIN:-db.friendsofanimals.dev}"
require_host_name FOA_DB_DOMAIN "$DB_HOST"
