#!/usr/bin/env bash
# Filter inbound traffic to Docker-published ports (iptables backend).
#
# Docker DNATs published ports before ufw/INPUT sees them; the documented hook
# is the DOCKER-USER chain in FORWARD. This keeps our rules in a chain of our
# own, FOA-INBOUND, jumped to from DOCKER-USER for traffic arriving on the
# public interface:
#
#   ESTABLISHED,RELATED                    -> RETURN (replies to container egress)
#   new TCP to original dst port 6432      -> RETURN (PgBouncer), see allowlist
#   anything else                          -> DROP
#
# Packets here are already DNAT-ed, so the port is matched on the conntrack
# original destination (--ctorigdstport). RETURN hands the packet back to
# DOCKER-USER, where CrowdSec's bouncer rule (if any) still applies.
#
# The chain is rebuilt atomically with iptables-restore --noflush; the jump
# is added once. Idempotent; run by foa-docker-user-fw.service after Docker
# starts (rules in DOCKER-USER survive Docker restarts but not reboots).
#
# Usage: docker-user-fw.sh [apply|show]
set -euo pipefail

EXT_IF="${FOA_EXT_IF:-eth0}"
CHAIN=FOA-INBOUND
PGBOUNCER_PORT=6432

# ---------------------------------------------------------------------------
# ALLOWLIST (TODO): sources allowed to reach PgBouncer on 6432, space-separated
# IPs/CIDRs, IPv4 and/or IPv6. Empty = from anywhere (the owner deferred
# Vercel Static IPs). When Static IPs are bought, set them here or in
# /etc/foa/firewall.env, e.g.
#   PGBOUNCER_ALLOWED_SOURCES="203.0.113.10/32 203.0.113.11/32"
# and also allow only them in the Hostinger firewall.
# ---------------------------------------------------------------------------
PGBOUNCER_ALLOWED_SOURCES="${PGBOUNCER_ALLOWED_SOURCES:-}"

rules_for() { # rules_for 4|6 -> iptables-restore input on stdout
  local family=$1 src
  echo "*filter"
  echo ":$CHAIN - [0:0]"
  echo "-A $CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN"
  if [ -z "$PGBOUNCER_ALLOWED_SOURCES" ]; then
    echo "-A $CHAIN -p tcp -m conntrack --ctstate NEW --ctorigdstport $PGBOUNCER_PORT --ctdir ORIGINAL -j RETURN"
  else
    for src in $PGBOUNCER_ALLOWED_SOURCES; do
      case "$src" in
        *:*) [ "$family" = 6 ] || continue ;;
        *) [ "$family" = 4 ] || continue ;;
      esac
      echo "-A $CHAIN -s $src -p tcp -m conntrack --ctstate NEW --ctorigdstport $PGBOUNCER_PORT --ctdir ORIGINAL -j RETURN"
    done
  fi
  echo "-A $CHAIN -j DROP"
  echo "COMMIT"
}

apply_family() { # apply_family 4|6
  local family=$1 ipt restore
  if [ "$family" = 4 ]; then ipt=iptables; restore=iptables-restore; else ipt=ip6tables; restore=ip6tables-restore; fi
  if ! "$ipt" -w -n -L DOCKER-USER >/dev/null 2>&1; then
    if [ "$family" = 4 ]; then
      echo "docker-user-fw: DOCKER-USER chain missing (is Docker running?)" >&2
      return 1
    fi
    echo "docker-user-fw: no IPv6 DOCKER-USER chain; skipping ip6tables"
    return 0
  fi
  rules_for "$family" | "$restore" -w --noflush
  if ! "$ipt" -w -C DOCKER-USER -i "$EXT_IF" -j "$CHAIN" 2>/dev/null; then
    "$ipt" -w -I DOCKER-USER 1 -i "$EXT_IF" -j "$CHAIN"
  fi
  echo "docker-user-fw: IPv$family rules applied ($CHAIN, jump from DOCKER-USER on $EXT_IF)"
}

case "${1:-apply}" in
  apply)
    apply_family 4
    apply_family 6
    ;;
  show)
    for ipt in iptables ip6tables; do
      echo "== $ipt"
      "$ipt" -w -S DOCKER-USER 2>/dev/null || true
      "$ipt" -w -S "$CHAIN" 2>/dev/null || true
    done
    ;;
  *)
    echo "usage: $0 [apply|show]" >&2
    exit 2
    ;;
esac
