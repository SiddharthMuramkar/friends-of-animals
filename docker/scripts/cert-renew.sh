#!/usr/bin/env bash
# Obtain or renew the Let's Encrypt certificate for db.shipped-it.dev with
# lego (HTTP-01), then install it for PgBouncer (install-cert.sh).
#
# HTTP-01, not DNS-01: DNS-01 would need a Vercel token with account-wide DNS
# rights on this box. lego listens on the public address's port 80 (not every
# address, so it never clashes with a local service on 127.0.0.1:80) only for
# the few seconds of a challenge. It runs with --network host, so it is a host
# process for the firewall: Docker makes no rules for host networking and
# DOCKER-USER does not apply. The host's INPUT filter must let TCP 80 in:
#   Fedora (firewalld):  firewall-cmd --zone=public --add-service=http
#                        firewall-cmd --permanent --zone=public --add-service=http
#   Ubuntu: ufw inactive, nothing to do.
# The check below only warns when firewalld blocks it; it never changes the
# firewall. If the Hostinger firewall is ever enabled it must allow TCP 80.
# db.shipped-it.dev has no AAAA record; if one is added, lego must listen on
# the IPv6 address too (Let's Encrypt validates over IPv6 first).
#
# `lego run` renews only when fewer than 30 days are left (or when the CA's
# renewal info says so), so a daily timer is cheap. No ACME account e-mail is
# registered (lego allows none); set FOA_ACME_EMAIL to add one.
#
# Usage: sudo cert-renew.sh [--staging]
#   --staging  use the Let's Encrypt staging CA and a separate data dir
#              (/etc/foa/lego-staging); nothing is installed.
set -euo pipefail

DOMAIN=db.shipped-it.dev
LISTEN=189.72.156.29:80
LEGO_IMAGE=goacme/lego:v5.6.0
SERVER=letsencrypt
LEGO_DIR=/etc/foa/lego
STAGING=0

case "${1:-}" in
  "") ;;
  --staging) SERVER=letsencrypt-staging; LEGO_DIR=/etc/foa/lego-staging; STAGING=1 ;;
  *) echo "usage: $0 [--staging]" >&2; exit 2 ;;
esac

install -d -m 0700 -o root -g root "$LEGO_DIR"

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

email_args=()
if [ -n "${FOA_ACME_EMAIL:-}" ]; then
  email_args=(--email "$FOA_ACME_EMAIL")
fi

docker run --rm --name foa-lego --network host \
  -v "$LEGO_DIR:/data" \
  "$LEGO_IMAGE" run \
  --accept-tos \
  --server "$SERVER" \
  --path /data \
  --domains "$DOMAIN" \
  --key-type EC256 \
  --http --http.address "$LISTEN" \
  --renew-days 30 \
  --log.format text \
  "${email_args[@]}"

if [ "$STAGING" -eq 1 ]; then
  echo "cert-renew: staging run done; nothing installed"
  exit 0
fi

exec "$(dirname "$(readlink -f "$0")")/install-cert.sh"
