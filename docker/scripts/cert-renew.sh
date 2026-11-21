#!/usr/bin/env bash
# Obtain or renew the Let's Encrypt certificate for the database host with
# lego (HTTP-01), then install it for PgBouncer (install-cert.sh).
#
# The host is FOA_DB_DOMAIN (default db.friendsofanimals.dev). Names in
# FOA_DB_DOMAIN_ALIASES (space-separated) go on the same certificate after
# it: PgBouncer serves one certificate, so a host name being retired keeps
# working until it is dropped from the list. Every name must resolve to this
# host, or the whole order fails. foa-cert-renew.service reads these from
# /etc/foa/db-host.env when that file exists.
#
# HTTP-01, not DNS-01: DNS-01 would need a Vercel token with account-wide DNS
# rights on this box. While nothing else holds port 80 on the public address,
# lego answers the challenge itself, listening on that address only (not every
# address, so it never clashes with a local service on 127.0.0.1:80) for the
# few seconds of a challenge. Once another server holds it (foa-caddy listens
# on every address), lego writes the challenge file into FOA_ACME_WEBROOT
# (default /var/lib/foa/acme-webroot) instead, and that server must serve the
# directory's /.well-known/acme-challenge/ on port 80 for every name.
#
# lego runs with --network host, so it is a host process for the firewall:
# Docker makes no rules for host networking and DOCKER-USER does not apply.
# The host's INPUT filter must let TCP 80 in:
#   Fedora (firewalld):  firewall-cmd --zone=public --add-service=http
#                        firewall-cmd --permanent --zone=public --add-service=http
#   Ubuntu: ufw inactive, nothing to do.
# The check below only warns when firewalld blocks it; it never changes the
# firewall. If the Hostinger firewall is ever enabled it must allow TCP 80.
# The database host has no AAAA record; if one is added, port 80 must answer
# on the IPv6 address too (Let's Encrypt validates over IPv6 first).
#
# `lego run` renews only when fewer than 30 days are left (or when the CA's
# renewal info says so), so a daily timer is cheap. No ACME account e-mail is
# registered (lego allows none); set FOA_ACME_EMAIL to add one.
#
# Usage: sudo cert-renew.sh [--staging] [--print-config]
#   --staging       use the Let's Encrypt staging CA and a separate data dir
#                   (/etc/foa/lego-staging); nothing is installed.
#   --print-config  print the settings (names, CA, challenge mode) and exit;
#                   changes nothing.
set -euo pipefail

DOMAIN="${FOA_DB_DOMAIN:-db.friendsofanimals.dev}"
LISTEN=189.72.156.29:80
WEBROOT="${FOA_ACME_WEBROOT:-/var/lib/foa/acme-webroot}"
LEGO_IMAGE=goacme/lego:v5.6.0
SERVER=letsencrypt
LEGO_DIR=/etc/foa/lego
STAGING=0
PRINT_CONFIG=0

for arg in "$@"; do
  case "$arg" in
    --staging) SERVER=letsencrypt-staging; LEGO_DIR=/etc/foa/lego-staging; STAGING=1 ;;
    --print-config) PRINT_CONFIG=1 ;;
    *) echo "usage: $0 [--staging] [--print-config]" >&2; exit 2 ;;
  esac
done

# The host first: lego names the files after it, as install-cert.sh expects.
read -r -a aliases <<<"${FOA_DB_DOMAIN_ALIASES:-}"
domains=("$DOMAIN" "${aliases[@]}")

# Is port 80 on the public address taken, by a server on that address or on
# every address? One on 127.0.0.1:80 doesn't count.
port80_taken() {
  ss -Htln 'sport = :80' | awk -v ip="${LISTEN%:*}" '
    { addr = $4; sub(/:80$/, "", addr) }
    addr == "*" || addr == "0.0.0.0" || addr == "[::]" || addr == ip { found = 1 }
    END { exit !found }'
}

mounts=(-v "$LEGO_DIR:/data")
if port80_taken; then
  challenge=webroot
  mounts+=(-v "$WEBROOT:/webroot")
  http_args=(--http.webroot /webroot)
else
  challenge=standalone
  http_args=(--http.address "$LISTEN")
fi

if [ "$PRINT_CONFIG" -eq 1 ]; then
  printf '%s\n' "domain=$DOMAIN" "domains=${domains[*]}" "server=$SERVER" \
    "lego_dir=$LEGO_DIR" "challenge=$challenge"
  if [ "$challenge" = webroot ]; then
    echo "webroot=$WEBROOT"
  else
    echo "listen=$LISTEN"
  fi
  exit 0
fi

install -d -m 0700 -o root -g root "$LEGO_DIR"
if [ "$challenge" = webroot ]; then
  install -d -m 0755 -o root -g root "$WEBROOT"
fi

# firewalld (Fedora): warn if the zone of the interface holding $LISTEN's
# address does not allow 80/tcp; the challenge would then fail. Read-only.
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  listen_ip="${LISTEN%:*}"
  dev="$(ip -o -4 addr show to "$listen_ip" 2>/dev/null | awk '{print $2; exit}')" || dev=""
  zone=""
  if [ -n "$dev" ]; then
    zone="$(firewall-cmd --get-zone-of-interface="$dev" 2>/dev/null)" || zone=""
  fi
  [ -n "$zone" ] || zone="$(firewall-cmd --get-default-zone 2>/dev/null)" || zone=""
  if [ -n "$zone" ] &&
    ! firewall-cmd --zone="$zone" --query-service=http >/dev/null 2>&1 &&
    ! firewall-cmd --zone="$zone" --query-port=80/tcp >/dev/null 2>&1; then
    echo "cert-renew: WARNING: firewalld zone '$zone' (${dev:-?}) does not allow 80/tcp; HTTP-01 will fail." >&2
    echo "cert-renew:   fix: firewall-cmd --zone=$zone --add-service=http && firewall-cmd --permanent --zone=$zone --add-service=http" >&2
  fi
fi

domain_args=()
for name in "${domains[@]}"; do
  domain_args+=(--domains "$name")
done

email_args=()
if [ -n "${FOA_ACME_EMAIL:-}" ]; then
  email_args=(--email "$FOA_ACME_EMAIL")
fi

echo "cert-renew: ${domains[*]} ($challenge)"
docker run --rm --name foa-lego --network host \
  "${mounts[@]}" \
  "$LEGO_IMAGE" run \
  --accept-tos \
  --server "$SERVER" \
  --path /data \
  "${domain_args[@]}" \
  --key-type EC256 \
  --http "${http_args[@]}" \
  --renew-days 30 \
  --log.format text \
  "${email_args[@]}"

if [ "$STAGING" -eq 1 ]; then
  echo "cert-renew: staging run done; nothing installed"
  exit 0
fi

# Install lego's pair for this host, never a FOA_CERT_* pair from the
# environment (that would put back an older certificate after each renewal).
exec env -u FOA_CERT_CRT -u FOA_CERT_KEY FOA_DB_DOMAIN="$DOMAIN" FOA_LEGO_DIR="$LEGO_DIR" \
  "$(dirname "$(readlink -f "$0")")/install-cert.sh"
