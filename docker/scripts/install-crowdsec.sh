#!/usr/bin/env bash
# Install CrowdSec and its iptables firewall bouncer from CrowdSec's apt
# repository, and wire in PgBouncer's log. Idempotent.
#
#  - apt source + signing key written here (no `curl | bash`); the key's
#    fingerprint is pinned below.
#  - collection crowdsecurity/pgsql (PgBouncer/Postgres brute force), plus the
#    local parser foa/pgbouncer-no-such-user and whitelist foa/whitelist.
#  - acquisition: docker logs of the foa-pgbouncer container.
#  - bouncer: blocks in INPUT and DOCKER-USER.
#
# Usage: sudo install-crowdsec.sh
set -euo pipefail

KEY_URL=https://packagecloud.io/crowdsec/crowdsec/gpgkey
KEY_FPR=6A89E3C2303A901A889971D3376ED5326E93CD0C
KEYRING=/etc/apt/keyrings/crowdsec.gpg
SRC="$(readlink -f "$(dirname "$(readlink -f "$0")")/../crowdsec")"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-crowdsec: run as root" >&2
  exit 1
fi

# 1. apt repository ----------------------------------------------------------
if [ ! -s "$KEYRING" ]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl -fsSL "$KEY_URL" -o "$work/key.asc"
  fpr="$(gpg --show-keys --with-colons "$work/key.asc" | awk -F: '/^fpr:/ { print $10; exit }')"
  if [ "$fpr" != "$KEY_FPR" ]; then
    echo "install-crowdsec: unexpected signing key fingerprint $fpr" >&2
    exit 1
  fi
  gpg --dearmor <"$work/key.asc" >"$work/crowdsec.gpg"
  install -d -m 0755 /etc/apt/keyrings
  install -m 0644 "$work/crowdsec.gpg" "$KEYRING"
fi
install -m 0644 "$SRC/crowdsec.sources" /etc/apt/sources.list.d/crowdsec.sources
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q crowdsec crowdsec-firewall-bouncer-iptables

# 2. Hub content and local files ------------------------------------------------
cscli hub update
cscli collections install crowdsecurity/pgsql
install -d -m 0755 /etc/crowdsec/acquis.d /etc/crowdsec/parsers/s01-parse /etc/crowdsec/parsers/s02-enrich
install -m 0644 "$SRC/acquis-foa-pgbouncer.yaml" /etc/crowdsec/acquis.d/foa-pgbouncer.yaml
install -m 0644 "$SRC/foa-pgbouncer-no-such-user.yaml" /etc/crowdsec/parsers/s01-parse/foa-pgbouncer-no-such-user.yaml
install -m 0644 "$SRC/foa-whitelist.yaml" /etc/crowdsec/parsers/s02-enrich/foa-whitelist.yaml

# 3. Bouncer: DOCKER-USER too, and start after Docker ---------------------------------
install -m 0600 "$SRC/crowdsec-firewall-bouncer.yaml.local" \
  /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml.local
install -d -m 0755 /etc/systemd/system/crowdsec-firewall-bouncer.service.d
install -m 0644 "$SRC/crowdsec-firewall-bouncer-after-docker.conf" \
  /etc/systemd/system/crowdsec-firewall-bouncer.service.d/foa-after-docker.conf
systemctl daemon-reload

systemctl enable crowdsec crowdsec-firewall-bouncer
systemctl restart crowdsec
systemctl restart crowdsec-firewall-bouncer

cscli version 2>/dev/null | head -1
cscli bouncers list
