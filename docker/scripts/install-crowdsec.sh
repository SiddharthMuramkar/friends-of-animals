#!/usr/bin/env bash
# Install CrowdSec and its firewall bouncer from CrowdSec's own package
# repository (packagecloud), and wire in PgBouncer's log. Idempotent.
#
#  - Chosen by ID in /etc/os-release:
#      ubuntu: apt (deb822 source crowdsec.sources), bouncer
#              crowdsec-firewall-bouncer-iptables: rules in INPUT and DOCKER-USER.
#      fedora: dnf (crowdsec.repo), bouncer crowdsec-firewall-bouncer-nftables:
#              its own tables (ip crowdsec, ip6 crowdsec6) with chains on the
#              input and forward hooks, which firewalld and Docker leave alone
#              (see crowdsec-firewall-bouncer-nftables.yaml.local).
#  - Repository and signing keys written here (no `curl | bash`); each key's
#    fingerprint is pinned below.
#  - collection crowdsecurity/pgsql (PgBouncer/Postgres brute force), plus the
#    local parser foa/pgbouncer-no-such-user and whitelist foa/whitelist.
#  - collection crowdsecurity/caddy (generic HTTP scenarios on foa-caddy's
#    access log), plus whitelist foa/caddy-vercel-paths for what Vercel
#    proxies to the edge.
#  - acquisition: docker logs of the foa-pgbouncer container; foa-caddy's
#    access log from journald.
#  - crowdsec and the bouncer start after Docker (systemd drop-ins).
#
# Usage: sudo install-crowdsec.sh
set -euo pipefail

# packagecloud's repository key (primary key fingerprint): signs the apt
# Release files and the RPM repomd.xml.
REPO_KEY_URL=https://packagecloud.io/crowdsec/crowdsec/gpgkey
REPO_KEY_FPR=6A89E3C2303A901A889971D3376ED5326E93CD0C
# "Crowdsec Rpm Archive": signs the RPMs themselves (`rpm -K` shows key ID
# 4c3d386c3cdf0db4). It expires 2027-05-12; a re-run fetches the extended key
# (same fingerprint) and imports it again.
RPM_KEY_URL=https://packagecloud.io/crowdsec/crowdsec/gpgkey/crowdsec-crowdsec-FED78314A2468CCF.pub.gpg
RPM_KEY_FPR=9082D8CACBBEB0DAB218BAB04C3D386C3CDF0DB4

APT_KEYRING=/etc/apt/keyrings/crowdsec.gpg
RPM_REPO_KEY=/etc/pki/rpm-gpg/RPM-GPG-KEY-crowdsec-packagecloud
RPM_PKG_KEY=/etc/pki/rpm-gpg/RPM-GPG-KEY-crowdsec-rpm
BOUNCER_CFG=/etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml
SRC="$(readlink -f "$(dirname "$(readlink -f "$0")")/../crowdsec")"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-crowdsec: run as root" >&2
  exit 1
fi

# shellcheck disable=SC1091 # the host's file, read at run time
os_id="$(. /etc/os-release && echo "${ID:-}")"
case "$os_id" in
  ubuntu) FLAVOUR=iptables ;;
  fedora) FLAVOUR=nftables ;;
  *)
    echo "install-crowdsec: unsupported OS '$os_id' (ubuntu or fedora)" >&2
    exit 1
    ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
install -d -m 0700 "$work/gnupg"

# Throwaway keyring: reading a key must not create or touch root's ~/.gnupg.
gpg_tmp() { GNUPGHOME="$work/gnupg" gpg "$@"; }

# fetch_key URL FPR OUT: download an OpenPGP public key to OUT and insist it
# holds exactly one primary key, with fingerprint FPR (an appended second key
# would otherwise be trusted along with it).
fetch_key() {
  local url=$1 want=$2 out=$3 n fpr
  curl -fsSL "$url" -o "$out"
  n="$(gpg_tmp --show-keys --with-colons "$out" | awk -F: '/^pub:/ { n++ } END { print n + 0 }')"
  fpr="$(gpg_tmp --show-keys --with-colons "$out" | awk -F: '/^fpr:/ { print $10; exit }')"
  if [ "$n" != 1 ] || [ "$fpr" != "$want" ]; then
    echo "install-crowdsec: $url: expected one key $want, got $n key(s), first $fpr" >&2
    exit 1
  fi
}

# 1. Repository and packages ---------------------------------------------------
# Two transactions: the bouncer's postinstall registers it with
# `cscli bouncers add`, which needs crowdsec installed first.
case "$os_id" in
  ubuntu)
    if [ ! -s "$APT_KEYRING" ]; then
      fetch_key "$REPO_KEY_URL" "$REPO_KEY_FPR" "$work/key.asc"
      gpg_tmp --dearmor <"$work/key.asc" >"$work/crowdsec.gpg"
      install -d -m 0755 /etc/apt/keyrings
      install -m 0644 "$work/crowdsec.gpg" "$APT_KEYRING"
    fi
    install -m 0644 "$SRC/crowdsec.sources" /etc/apt/sources.list.d/crowdsec.sources
    apt-get update -q
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q crowdsec
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q crowdsec-firewall-bouncer-iptables
    ;;
  fedora)
    # Fetched on every run, so a key whose expiry was extended is picked up.
    fetch_key "$REPO_KEY_URL" "$REPO_KEY_FPR" "$work/repo.asc"
    fetch_key "$RPM_KEY_URL" "$RPM_KEY_FPR" "$work/rpm.asc"
    install -m 0644 "$work/repo.asc" "$RPM_REPO_KEY"
    install -m 0644 "$work/rpm.asc" "$RPM_PKG_KEY"
    # Trust the package key here, after its fingerprint matched, not through
    # dnf's import prompt (which -y would answer for any key).
    rpmkeys --import "$RPM_PKG_KEY"
    install -m 0644 "$SRC/crowdsec.repo" /etc/yum.repos.d/crowdsec.repo
    dnf -y -q install crowdsec
    dnf -y -q install crowdsec-firewall-bouncer-nftables
    ;;
esac

# The postinstall leaves a placeholder key when registration failed (cscli
# missing, database not ready), and the bouncer then cannot log in. Register
# it here instead. Shell builtins only: the key never shows up in `ps`.
if grep -qE '^api_key: *(<API_KEY>|\$\{API_KEY\}) *$' "$BOUNCER_CFG"; then
  bouncer_id="cs-firewall-bouncer-$(date +%s)"
  api_key="$(cscli -oraw bouncers add "$bouncer_id")"
  (
    umask 177
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        api_key:*) printf 'api_key: %s\n' "$api_key" ;;
        *) printf '%s\n' "$line" ;;
      esac
    done <"$BOUNCER_CFG" >"$BOUNCER_CFG.new"
  )
  mv "$BOUNCER_CFG.new" "$BOUNCER_CFG"
  echo "$bouncer_id" >"$BOUNCER_CFG.id"
  unset api_key
fi

# 2. Hub content and local files ------------------------------------------------
cscli hub update
cscli collections install crowdsecurity/pgsql
cscli collections install crowdsecurity/caddy
install -d -m 0755 /etc/crowdsec/acquis.d /etc/crowdsec/parsers/s01-parse /etc/crowdsec/parsers/s02-enrich
install -m 0644 "$SRC/acquis-foa-pgbouncer.yaml" /etc/crowdsec/acquis.d/foa-pgbouncer.yaml
install -m 0644 "$SRC/foa-pgbouncer-no-such-user.yaml" /etc/crowdsec/parsers/s01-parse/foa-pgbouncer-no-such-user.yaml
install -m 0644 "$SRC/foa-whitelist.yaml" /etc/crowdsec/parsers/s02-enrich/foa-whitelist.yaml
install -m 0644 "$SRC/acquis-foa-caddy.yaml" /etc/crowdsec/acquis.d/foa-caddy.yaml
install -m 0644 "$SRC/foa-caddy-vercel-paths.yaml" /etc/crowdsec/parsers/s02-enrich/foa-caddy-vercel-paths.yaml

# 3. Bouncer settings for this OS; crowdsec and the bouncer after Docker --------
install -m 0600 "$SRC/crowdsec-firewall-bouncer-$FLAVOUR.yaml.local" "$BOUNCER_CFG.local"
install -d -m 0755 /etc/systemd/system/crowdsec.service.d \
  /etc/systemd/system/crowdsec-firewall-bouncer.service.d
install -m 0644 "$SRC/crowdsec-after-docker.conf" \
  /etc/systemd/system/crowdsec.service.d/foa-after-docker.conf
install -m 0644 "$SRC/crowdsec-firewall-bouncer-after-docker.conf" \
  /etc/systemd/system/crowdsec-firewall-bouncer.service.d/foa-after-docker.conf
systemctl daemon-reload

systemctl enable crowdsec crowdsec-firewall-bouncer
systemctl restart crowdsec
systemctl restart crowdsec-firewall-bouncer

# 4. Report ----------------------------------------------------------------------
# First line only. Not `| head -1`: head exits early, cscli dies of SIGPIPE,
# and pipefail turns that into a failed install.
cscli version 2>/dev/null | sed -n 1p
cscli bouncers list

if [ "$FLAVOUR" = nftables ]; then
  # wait_chain FAMILY TABLE CHAIN: the bouncer builds its tables as it starts.
  wait_chain() {
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      nft list chain "$1" "$2" "$3" >/dev/null 2>&1 && return 0
      sleep 1
    done
    echo "install-crowdsec: nftables chain '$1 $2 $3' missing; see journalctl -u crowdsec-firewall-bouncer" >&2
    return 1
  }
  # forward is the hook that covers PgBouncer's published port.
  for hook in input forward; do
    wait_chain ip crowdsec "crowdsec-chain-$hook"
    wait_chain ip6 crowdsec6 "crowdsec6-chain-$hook"
  done
  echo "bouncer: chains on input and forward in nftables tables ip crowdsec and ip6 crowdsec6"
fi
