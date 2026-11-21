#!/usr/bin/env bash
# Link the FOA units in /srv/foa/docker/systemd into /etc/systemd/system and
# enable them. Idempotent. Units keep pointing at the checkout, so a
# `git pull` in /srv/foa updates them (run `systemctl daemon-reload` after).
#
# Also enables docker.service itself: Docker's Fedora RPMs leave it disabled
# (Fedora's preset only enables docker.socket, which starts dockerd on the
# first client connection, not at boot), and the stack (restart:
# unless-stopped), the firewall unit and the timers all need dockerd running
# from boot. On Ubuntu the .deb has already enabled it; this is a no-op there.
#
# Usage: sudo install-systemd.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "install-systemd: run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
UNIT_DIR="$(readlink -f "$SCRIPT_DIR/../systemd")"

for f in "$UNIT_DIR"/*.service "$UNIT_DIR"/*.timer; do
  ln -sfn "$f" "/etc/systemd/system/$(basename "$f")"
done
systemctl daemon-reload

systemctl enable docker.service

# Restart rather than `enable --now`: on a re-run the unit may still be
# running an older version of itself.
systemctl enable foa-docker-user-fw.service
systemctl restart foa-docker-user-fw.service

systemctl enable --now \
  foa-cert-renew.timer \
  foa-pgbackrest-full.timer \
  foa-pgbackrest-diff.timer \
  foa-preview-sweep.timer \
  foa-restore-drill.timer

systemctl --no-pager --lines=5 status foa-docker-user-fw.service || true
"$SCRIPT_DIR/docker-user-fw.sh" show
systemctl list-timers 'foa-*' --no-pager
