#!/usr/bin/env bash
# Obtain or renew the Let's Encrypt certificate for db.shipped-it.dev with
# lego (HTTP-01), then install it for PgBouncer (install-cert.sh).
#
# HTTP-01, not DNS-01: DNS-01 would need a Vercel token with account-wide DNS
# rights on this box. lego listens on the public address's port 80 only for
# the few seconds of a challenge (127.0.0.1:80 belongs to another service).
# Port 80 is a host process, not a Docker-published port, so DOCKER-USER does
# not apply; ufw is inactive. If the Hostinger firewall is ever enabled it
# must allow TCP 80.
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
