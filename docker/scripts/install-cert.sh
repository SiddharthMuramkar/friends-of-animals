#!/usr/bin/env bash
# Install the database host's certificate for PgBouncer and reload it.
#
# The host is FOA_DB_DOMAIN (default db.friendsofanimals.dev). The pair to
# install is lego's for that host (/etc/foa/lego/certificates/<host>.crt and
# .key), or an already issued certificate and key named by FOA_CERT_CRT and
# FOA_CERT_KEY (for example from Caddy's storage). Set both or neither. Such
# a pair must name the host and have more than a day left, or nothing is
# installed (exit 1): verify-full clients would refuse it.
#
# Copies the pair into /etc/foa/pgbouncer-tls (mounted read-only into the
# pgbouncer container) when it changed and the certificate matches the key,
# then sends SIGHUP (RELOAD): new connections use the new files, existing ones
# keep theirs.
#
# Before the first ACME run there is no lego certificate; then a short-lived
# self-signed placeholder is written so PgBouncer can start
# (client_tls_sslmode=require needs a key). Clients using verify-full reject
# it, which is the point. A FOA_CERT_* pair must exist: it never falls back
# to the placeholder.
#
# Usage: sudo install-cert.sh [--print-config]   (also run by cert-renew.sh)
#   --print-config  check a FOA_CERT_* pair, print the settings (host, pair
#                   to install) and exit; changes nothing
set -euo pipefail
umask 077

# shellcheck source=SCRIPTDIR/db-host.sh
. "$(dirname "$(readlink -f "$0")")/db-host.sh"
DOMAIN=$DB_HOST
LEGO_DIR="${FOA_LEGO_DIR:-/etc/foa/lego}"
TLS_DIR=/etc/foa/pgbouncer-tls
PGB_UID=6432
CONTAINER=foa-pgbouncer

usage() { echo "usage: $0 [--print-config]" >&2; exit 2; }
[ "$#" -le 1 ] || usage
print_config=0
case "${1:-}" in
  "") ;;
  --print-config) print_config=1 ;;
  *) usage ;;
esac

if [ -n "${FOA_CERT_CRT:-}" ] || [ -n "${FOA_CERT_KEY:-}" ]; then
  if [ -z "${FOA_CERT_CRT:-}" ] || [ -z "${FOA_CERT_KEY:-}" ]; then
    echo "install-cert: set both FOA_CERT_CRT and FOA_CERT_KEY, or neither" >&2
    exit 2
  fi
  pair=override
  src_crt=$FOA_CERT_CRT
  src_key=$FOA_CERT_KEY
  for f in "$src_crt" "$src_key"; do
    if [ ! -s "$f" ]; then
      echo "install-cert: $f is missing or empty" >&2
      exit 1
    fi
  done
  # Two runs, and the host check's answer is read: openssl x509 skips
  # -checkhost when -checkend is given, and before OpenSSL 3.2 it exits 0
  # when the name doesn't match.
  if [ "$(openssl x509 -noout -checkhost "$DOMAIN" -in "$src_crt" 2>/dev/null)" != \
    "Hostname $DOMAIN does match certificate" ]; then
    echo "install-cert: $src_crt is not a certificate for $DOMAIN; not installing" >&2
    exit 1
  fi
  if ! openssl x509 -noout -checkend 86400 -in "$src_crt" >/dev/null 2>&1; then
    echo "install-cert: $src_crt has run out or runs out within a day; not installing" >&2
    exit 1
  fi
else
  pair=lego
  src_crt="$LEGO_DIR/certificates/$DOMAIN.crt"
  src_key="$LEGO_DIR/certificates/$DOMAIN.key"
fi

if [ "$print_config" -eq 1 ]; then
  printf '%s\n' "domain=$DOMAIN" "source=$pair" "crt=$src_crt" "key=$src_key" \
    "tls_dir=$TLS_DIR"
  exit 0
fi

install -d -m 0750 -o root -g "$PGB_UID" "$TLS_DIR"

pub_of_crt() { openssl x509 -noout -pubkey -in "$1" | sha256sum; }
pub_of_key() { openssl pkey -pubout -in "$1" | sha256sum; }

# put SRC_CRT SRC_KEY: install both atomically-enough (key first, then cert).
put() {
  local tmp_key tmp_crt
  tmp_key="$(mktemp "$TLS_DIR/.key.XXXXXX")"
  tmp_crt="$(mktemp "$TLS_DIR/.crt.XXXXXX")"
  cat "$2" >"$tmp_key"
  cat "$1" >"$tmp_crt"
  chown "$PGB_UID:$PGB_UID" "$tmp_key" "$tmp_crt"
  chmod 0400 "$tmp_key"
  chmod 0444 "$tmp_crt"
  mv -f "$tmp_key" "$TLS_DIR/server.key"
  mv -f "$tmp_crt" "$TLS_DIR/server.crt"
}

changed=0
if [ -s "$src_crt" ] && [ -s "$src_key" ]; then
  if ! cmp -s "$src_crt" "$TLS_DIR/server.crt" || ! cmp -s "$src_key" "$TLS_DIR/server.key"; then
    if [ "$(pub_of_crt "$src_crt")" != "$(pub_of_key "$src_key")" ]; then
      echo "install-cert: $src_crt does not match its key; not installing" >&2
      exit 1
    fi
    put "$src_crt" "$src_key"
    changed=1
    echo "install-cert: installed $(openssl x509 -noout -issuer -enddate -in "$TLS_DIR/server.crt" | tr '\n' ' ')"
  else
    echo "install-cert: certificate unchanged"
  fi
elif [ ! -s "$TLS_DIR/server.crt" ] || [ ! -s "$TLS_DIR/server.key" ]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 7 \
    -subj "/CN=$DOMAIN (placeholder)" -addext "subjectAltName=DNS:$DOMAIN" \
    -keyout "$work/key.pem" -out "$work/crt.pem" 2>/dev/null
  put "$work/crt.pem" "$work/key.pem"
  changed=1
  echo "install-cert: no ACME certificate yet; wrote a self-signed placeholder"
else
  echo "install-cert: no ACME certificate yet; keeping the installed one"
fi

if [ "$changed" -eq 1 ] && [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]; then
  docker kill -s HUP "$CONTAINER" >/dev/null
  echo "install-cert: reloaded $CONTAINER"
fi
