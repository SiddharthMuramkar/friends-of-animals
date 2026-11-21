#!/usr/bin/env bash
# Filter inbound traffic to Docker-published ports (Docker's iptables
# firewall backend, the default; on Fedora that is iptables-nft).
#
# Docker DNATs published ports before ufw/firewalld/INPUT sees them; the
# documented hook is the DOCKER-USER chain in FORWARD. This keeps our rules in
# a chain of our own, FOA-INBOUND, jumped to from DOCKER-USER for traffic
# arriving on the public interface:
#
#   ESTABLISHED,RELATED                    -> RETURN (replies to container egress)
#   new TCP to original dst port 6432      -> RETURN (PgBouncer), see allowlist
#   anything else                          -> DROP
#
# Packets here are already DNAT-ed, so the port is matched on the conntrack
# original destination (--ctorigdstport). RETURN hands the packet back to
# DOCKER-USER, where CrowdSec's iptables bouncer rule (Ubuntu) still applies;
# on Fedora CrowdSec's nftables bouncer filters in tables of its own.
#
# firewalld (Fedora): Docker puts its bridges in firewalld's `docker` zone with
# a `docker-forwarding` policy (ANY -> docker, ACCEPT), and with
# StrictForwardPorts=no firewalld accepts every DNAT-ed connection, so
# published ports pass whatever the public zone lists. This chain is what
# filters them: iptables-nft's FORWARD chain hooks in before firewalld's
# (priority filter vs filter + 10) and an nftables drop is final, so a DROP
# here holds whatever firewalld accepts afterwards. Host ports (SSH, ACME on
# 80) are INPUT traffic, which this script never touches.
#
# Lifetime: DOCKER-USER and its rules survive Docker restarts (Docker only
# creates the chain when it is missing), not reboots. firewalld >= 2.0 with
# FirewallBackend=nftables leaves the iptables tables alone on reload, start
# and stop as long as it has no direct configuration of its own; any
# `firewall-cmd --direct` rule, chain or tracked passthrough makes it flush
# them every time, so never add one. As a safety net, `watch` re-applies after
# each firewalld Reloaded signal and when firewalld starts or stops, the same
# events Docker uses to restore its own rules.
#
# The chain is rebuilt atomically with iptables-restore --noflush; the jump
# is added once. Idempotent; concurrent runs are serialised with a lock.
#
# Usage: docker-user-fw.sh [apply|watch|show]
#   apply  wait up to ~30 s for DOCKER-USER, then install the rules (default)
#   watch  re-apply on firewalld reloads/restarts until killed; exits 0 at
#          once when firewalld is not installed (Ubuntu)
#   show   print the FORWARD jump, DOCKER-USER and FOA-INBOUND
set -euo pipefail

EXT_IF="${FOA_EXT_IF:-eth0}"
CHAIN=FOA-INBOUND
PGBOUNCER_PORT=6432
LOCK=/run/foa-docker-user-fw.lock
WAIT_TRIES=15 # x 2 s for Docker to create (or restore) DOCKER-USER
FWD_NAME=org.fedoraproject.FirewallD1
FWD_PATH=/org/fedoraproject/FirewallD1

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

# Explicit `|| return 1` throughout: `watch` calls these inside `||`, where
# bash ignores set -e.
apply_family() { # apply_family 4|6
  local family=$1 ipt restore tries i
  if [ "$family" = 4 ]; then
    ipt=iptables restore=iptables-restore tries=$WAIT_TRIES
  else
    # Docker creates both families together; don't wait long for one that
    # is off (ip6tables: false).
    ipt=ip6tables restore=ip6tables-restore tries=2
  fi
  for ((i = 1; ; i++)); do
    if "$ipt" -w -n -L DOCKER-USER >/dev/null 2>&1; then
      break
    fi
    if [ "$i" -ge "$tries" ]; then
      if [ "$family" = 4 ]; then
        echo "docker-user-fw: no IPv4 DOCKER-USER chain (is Docker running, with its default iptables firewall backend?)" >&2
        return 1
      fi
      echo "docker-user-fw: no IPv6 DOCKER-USER chain; skipping ip6tables"
      return 0
    fi
    sleep 2
  done
  rules_for "$family" | "$restore" -w --noflush || return 1
  if ! "$ipt" -w -C DOCKER-USER -i "$EXT_IF" -j "$CHAIN" 2>/dev/null; then
    "$ipt" -w -I DOCKER-USER 1 -i "$EXT_IF" -j "$CHAIN" || return 1
  fi
  echo "docker-user-fw: IPv$family rules applied ($CHAIN, jump from DOCKER-USER on $EXT_IF)"
}

apply_all() {
  # A misnamed interface would match nothing and silently filter nothing.
  if ! ip -o link show dev "$EXT_IF" >/dev/null 2>&1; then
    echo "docker-user-fw: interface $EXT_IF not found (set FOA_EXT_IF in /etc/foa/firewall.env)" >&2
    return 1
  fi
  (
    flock -w 120 9 || {
      echo "docker-user-fw: could not take $LOCK" >&2
      exit 1
    }
    apply_family 4 || exit 1
    apply_family 6 || exit 1
  ) 9>"$LOCK"
}

watch_firewalld() {
  if ! command -v firewall-cmd >/dev/null 2>&1; then
    echo "docker-user-fw: firewalld is not installed; nothing to watch"
    return 0
  fi
  if ! command -v gdbus >/dev/null 2>&1; then
    echo "docker-user-fw: gdbus (glib2) not found; cannot follow firewalld reloads" >&2
    return 1
  fi
  echo "docker-user-fw: watching firewalld; re-applying after each reload, start or stop"
  # gdbus reports the name's owner once at start (the `apply` that ran
  # before this covers that state), then a line per change or signal:
  #   The name org.fedoraproject.FirewallD1 is owned by :1.65
  #   The name org.fedoraproject.FirewallD1 does not have an owner
  #   /org/fedoraproject/FirewallD1: org.fedoraproject.FirewallD1.Reloaded ()
  local line first=1
  gdbus monitor --system --dest "$FWD_NAME" --object-path "$FWD_PATH" |
    while IFS= read -r line; do
      case "$line" in
        "The name $FWD_NAME "*)
          if [ "$first" = 1 ]; then
            first=0
            continue
          fi
          ;;
        *"$FWD_NAME.Reloaded"*) ;;
        *) continue ;;
      esac
      echo "docker-user-fw: firewalld event: $line"
      # Docker reacts to the same events; let it restore its chains first.
      sleep 2
      apply_all || echo "docker-user-fw: re-apply after firewalld event failed" >&2
    done || true
  echo "docker-user-fw: gdbus monitor exited" >&2
  return 1
}

case "${1:-apply}" in
  apply)
    apply_all
    ;;
  watch)
    watch_firewalld
    ;;
  show)
    for ipt in iptables ip6tables; do
      echo "== $ipt"
      "$ipt" -w -S FORWARD 2>/dev/null | grep -e '-j DOCKER-USER' || true
      "$ipt" -w -S DOCKER-USER 2>/dev/null || true
      "$ipt" -w -S "$CHAIN" 2>/dev/null || true
    done
    ;;
  *)
    echo "usage: $0 [apply|watch|show]" >&2
    exit 2
    ;;
esac
