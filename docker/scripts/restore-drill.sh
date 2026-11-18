#!/usr/bin/env bash
# Restore drill: point-in-time restore of pg-prod from pgBackRest repo1 into a
# throwaway container and a fresh volume, then verify and tear down.
#
#  1. Write a marker row to a scratch table in `foa` (schema
#     foa_restore_drill), note the time T, commit a second row after T, and
#     force a WAL switch; wait until that segment is archived.
#  2. Restore with --type=time --target=T --archive-mode=off into a new volume,
#     in a container from the same image with --network none and the repo
#     volume mounted read-only: it can neither archive into the real repo nor
#     reach anything. The real data volume is never mounted.
#  3. Start Postgres (archive_mode=off, no TCP), wait for promotion, check
#     that the row before T exists and the row after T does not.
#  4. Remove the container and volume; drop the scratch schema from prod.
#
# Prints wall-clock timings and keeps a log in /var/log/foa/.
# Usage: sudo restore-drill.sh
set -euo pipefail

PROD=foa-pg-prod
STANZA=foa
HERE="$(dirname "$(readlink -f "$0")")"
PGBR_CONF="$(readlink -f "$HERE/../postgres/pgbackrest.conf")"
CIPHER_CONF=/etc/foa/secrets/pgbackrest_cipher.conf
PGDATA=/var/lib/postgresql/18/docker
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRILL="foa-restore-drill-$STAMP"
VOL="$DRILL"
LOG_DIR=/var/log/foa
LOG="$LOG_DIR/restore-drill-$STAMP.log"

install -d -m 0750 "$LOG_DIR"
exec > >(tee -a "$LOG") 2>&1

die() { echo "restore-drill: FAIL: $*" >&2; exit 1; }
now() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }
prod_sql() {
  docker exec -i -u postgres "$PROD" \
    psql -X -q -At -v ON_ERROR_STOP=1 -h /var/run/postgresql -d foa "$@"
}
drill_sql() {
  docker exec -u postgres "$DRILL" \
    psql -X -q -At -v ON_ERROR_STOP=1 -h /var/run/postgresql "$@"
}

# Preconditions -------------------------------------------------------------
[ "$(docker inspect -f '{{.State.Running}}' "$PROD" 2>/dev/null)" = "true" ] || die "$PROD is not running"
[ -r "$PGBR_CONF" ] || die "missing $PGBR_CONF"
[ -r "$CIPHER_CONF" ] || die "missing $CIPHER_CONF"
image="$(docker inspect -f '{{.Config.Image}}' "$PROD")"
mount_of() { docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$1\"}}{{.Name}}{{end}}{{end}}" "$PROD"; }
repo_vol="$(mount_of /var/lib/pgbackrest)"
data_vol="$(mount_of /var/lib/postgresql)"
[ -n "$repo_vol" ] || die "cannot find the pgBackRest repo volume of $PROD"
[ -n "$data_vol" ] || die "cannot find the data volume of $PROD"
[ "$VOL" != "$data_vol" ] && [ "$VOL" != "$repo_vol" ] || die "drill volume name clashes with a real volume"
if docker volume inspect "$VOL" >/dev/null 2>&1; then die "volume $VOL already exists"; fi

cleanup() {
  set +e
  docker rm -f "$DRILL" >/dev/null 2>&1
  docker volume rm "$VOL" >/dev/null 2>&1
  prod_sql -c 'DROP SCHEMA IF EXISTS foa_restore_drill CASCADE' >/dev/null 2>&1 ||
    echo "restore-drill: WARNING: could not drop schema foa_restore_drill on $PROD" >&2
}
trap cleanup EXIT

echo "restore-drill: $STAMP image=$image repo_volume=$repo_vol (read-only) data_volume=$data_vol (not mounted)"
t_start="$(now)"

# 1. Marker, target time, WAL switch ------------------------------------------
token="$(openssl rand -hex 8)"
prod_sql <<SQL
CREATE SCHEMA IF NOT EXISTS foa_restore_drill;
CREATE TABLE IF NOT EXISTS foa_restore_drill.marker (
  token text NOT NULL,
  phase text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO foa_restore_drill.marker (token, phase) VALUES ('$token', 'before-target');
SQL
target="$(prod_sql -c "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")"
sleep 2
prod_sql -c "INSERT INTO foa_restore_drill.marker (token, phase) VALUES ('$token', 'after-target')"
wal="$(prod_sql -c 'SELECT pg_walfile_name(pg_switch_wal())')"
echo "restore-drill: target time $target; waiting for $wal to be archived"
for _ in $(seq 1 120); do
  last="$(prod_sql -c "SELECT coalesce(last_archived_wal, '') FROM pg_stat_archiver")"
  if [ -n "$last" ] && [[ ! "$last" < "$wal" ]]; then break; fi
  sleep 1
done
[ -n "$last" ] && [[ ! "$last" < "$wal" ]] || die "WAL $wal was not archived within 120 s (last: ${last:-none})"
t_archived="$(now)"

# 2. Restore into a fresh volume ------------------------------------------------
docker volume create --label "foa.restore-drill=$STAMP" "$VOL" >/dev/null
docker run -d --name "$DRILL" --label "foa.restore-drill=$STAMP" \
  --network none \
  --entrypoint sleep \
  -v "$VOL:/var/lib/postgresql" \
  -v "$repo_vol:/var/lib/pgbackrest:ro" \
  -v "$PGBR_CONF:/etc/pgbackrest/pgbackrest.conf:ro" \
  -v "$CIPHER_CONF:/etc/pgbackrest/conf.d/cipher.conf:ro" \
  "$image" infinity >/dev/null
docker exec "$DRILL" install -d -o postgres -g postgres -m 0700 "$PGDATA"

t_restore0="$(now)"
docker exec -u postgres "$DRILL" pgbackrest --stanza="$STANZA" \
  --type=time "--target=$target" --target-action=promote --archive-mode=off \
  --log-level-console=info restore
t_restore1="$(now)"

# 3. Recover, promote, verify ---------------------------------------------------------
docker exec -u postgres "$DRILL" pg_ctl -D "$PGDATA" -l /tmp/postgres.log -w -t 900 \
  -o "-c listen_addresses='' -c archive_mode=off -c unix_socket_directories=/var/run/postgresql" start
promoted=0
for _ in $(seq 1 900); do
  if [ "$(drill_sql -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null)" = "f" ]; then promoted=1; break; fi
  sleep 1
done
t_recovered="$(now)"
[ "$promoted" -eq 1 ] || { docker exec "$DRILL" tail -n 50 /tmp/postgres.log; die "restored cluster did not promote within 900 s"; }

before="$(drill_sql -d foa -c "SELECT count(*) FROM foa_restore_drill.marker WHERE token = '$token' AND phase = 'before-target'")"
after="$(drill_sql -d foa -c "SELECT count(*) FROM foa_restore_drill.marker WHERE token = '$token' AND phase = 'after-target'")"
tables="$(drill_sql -d foa -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")"
echo "restore-drill: restored cluster: marker before T = $before (want 1), after T = $after (want 0), user tables = $tables"
docker exec "$DRILL" grep -E 'recovery stopping|selected new timeline|archive recovery complete' /tmp/postgres.log || true
[ "$before" = "1" ] && [ "$after" = "0" ] || die "marker check failed"
t_end="$(now)"

echo
echo "restore-drill: PASS ($STAMP)"
echo "  write marker + archive WAL : $(secs "$t_start" "$t_archived") s"
echo "  pgbackrest restore         : $(secs "$t_restore0" "$t_restore1") s"
echo "  recovery to T + promote    : $(secs "$t_restore1" "$t_recovered") s"
echo "  restore + recovery (RTO)   : $(secs "$t_restore0" "$t_recovered") s"
echo "  whole drill                : $(secs "$t_start" "$t_end") s"
echo "  log                        : $LOG"
