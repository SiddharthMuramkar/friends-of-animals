# VPS database stack (runbook)

Postgres and PgBouncer for FOA on the Hostinger Mumbai VPS (issue #12). This
directory is the whole deployment; the VPS runs it from a clone at **`/srv/foa`** (systemd
units and bind mounts point there, never at a developer worktree).

## What runs

Compose project `foa-vps` (`docker/compose.yml`), network `db` =
`10.112.12.0/24` on bridge `br-foa-db`, gateway `10.112.12.1` (the host).

| Container        | Image                                                            | Address           | Published        | Limits                  | Volumes                                           |
| ---------------- | ---------------------------------------------------------------- | ----------------- | ---------------- | ----------------------- | ------------------------------------------------- |
| `foa-pg-prod`    | `foa-vps/postgres:18.7-pgbackrest2.60.1` (`postgres/Dockerfile`) | 10.112.12.10:5432 | no               | 4 CPU, 10 GB, shm 1 GB  | `foa-vps_pg-prod-data`, `foa-vps_pgbackrest-repo` |
| `foa-pg-nonprod` | same image                                                       | 10.112.12.11:5432 | no               | 2 CPU, 4 GB, shm 512 MB | `foa-vps_pg-nonprod-data`                         |
| `foa-pgbouncer`  | `foa-vps/pgbouncer:1.26.1` (`pgbouncer/Dockerfile`)              | 10.112.12.20:6432 | **0.0.0.0:6432** | 1 CPU, 512 MB           | none (read-only root)                             |

- **pg-prod** holds production only: database `foa`. `shared_buffers` 4 GB,
  WAL archived by pgBackRest (`archive_timeout` 60 s).
- **pg-nonprod** holds `foa_staging`, the template `foa_seed` and one
  database per preview (`foa_pr_<n>_<fp>`, `foa_br_<slug>_<hash>_<fp>`). No
  archiving, no PITR.
- **PgBouncer** is the only public endpoint: `db.shipped-it.dev:6432`, TLS
  required (Let's Encrypt), SCRAM, transaction pooling.

Host side: systemd units in `systemd/` (firewall, certificate renewal,
backups, preview sweep) and CrowdSec (`crowdsec/`).

| Path                                                         | What                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| `compose.yml`                                                | The stack                                                   |
| `postgres/{prod,nonprod}.conf`, `pg_hba.{prod,nonprod}.conf` | Server config (`postgres/` is mounted at `/etc/postgresql`) |
| `postgres/pgbackrest.conf`                                   | pgBackRest (pg-prod, `PGBACKREST_CONFIG`)                   |
| `postgres/bootstrap/*.sql`, `initdb/`                        | Roles, databases, privileges (idempotent)                   |
| `pgbouncer/pgbouncer.ini`                                    | Routing, pooling, TLS                                       |
| `scripts/`                                                   | Host scripts (all idempotent, run as root)                  |
| `systemd/`                                                   | Units, linked into `/etc/systemd/system`                    |
| `crowdsec/`                                                  | CrowdSec apt source, acquisition, local parser, whitelist   |

## Secrets

Nothing secret is in git. `scripts/bootstrap-secrets.sh` creates everything
under `/etc/foa` (0700 root) and never overwrites an existing secret:

| File                                                    | Owner, mode     | Used by                               |
| ------------------------------------------------------- | --------------- | ------------------------------------- |
| `/etc/foa/secrets/pg_prod_postgres_password`            | 999, 0400       | pg-prod superuser                     |
| `/etc/foa/secrets/pg_prod_foa_migrator_password`        | 999, 0400       | `foa_migrator`                        |
| `/etc/foa/secrets/pg_prod_foa_app_password`             | 999, 0400       | `foa_app`                             |
| `/etc/foa/secrets/pg_nonprod_postgres_password`         | 999, 0400       | pg-nonprod superuser                  |
| `/etc/foa/secrets/pg_nonprod_nonprod_migrator_password` | 999, 0400       | `nonprod_migrator`                    |
| `/etc/foa/secrets/pg_nonprod_nonprod_app_password`      | 999, 0400       | `nonprod_app`                         |
| `/etc/foa/secrets/pg_nonprod_staging_migrator_password` | 999, 0400       | `staging_migrator`                    |
| `/etc/foa/secrets/pg_nonprod_staging_app_password`      | 999, 0400       | `staging_app`                         |
| `/etc/foa/secrets/pgbouncer_auth_password`              | 999, 0400       | `pgbouncer_auth` on both servers      |
| `/etc/foa/secrets/pg_prod_foa_worker_password`          | 1000, 0400      | `foa_worker` (worker-prod)            |
| `/etc/foa/secrets/pg_nonprod_staging_worker_password`   | 1000, 0400      | `staging_worker` (worker-staging)     |
| `/etc/foa/secrets/pg_nonprod_nonprod_worker_password`   | 1000, 0400      | `nonprod_worker` (worker-preview)     |
| `/etc/foa/secrets/worker_sentry.env` (optional, HR-22)  | root, 0600      | `SENTRY_DSN=` for all three workers   |
| `/etc/foa/secrets/pgbouncer_userlist.txt`               | 6432, 0400      | PgBouncer `auth_file` (derived)       |
| `/etc/foa/secrets/pgbackrest_repo1_cipher_pass`         | root, 0400      | pgBackRest repo1 passphrase           |
| `/etc/foa/secrets/pgbackrest_cipher.conf`               | 999, 0400       | pgBackRest `conf.d` snippet (derived) |
| `/etc/foa/vercel-urls.env`                              | root, 0600      | URLs to paste into Vercel (derived)   |
| `/etc/foa/lego/`                                        | root, 0700      | ACME account key, certificate, key    |
| `/etc/foa/pgbouncer-tls/`                               | root:6432, 0750 | Installed cert (0444) and key (0400)  |

999 is `postgres` inside the Postgres image; 6432 is `pgbouncer` in ours;
1000 is `node` in the worker image. The worker secrets come from
`scripts/worker-roles.sh` (Workers, below), not `bootstrap-secrets.sh`.
Passwords are 32 random bytes as hex (URL-safe). Containers get them as
Compose secrets (`/run/secrets/...`), never as environment values.

`vercel-urls.env` has exactly these keys (host `db.shipped-it.dev`, port 6432,
`?sslmode=verify-full`):

| Key                    | Role               | Database               | PgBouncer pool |
| ---------------------- | ------------------ | ---------------------- | -------------- |
| `PROD_DATABASE_URL`    | `foa_app`          | `foa`                  | transaction    |
| `PROD_DIRECT_URL`      | `foa_migrator`     | `foa`                  | session        |
| `STAGING_DATABASE_URL` | `staging_app`      | `foa_staging`          | transaction    |
| `STAGING_DIRECT_URL`   | `staging_migrator` | `foa_staging`          | session        |
| `PREVIEW_DATABASE_URL` | `nonprod_app`      | `foa_pr` (placeholder) | transaction    |
| `PREVIEW_DIRECT_URL`   | `nonprod_migrator` | `foa_pr` (placeholder) | session        |

Staging and previews have separate roles: Vercel has no build-only variables,
so every preview function can read the preview's `DIRECT_URL`, and a shared
migrator role could drop staging. The preview roles cannot connect to
`foa_staging` at all, and the staging roles reach nothing else.

The app swaps the `/foa_pr` path for `foa_pr_<n>_<fp>` or
`foa_br_<slug>_<hash>_<fp>` (`src/server/db/database-url.ts`; the hash, 8 hex
characters of the branch's SHA-256, keeps branches with the same slug apart;
`<fp>`, 8 hex characters of the SHA-256 of `drizzle/meta/_journal.json`'s tags
and dates, gives a PR a fresh database whenever its migrations change). The
preview build connects as `nonprod_migrator` to database `postgres` and runs
`CREATE DATABASE foa_pr_<n>_<fp> TEMPLATE foa_seed` (treat SQLSTATE 42P04 as
success), then `COMMENT ON DATABASE foa_pr_<n>_<fp> IS 'foa-preview pr=<n>'`
(or `'foa-preview branch=<ref>'`) so the sweeper can find it. A PR whose
migrations changed keeps its older databases until it closes; the sweeper
then drops them all, since they share the comment.

Node/postgres.js verifies the certificate with its built-in CA store. libpq
tools (psql, pg_dump) need `sslrootcert=system` (or `PGSSLROOTCERT`) for
`verify-full`.

**Keep an offline copy of `pgbackrest_repo1_cipher_pass`** (and later the R2
repo2 passphrase). Without it no backup can be restored. The other secrets can
be rotated (below).

## Bring-up on a fresh VPS

```sh
git clone https://github.com/SiddharthMuramkar/friends-of-animals.git /srv/foa
cd /srv/foa/docker
scripts/bootstrap-secrets.sh                 # /etc/foa/...
scripts/install-cert.sh                      # placeholder cert so PgBouncer can start
docker compose -f compose.yml up -d --build --wait
#   first start runs postgres/initdb -> bootstrap: roles, foa, foa_seed, foa_staging
docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa stanza-create
docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa check
scripts/cert-renew.sh --staging              # optional dry run against LE staging
scripts/cert-renew.sh                        # real certificate, installs + reloads PgBouncer
scripts/install-systemd.sh                   # firewall unit + timers
scripts/install-crowdsec.sh
systemctl start foa-pgbackrest-full.service  # first full backup
scripts/restore-drill.sh
scripts/smoke-test.sh                        # client checks through db.shipped-it.dev:6432
```

Then copy the values from `/etc/foa/vercel-urls.env` into Vercel, as
`DATABASE_URL` and `DIRECT_URL`: `PROD_*` into Production, `STAGING_*` into
the `staging` custom environment (`shipped-it.dev`, deployed from `main`)
and `PREVIEW_*` into Preview.

To rebuild production from backups instead of starting empty, run the
`pgbackrest restore` (below) into the `foa-vps_pg-prod-data` volume _before_
the first `up` of pg-prod (an initialised volume skips `initdb`, and the
restored cluster already has its roles). On a new machine that needs the
off-site repo2; the local repo1 dies with the old VPS.

Updating: `git -C /srv/foa pull`, then `docker compose -f
/srv/foa/docker/compose.yml up -d --build --wait` and, if units changed,
`systemctl daemon-reload`. Config-only PgBouncer changes: `docker kill -s HUP
foa-pgbouncer`. Postgres config changes: `SELECT pg_reload_conf()` (or
`docker restart foa-pg-prod` for settings that need a server start);
`pgbackrest.conf` is read by every pgBackRest command. That works because
the config is mounted as directories (`postgres/` at `/etc/postgresql`,
`pgbouncer/` at `/etc/pgbouncer/foa`): git replaces a file on checkout, and a
single-file bind mount would go on showing the container the old one.

## Routing and roles

PgBouncer (`pgbouncer/pgbouncer.ini`):

| Client database                                                   | Goes to                           | Pool                         |
| ----------------------------------------------------------------- | --------------------------------- | ---------------------------- |
| `foa`                                                             | pg-prod `foa`                     | 20 + 5 reserve per user      |
| anything else (`foa_staging`, `foa_pr_*`, `foa_br_*`, `postgres`) | pg-nonprod, same name (`*` entry) | 10 + 2 per database and user |
| `pgbouncer_auth_prod`, `pgbouncer_auth_nonprod`                   | each server's `postgres`          | auth only (see below)        |

- `[users]`: `foa_migrator`, `staging_migrator` and `nonprod_migrator` use
  **session** mode (max 10, 10 and 20 server connections); everyone else
  **transaction** mode.
  `max_client_conn` 1000, `client_idle_timeout` 600 s, `query_wait_timeout`
  20 s, `idle_transaction_timeout` 60 s. `max_prepared_statements` stays at
  its default (200).
- Auth: `auth_type = scram-sha-256`; `auth_user = pgbouncer_auth` runs
  `SELECT usename, passwd FROM pgbouncer.get_auth($1)`. The function lives in
  each server's `postgres` database (SECURITY DEFINER, owned by `postgres`,
  executable only by `pgbouncer_auth`) and returns nothing for superusers,
  replication/BYPASSRLS roles, roles that cannot log in, and
  `pgbouncer_auth`. `auth_dbname` names a `[databases]` entry, not a server
  database, hence the two auth-only entries. On pg-prod pg_hba lets only
  `pgbouncer_auth` (from 10.112.12.20) and the host-side superuser into
  `postgres`; on pg-nonprod `nonprod_migrator` connects there too, by design,
  to run `CREATE DATABASE` for previews. The function serves every role that
  can log in, so new roles (such as the staging ones) need no change there.
  SCRAM pass-through then logs clients in with their own
  credentials.
- The `auth_file` holds only `pgbouncer_auth`, as **plain text**: PgBouncer
  must log in to Postgres as the auth user itself, and a SCRAM secret works
  only when a client did SCRAM first ("password is SCRAM secret but client
  authentication did not provide SCRAM keys"; tested).
- TLS: `client_tls_sslmode = require`, `client_tls_protocols = secure`
  (TLS 1.2/1.3), Let's Encrypt cert. Direct TLS (`sslnegotiation=direct`)
  works; PgBouncer has no switch for it. PgBouncer → Postgres is plaintext on
  the private network.

Roles and databases (`postgres/bootstrap/`):

| Server     | Role               | Rights                                                                                                                                                                                                                            |
| ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pg-prod    | `foa_migrator`     | LOGIN; owns `foa` (hence `public` via `pg_database_owner`)                                                                                                                                                                        |
| pg-prod    | `foa_app`          | LOGIN; CONNECT on `foa`, USAGE on `public`; `SELECT/INSERT/UPDATE/DELETE` on tables, `USAGE/SELECT` on sequences, `EXECUTE` on functions, all through `ALTER DEFAULT PRIVILEGES FOR ROLE foa_migrator`. Cannot CREATE in `public` |
| pg-nonprod | `staging_migrator` | LOGIN, no CREATEDB; owns `foa_staging`. pg_hba: `foa_staging` only                                                                                                                                                                |
| pg-nonprod | `staging_app`      | LOGIN; CONNECT on `foa_staging`; same DML-only defaults (`FOR ROLE staging_migrator`). pg_hba: `foa_staging` only                                                                                                                 |
| pg-nonprod | `nonprod_migrator` | Previews. LOGIN CREATEDB; owns `foa_seed` and the previews it creates; CONNECT on `postgres`. No CONNECT on `foa_staging`, and pg_hba rejects it there                                                                            |
| pg-nonprod | `nonprod_app`      | Previews. LOGIN; same DML-only defaults (`FOR ROLE nonprod_migrator`); kept out of `foa_staging` the same way                                                                                                                     |
| pg-prod    | `foa_worker`       | worker-prod. LOGIN; member of `foa_app` (DML); owns schema `pgboss` in `foa`. `workers-prod.sql`                                                                                                                                  |
| pg-nonprod | `staging_worker`   | worker-staging. LOGIN; member of `staging_app`; owns schema `pgboss` in `foa_staging`. pg_hba: `foa_staging` only. `workers-nonprod.sql`                                                                                          |
| pg-nonprod | `nonprod_worker`   | worker-preview. LOGIN; member of `nonprod_app`; CONNECT on `postgres` (lists previews) and, through PUBLIC, on each preview. Never `foa_staging`. `workers-nonprod.sql`                                                           |
| both       | `pgbouncer_auth`   | LOGIN NOINHERIT; CONNECT on `postgres`; EXECUTE `pgbouncer.get_auth`                                                                                                                                                              |
| both       | `postgres`         | superuser: container socket, or TCP from 10.112.12.1 (SSH tunnel) only                                                                                                                                                            |

- `foa_seed` (owned by `nonprod_migrator`) holds only the preview roles'
  default privileges and the `public` grants; `IS_TEMPLATE true
  ALLOW_CONNECTIONS false`. `foa_staging` is made from `template1` instead and
  holds the staging roles' own.
- PUBLIC lost CONNECT/TEMP on `postgres`, `foa`, `foa_staging` and CONNECT on
  `template1`, and USAGE on `public` in every FOA database. New schemas need
  `GRANT USAGE ON SCHEMA ... TO foa_app` in their migration. Re-running the
  bootstrap never re-grants on existing tables (a migration may narrow one).
- Timeouts are role settings, so they hold through the transaction pool
  (each server connection logs in as the role; `DISCARD ALL` resets to them):
  `foa_app`, `staging_app` and `nonprod_app` have `statement_timeout = 15s`
  and `idle_in_transaction_session_timeout = 60s`; the migrator roles have no
  statement timeout but `lock_timeout = 30s`. The app's client adds
  `query_timeout: 20` (postgres.js) as a backstop.
- `pg_stat_statements.track_utility = off` on both servers (and `SET` again
  in each bootstrap file): pg_stat_statements keeps a utility statement's text
  as typed, so the bootstrap's `ALTER ROLE ... PASSWORD` would land there. The
  bootstrap also turns statement logging off for its own session.
- Re-apply: `scripts/db-bootstrap.sh`. Passwords are set only when a role has
  none; after rotating a secret file run `scripts/bootstrap-secrets.sh`,
  `scripts/db-bootstrap.sh --set-passwords`, `docker restart foa-pgbouncer`
  if `pgbouncer_auth` changed, and update Vercel.

## Admin access

```sh
docker exec -it foa-pg-prod psql -U postgres foa          # prod
docker exec -it foa-pg-nonprod psql -U postgres foa_staging
```

GUI (pgAdmin, DBeaver) through an SSH tunnel to pg-prod's fixed address; log
in as `postgres` with `/etc/foa/secrets/pg_prod_postgres_password`:

```sh
ssh -L 5433:10.112.12.10:5432 root@189.72.156.29     # then localhost:5433
ssh -L 5434:10.112.12.11:5432 root@189.72.156.29     # pg-nonprod
```

pg_hba accepts the superuser over TCP only from the bridge gateway
10.112.12.1, which is the source address of those tunnels; it rejects it from
anywhere else, PgBouncer included. PgBouncer has no admin console users;
reload with `docker kill -s HUP foa-pgbouncer`, read `docker logs foa-pgbouncer`
(stats every 5 min).

## TLS certificate

- Let's Encrypt via **HTTP-01** with `goacme/lego:v5.6.0` (`--network host`,
  listening on `189.72.156.29:80` for the seconds a challenge takes;
  127.0.0.1:80 belongs to another service). Not DNS-01: that would need an
  account-wide Vercel token on this box. No ACME account e-mail is registered
  (set `FOA_ACME_EMAIL` to add one).
- `foa-cert-renew.timer` runs `scripts/cert-renew.sh` daily: `lego run
  --renew-days 30` renews below 30 days left (or when the CA's renewal info
  asks), then `scripts/install-cert.sh` copies cert + key into
  `/etc/foa/pgbouncer-tls` if they changed and sends SIGHUP (RELOAD) to
  PgBouncer. New connections get the new certificate; open ones keep theirs.
- Let's Encrypt lifetimes drop to 64 days on 2027-02-10 and 45 days on
  2028-02-16; the daily timer covers both. Watch `journalctl -u
  foa-cert-renew` (alerting is a TODO).
- Manual: `systemctl start foa-cert-renew.service`; check with
  `openssl s_client -connect db.shipped-it.dev:6432 -starttls postgres -servername db.shipped-it.dev </dev/null`.

## Firewall

Docker-published ports bypass ufw (inactive here anyway) and INPUT.
`foa-docker-user-fw.service` (oneshot, `PartOf=docker.service`, so it re-runs
whenever Docker restarts) runs `scripts/docker-user-fw.sh`, which keeps a
chain `FOA-INBOUND`, jumped to from `DOCKER-USER` for `-i eth0`, IPv4 and
IPv6:

1. `ESTABLISHED,RELATED` → RETURN
2. new TCP whose conntrack original destination port is 6432 → RETURN
   (from anywhere for now)
3. everything else → DROP

`scripts/docker-user-fw.sh show` prints it. CrowdSec's bouncer adds its own
jump at the top of `DOCKER-USER` and `INPUT`. Any port published later must
bind 127.0.0.1; this chain drops it on eth0 regardless. Port 80
for ACME is a host process (INPUT, open). SSH config and ufw are untouched.

**Allowlist (TODO):** when Vercel Static IPs are bought, put them in
`/etc/foa/firewall.env` as `PGBOUNCER_ALLOWED_SOURCES="<ip>/32 <ip>/32"` and
`systemctl restart foa-docker-user-fw`; also allow only them on 6432 in the
Hostinger firewall and whitelist them in CrowdSec (`crowdsec/foa-whitelist.yaml`).

## CrowdSec

`scripts/install-crowdsec.sh` installs CrowdSec 1.8 and
`crowdsec-firewall-bouncer-iptables` from CrowdSec's apt repo (written as a
deb822 source with a pinned key fingerprint; Ubuntu's archive only has 1.4.6),
the `crowdsecurity/pgsql` collection, the acquisition of the `foa-pgbouncer`
container's docker logs (`type: pgbouncer`), a local parser for PgBouncer's
`closing because: no such user` (logins as `postgres` or unknown roles, which
the hub parser misses), and a whitelist for the VPS's own IP and the compose
subnet. The bouncer blocks in `INPUT` and `DOCKER-USER`; a systemd drop-in
starts it after Docker. Brute force (5 failures, leaking 1 per 10 s) bans the
source.

```sh
cscli metrics show acquisition parsers   # docker:foa-pgbouncer lines read/parsed
cscli alerts list; cscli decisions list
cscli decisions delete --ip <ip>         # unban
cscli explain --type pgbouncer --log '<log line>'
```

Shared Vercel egress IPs could be banned if the app fails logins repeatedly
(or land on a community blocklist): whitelist the Static IPs when they exist.

## Backups (pgBackRest) and restore

- Stanza `foa` on pg-prod only. **repo1**: local POSIX repository on the
  dedicated volume `foa-vps_pgbackrest-repo` (`/var/lib/pgbackrest`),
  `aes-256-cbc`, `bundle` + `block` incremental, zstd, retention 30 days of
  full backups (`repo1-retention-full-type=time`). WAL: `archive_mode=on`,
  async `archive-push`, `archive_timeout=60`.
- Timers: `foa-pgbackrest-full.timer` Sunday 02:30 IST, `foa-pgbackrest-diff.timer`
  Mon–Sat 02:30 IST. Expiry runs after each backup. `foa-restore-drill.timer`
  runs the restore drill (below) on the 1st of each month at 04:00 IST.
- This repo is **interim**: it survives operator error and corruption, not the
  loss of the VPS. `pgbackrest.conf` has a commented `repo2` (R2, s3) block;
  add it, its own passphrase and keys in a `conf.d` secret, then
  `stanza-create` for repo2 (TODO, #18).

```sh
docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa info
docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa check
systemctl start foa-pgbackrest-full.service     # or -diff
```

### Restore drill

```sh
scripts/restore-drill.sh                                      # latest: end of the archived WAL
scripts/restore-drill.sh --target '2026-11-18 11:34:52+05:30' # point in time (zone required)
systemctl start foa-restore-drill.service                     # the timer's run, now
```

It proves the backups restore without touching either live server: it only
reads the repository, never connects to pg-prod (it takes the image and the
repo volume name from `docker inspect`, so pg-prod may even be stopped), never
mounts a data volume and never goes near pg-nonprod. Steps:

1. Start a throwaway container from pg-prod's image (`--network none`,
   2 CPUs, 2 GB, repo volume read-only) with a new volume, both labelled
   `foa.restore-drill=<stamp>`. One drill at a time (`flock`).
2. `pgbackrest info`: the newest backup and archived WAL segment. It refuses
   to start unless the disk keeps room for the restore, 1 GiB of WAL and 10 %
   of the disk (pg-prod lives on the same disk).
3. `pgbackrest verify`: reads and checksums every backup file and WAL
   segment; any problem fails the drill.
4. `pgbackrest restore --archive-mode=off`, either `--type=default` (replay
   all archived WAL) or `--type=time --target=<time> --target-action=promote`.
5. Start Postgres (no TCP, no archiving) and wait for the promotion.
6. Sanity checks on the restored cluster:
   - database `foa` exists and has every **table** in the drizzle snapshot of
     the newest migration recorded in its `drizzle.__drizzle_migrations`, and
     every **extension** those migrations create (today: `pg_trgm`). The list
     follows the migrations, so it never needs editing; migrations missing
     from the checkout get a warning (`git pull` first).
   - `latest`: the newest backup was the one restored, and replay reached the
     newest archived WAL segment. This is the "recent data" check: the
     restore holds everything archived when the drill started. A newest
     commit timestamp would not work as a check, because the database can sit
     idle for days with no commits. The timestamp is still recorded as
     `last_xact`.
   - `--target`: nothing committed after the target was replayed. A target
     before the first migration only needs `foa` to exist.
7. Remove the container and the volume (on failure or Ctrl-C as well), then
   record the run.

Each run appends one line to `/var/log/foa/restore-drills.jsonl` (the
recovery-time history) and writes its full log to
`/var/log/foa/restore-drill-<stamp>.log`:

```text
{"at":"2026-11-19T08:04:29Z","target":"latest","outcome":"pass","duration_s":7.2,"recovery_s":4.1,"backup":"20261118-052136F_20261118-210107D","wal":"00000001000000000000001E","last_xact":null,"reason":null,"log":"/var/log/foa/restore-drill-20261119T080429Z.log"}
```

`at` is the start time (UTC). `target` is `latest` or the UTC target.
`outcome` is `pass` or `fail`, and the exit status is 0 or 1 to match.
`duration_s` is the whole drill. `recovery_s` covers restore, replay and
promotion: the recovery time to compare with the 4-hour goal. `backup` is
the set restored. `wal` is the last segment replayed. `last_xact` is the
newest replayed commit, or null when none came after the backup. `reason`
says why a run failed, and a run that leaves its container or volume
behind fails too. A bad argument exits 2 and records nothing. Read the
history with
`jq -c '{at, target, outcome, recovery_s}' /var/log/foa/restore-drills.jsonl`.

A `--target` must lie before the last commit in the archive. Otherwise
Postgres stops with "recovery ended before configured recovery target was
reached" and the drill fails with that reason. Use `latest` for "now".

**Cadence:** `foa-restore-drill.timer` runs the latest drill on the 1st of
every month at 04:00 IST, after that night's backup. Also run it by hand
after any change to `pgbackrest.conf`, the cipher, the Postgres image or
major version, or the backup timers. Once a quarter, run a `--target` drill
at a time from the past week. Check the newest JSONL line after each one.

### Real restore of production (outline)

Run `docker stop foa-pgbouncer foa-pg-prod`. If there is room, copy the data volume first (it is the only
way back); run `pgbackrest --stanza=foa --delta [--type=time --target=...
--target-action=promote] restore` in a one-off container from the same image
with the data volume, the repo volume and both pgBackRest config files
mounted as in `restore-drill.sh`, but **without** `--archive-mode=off`, so
the promoted server keeps archiving on its new timeline; `docker start
foa-pg-prod`, verify, `docker start foa-pgbouncer`, replay `ErasureLedger`,
then take a full backup.

## Preview databases and the sweeper

`scripts/sweep-preview-dbs.sh` (hourly via `foa-preview-sweep.timer`) lists
pg-nonprod databases whose comment starts with `foa-preview `:

- `pr=<n>`: dropped (`DROP DATABASE ... WITH (FORCE)`) when
  `GET /repos/SiddharthMuramkar/friends-of-animals/pulls/<n>` says
  `state=closed`;
- `branch=<ref>`: dropped when `git ls-remote --exit-code --heads` reports the
  branch gone (exit 2).

Anything uncertain (API error, rate limit, odd name or comment) is kept;
`foa_seed`, `foa_staging`, `postgres` and the templates are never touched,
and only names matching `foa_(pr|br)_[a-z0-9_]+` are dropped. `--dry-run`
prints what it would drop. Unauthenticated GitHub API calls are limited to 60
an hour; with many open previews, or if the repo goes private, put a read-only
`GITHUB_TOKEN=...` in `/etc/foa/sweeper.env` (0600).

## Workers

`workers.yml` (Compose project `foa-workers`, issue #61) runs the background
workers next to the database stack, on its `db` network (`foa-vps_db`, so
start `compose.yml` first). Each runs `src/worker/main.ts` from the
Dockerfile's `worker` target, drains its database's outbox every 5 s and
connects to Postgres directly, never through PgBouncer: pg-boss holds
sessions, which transaction pooling breaks. None publishes a port.

| Service          | Database                       | Role             | Does                                 | Limits          |
| ---------------- | ------------------------------ | ---------------- | ------------------------------------ | --------------- |
| `worker-prod`    | pg-prod `foa`                  | `foa_worker`     | outbox relay, `SCHEDULES` on pg-boss | 1 CPU, 512 MB   |
| `worker-staging` | pg-nonprod `foa_staging`       | `staging_worker` | outbox relay, `SCHEDULES` on pg-boss | 0.5 CPU, 384 MB |
| `worker-preview` | pg-nonprod, every live preview | `nonprod_worker` | outbox relay only, 1 connection each | 0.5 CPU, 512 MB |

- **Health:** after each healthy poll the worker touches
  `/tmp/foa-worker-heartbeat` (a tmpfs; the root file system is read-only),
  and the health check passes while it is under 120 s old. Single-database
  workers stop touching it while their database fails; `worker-preview`
  while it can't list the previews (one broken preview doesn't count). Each
  poll also upserts the worker's row in `worker_heartbeat` in every database
  it drains (worker, environment, last seen, version), which
  `/api/health/worker` reads ("Monitoring and alerts"). `restart: unless-stopped` restarts a worker that exits;
  Docker doesn't restart an unhealthy one, so watch `docker ps`.
- **Logs:** one JSON object per line (`event`, `database`, counts), with
  error classes and codes but never messages or addresses; in the host's
  journal for a year ("Logs").
- **Errors:** a failed tick (once, until that database recovers), an
  uncaught exception or unhandled rejection (then the worker exits 1 and
  restarts), and a failed start go to Sentry, scrubbed, tagged with the
  database and APP_ENV, when `/etc/foa/secrets/worker_sentry.env` holds
  `SENTRY_DSN=...` (HR-22). Without it they are only logged.
- **Email:** staging and previews capture every message in their database's
  mailbox; production refuses until SES exists (HR-12), so its deliveries
  retry and end `failed`, visible to staff.
- **Schedules:** `SCHEDULES` (`src/server/outbox/schedules.ts`) is registered
  with pg-boss in schema `pgboss` (owned by the worker role) at every start;
  a schedule removed from the code is unscheduled. Previews run none.

### Preview databases: attach and detach

`worker-preview` lists pg-nonprod's databases every 60 s from `postgres`
and serves exactly those the sweeper would recognise: `foa_pr_<n>[_<fp>]`
labelled `foa-preview pr=<n>`, or `foa_br_…` labelled `foa-preview
branch=<ref>`. A new preview is attached at the next listing, with no
manual step (its first deploy's migration creates and labels the database).
When the sweeper drops a preview (`WITH (FORCE)` ends the worker's
session), the next drain sees SQLSTATE 3D000 and the worker lets go at
once; a database that just stops being listed is let go at the next
listing. Each attach and detach is logged (`tenant.attached`,
`tenant.detached`). The worker runs one code version for every preview:
deliveries for handlers it doesn't have are left pending (`skipped`), and
the preview drain route (`POST /api/preview/drain`) covers Seam 2 journeys
meanwhile.

### First start (owner, HR-07)

```sh
cd /srv/foa/docker
docker exec foa-pg-prod psql -U postgres -c 'SELECT pg_reload_conf()'     # after git pull: pg_hba
docker exec foa-pg-nonprod psql -U postgres -c 'SELECT pg_reload_conf()'
scripts/worker-roles.sh               # roles + /etc/foa/secrets/*_worker_password
WORKER_VERSION=$(git -C /srv/foa rev-parse --short HEAD) \
  docker compose -f workers.yml up -d --build --wait
docker compose -f workers.yml ps      # all three "healthy"
```

Then open a PR, sign up on its preview and check the welcome email in the
preview's capture mailbox; after the PR closes and the hourly sweep runs,
`docker compose -f workers.yml logs worker-preview` shows
`tenant.detached` for its database.

### Run, restart and read the logs

Run from `/srv/foa/docker`. `WORKER_VERSION` is only recorded in the
heartbeat rows; leave it out and they say `unknown`.

| Worker           | Run (build and start)                                                                         | Restart                                                | Logs                                                              |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `worker-prod`    | `docker compose -f workers.yml up -d --build --wait worker-prod`                              | `docker compose -f workers.yml restart worker-prod`    | `docker compose -f workers.yml logs -f --tail=200 worker-prod`    |
| `worker-staging` | `docker compose -f workers.yml up -d --build --wait worker-staging`                           | `docker compose -f workers.yml restart worker-staging` | `docker compose -f workers.yml logs -f --tail=200 worker-staging` |
| `worker-preview` | `docker compose -f <checkout>/docker/workers.yml up -d --build --wait worker-preview` (below) | `docker compose -f workers.yml restart worker-preview` | `docker compose -f workers.yml logs -f --tail=200 worker-preview` |

- Stop one: `docker compose -f workers.yml stop worker-staging` (it finishes
  its poll, stops pg-boss and closes its connections within 30 s).
- Updating prod and staging: `git -C /srv/foa pull`, then the "Run" line;
  only a changed image is recreated.
- Only errors: `docker compose -f workers.yml logs worker-preview | grep '"level":"error"'`.
- Rotating a worker password: replace its file in `/etc/foa/secrets`, rerun
  `scripts/worker-roles.sh`, restart that worker.
- A local run needs none of this: `pnpm worker:dev` drains the local
  database (`DIRECT_URL`) in single mode with `APP_ENV=local`, capturing
  email, and restarts on code changes.

### Redeploying `worker-preview` per milestone (HR-10)

Previews run milestone branches (`M1`, `M2`, …) that add handlers before
`main` has them, so from M1 on, rebuild **only** `worker-preview` from the
milestone tip, in a separate checkout (never check out `M<k>` in
`/srv/foa`, which prod and staging build from):

```sh
git clone --branch M<k> --depth 1 https://github.com/SiddharthMuramkar/friends-of-animals.git /srv/foa-m<k>
WORKER_VERSION=$(git -C /srv/foa-m<k> rev-parse --short HEAD) \
  docker compose -f /srv/foa-m<k>/docker/workers.yml up -d --build --wait worker-preview
```

It keeps the project name `foa-workers` and its own image
(`foa-workers/worker-preview`), so prod and staging are untouched. Never
`down` from that checkout: it would stop all three.

## Checks

`scripts/smoke-test.sh` runs 31 client-side checks through
`db.shipped-it.dev:6432` from a throwaway `postgres:18.7-trixie` container:
each URL logs in as the right role and database with `verify-full`, direct
TLS and TLS 1.3, parameterized and named prepared statements through the
transaction pool, `foa_app` cannot create in `public`, `nonprod_migrator` can
clone `foa_seed`, the preview roles cannot reach `foa_staging` and the staging
roles reach nothing else, the role timeouts hold through the pool (a 16 s
query as `foa_app` is cancelled), and refusals (superuser, admin console,
`foa_seed`, cross-environment logins, plaintext, wrong host name). Passwords
never appear on a command line (`ps`): the URLs are split into libpq
variables in a 0600 env file, passed with `docker run --env-file` and removed
afterwards.

## Monitoring and alerts

Uptime checks run at an outside provider (HR-23: provider, account and
alert target are the owner's choice), so they see what users see, and they
only call public URLs: nothing on the VPS needs to be reachable for them.
Each check alerts on its own, so a stalled worker never pages as "the app
is down". Staging is `https://shipped-it.dev`; production gets the same
app and worker checks once its domain is live.

| Check  | Target                                      | Runs from                     | Alerts when                                                                                         | Alert goes to             | Silence and un-silence                                                                                                        |
| ------ | ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| App    | `GET` `/api/health`                         | Uptime provider, every minute | Not 200 on 2 checks in a row. 503 means the app can't query its database                            | Owner (HR-23)             | Pause the monitor (or open a maintenance window) in the provider; resume it after. A paused monitor never re-alerts by itself |
| Pooler | TCP `db.shipped-it.dev:6432`                | Uptime provider, every minute | Connect fails on 2 checks in a row. TCP connect only, no login: probes must not fill CrowdSec's log | Owner (HR-23)             | Same as App. If CrowdSec ever bans the provider's addresses, add them to `crowdsec/foa-whitelist.yaml`                        |
| Worker | `GET` `/api/health/worker`                  | Uptime provider, every minute | Not 200 on 2 checks in a row: 503 `stale` (newest heartbeat over 120 s old) or `missing` (none)     | Owner (HR-23)             | Same as App. Pause it while the workers are stopped on purpose, and until HR-07 first starts them                             |
| Errors | Sentry projects for the app and the workers | Sentry (`SENTRY_DSN`, HR-22)  | A new issue, or a resolved one that comes back                                                      | Owner (Sentry alert rule) | In Sentry, Archive the issue (until it escalates, or for a time); Unarchive to hear about it again                            |

`/api/health/worker` answers from the app's own database: each worker
writes its `worker_heartbeat` row there after every poll (5 s), so the
staging URL reports `worker-staging` and production's reports
`worker-prod`. 200 is `{ "status": "ok", "worker": { "name", "ageSeconds" } }`;
503 is `stale` (with the same `worker`) or `missing`. Previews are not
monitored.

**Forced failure** (HR-23, and per milestone on staging, HR-27), without
touching production:

1. Worker: `docker compose -f /srv/foa/docker/workers.yml stop worker-staging`.
   After 120 s `https://shipped-it.dev/api/health/worker` turns 503
   `stale`, and two failed checks later (about 4 minutes in all) the alert
   arrives; `start worker-staging` clears it.
2. App and pooler: add a throwaway monitor for `/api/health/does-not-exist`
   and one for TCP `db.shipped-it.dev:6433` (closed). Both alert; delete
   them after.
3. Errors, with the workers' DSN set: start a throwaway staging worker
   pointed at a port nothing listens on. It fails to start, reports that
   to Sentry (`where` `worker.main`, `environment` `staging`) and exits 1;
   the alert rule fires.

   ```sh
   docker compose -f /srv/foa/docker/workers.yml run --rm \
     -e WORKER_DATABASE_URL=postgres://staging_worker@10.112.12.11:5999/foa_staging \
     worker-staging
   ```

## Logs

Logs are kept for 365 days. On the VPS they stay in the host's journal
today; an off-box copy, and the app's logs from Vercel, go to one store
once the owner picks it (HR-24).

| Source                                                                    | Goes to                                                      | Kept                                                      | Read with                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Containers: `foa-pg-prod`, `foa-pg-nonprod`, `foa-pgbouncer`, the workers | Host journal, through Docker's journald driver (`x-logging`) | 12 to 13 months, at most 20 GiB                           | `docker logs foa-pgbouncer`, `docker compose -f /srv/foa/docker/workers.yml logs worker-staging`, `journalctl -t foa-pg-prod --since 2026-11-01`; after a container is gone, `journalctl CONTAINER_NAME=foa-pg-prod` |
| Host units (`foa-*` timers and services, CrowdSec, sshd)                  | Host journal                                                 | Same                                                      | `journalctl -u foa-pgbackrest-full.service --since -7d`                                                                                                                                                              |
| Restore drills                                                            | `/var/log/foa/` (never pruned)                               | Forever                                                   | See "Restore drill"                                                                                                                                                                                                  |
| The app on Vercel (functions, builds, requests)                           | Vercel's runtime logs, then a Vercel log drain (HR-24)       | Vercel: a short, plan-bound window. Drain store: 365 days | Vercel dashboard or `vercel logs`; the store's search once the drain exists                                                                                                                                          |

`docker/systemd/journald-foa.conf` sets the year (`MaxRetentionSec=1year`,
monthly files), the 20 GiB cap and a higher rate limit, since every
container's lines reach journald through dockerd and share one limit. If
the cap fills first, the oldest files go early: `journalctl --disk-usage`
shows how close it is, and the off-box store is the answer, not a bigger
cap on the database disk. Container logs carry client IP addresses
(PgBouncer, CrowdSec); keeping them a year waits on counsel (HR-30).

Install, once (HR-24):

```sh
install -D -m 0644 /srv/foa/docker/systemd/journald-foa.conf \
  /etc/systemd/journald.conf.d/foa.conf
systemctl restart systemd-journald
journalctl --disk-usage
# Recreates the containers with the journald driver. Postgres restarts:
# pick a quiet moment. Lines logged before the switch go with the old containers.
docker compose -f /srv/foa/docker/compose.yml up -d --wait
docker inspect -f '{{.HostConfig.LogConfig.Type}}' foa-pgbouncer   # journald
```

Off-box (HR-24): in Vercel, Team Settings → Drains → add a log drain for
the project to the chosen store; on the VPS, a shipper that reads the
journal (for example `systemd-journal-upload`, or the store's own agent)
sends the same entries there. The store keeps 365 days.

## TODO and owner actions

1. **Vercel Static IPs** (deferred): allowlist them in
   `/etc/foa/firewall.env`, the Hostinger firewall and the CrowdSec whitelist.
   Until then 6432 is open to the internet, protected by TLS, SCRAM with
   32-byte random passwords, PgBouncer 1.26.1 and CrowdSec. Vercel **builds**
   run in `iad1` (Washington), not in `bom1` with the functions, and the
   migrations run in the build: turning on "Use Static IPs for builds" needs a
   static-IP region for builds as well, and its IPs on the allowlist, or the
   allowlist blocks every migration.
2. **Off-site backups on FOA's Cloudflare (#18)**: pgBackRest `repo2` on R2
   (own passphrase), plus a daily `age`-encrypted `pg_dump` to a separate,
   bucket-locked R2 bucket kept 35 days. Until then backups live on the same
   disk as the database.
3. **Hostinger managed firewall**: if it is ever enabled it must allow TCP 22,
   80 (ACME renewals) and 6432, with the SSH rule added first.
4. **Offline copy** of `/etc/foa/secrets/pgbackrest_repo1_cipher_pass` with
   the owner.
5. **Alerting** (operations ticket): failed `foa-pgbackrest-*`,
   `foa-restore-drill`, `foa-cert-renew` or archiving
   (`pg_stat_archiver.failed_count`), and a periodic `pgbackrest check`. The
   restore drill cannot see archiving that has stalled, because it can only
   replay the WAL that reached the repository.
6. **Workers (HR-07):** apply the roles and start `workers.yml` (Workers,
   "First start"), and settle the CPU and memory caps there for the shared
   VPS.
7. **One build per branch** (owner): Vercel → Project Settings → Build and
   Deployment → On-Demand Concurrent Builds → "Run up to one build per
   branch". The API refused the change for lack of permission. Meanwhile the
   migration's advisory lock keeps concurrent builds of one branch from
   applying the same migration twice.
