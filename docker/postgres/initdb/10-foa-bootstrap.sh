#!/usr/bin/env bash
# First start only: the postgres image runs /docker-entrypoint-initdb.d/* when
# the data volume is empty, against a temporary socket-only server. Later
# changes are applied with docker/scripts/db-bootstrap.sh.
set -euo pipefail
/opt/foa/bootstrap/bootstrap.sh
