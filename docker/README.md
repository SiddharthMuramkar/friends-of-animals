# VPS database stack (runbook)

Postgres and PgBouncer for FOA on the Hostinger Mumbai VPS (issue #12). This
directory is the whole deployment; the VPS runs it from a clone at **`/srv/foa`** (systemd
units and bind mounts point there, never at a developer worktree).

The VPS runs **Fedora 44** (firewalld on nftables, dnf, Docker 29 with the
containerd image store). It ran Ubuntu before, and the scripts still handle
both; where the two differ, this runbook says which is which.

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
- **PgBouncer** is the only public endpoint: `db.friendsofanimals.dev:6432`
  (`FOA_DB_DOMAIN`, see TLS certificate), TLS required (Let's Encrypt),
  SCRAM, transaction pooling.
- **One Postgres image**: only pg-prod has `build: ./postgres`; pg-nonprod
  runs the same tag with `pull_policy: never`. Two services building one tag
  export it twice in parallel, which the containerd image store (Docker 29's
  default on a fresh install) can fail with `image "...": already exists`.
  `up --build` builds before it creates containers, so the whole-stack
  commands in this runbook work, but `docker compose up pg-nonprod` on its own
  fails until pg-prod's image exists (build it first with
  `docker compose -f compose.yml build pg-prod`).
- **Memory limits are hard** (`mem_limit`). `memswap_limit` equals `mem_limit`
  on all three to keep them out of swap, but on Docker 29.10 with runc 1.5.3
  and the systemd cgroup driver that never reaches the cgroup
  (`memory.swap.max` stays `max`), so today they can still swap into zram
  under pressure. The setting stays so it applies once runc passes it on.
- **OOM order**: `oom_score_adj: -900` on all three, so under memory pressure
  the kernel kills the agents and test runs sharing the box before any
  database process.

Host side: systemd units in `systemd/` (firewall, certificate renewal,
backups, restore drill, preview sweep) and CrowdSec (`crowdsec/`).

| Path                                                         | What                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| `compose.yml`                                                | The stack                                                   |
| `postgres/{prod,nonprod}.conf`, `pg_hba.{prod,nonprod}.conf` | Server config (`postgres/` is mounted at `/etc/postgresql`) |
| `postgres/pgbackrest.conf`                                   | pgBackRest (pg-prod, `PGBACKREST_CONFIG`)                   |
| `postgres/bootstrap/*.sql`, `initdb/`                        | Roles, databases, privileges (idempotent)                   |
| `pgbouncer/pgbouncer.ini`                                    | Routing, pooling, TLS                                       |
| `scripts/`                                                   | Host scripts (all idempotent, run as root)                  |
| `systemd/`                                                   | Units, linked into `/etc/systemd/system`                    |
| `crowdsec/`                                                  | Both OSes: acquisition, local parser, whitelist, drop-ins   |
| `crowdsec/crowdsec.repo`, `*-bouncer-nftables.yaml.local`    | Fedora: dnf repository, nftables bouncer settings           |
| `crowdsec/crowdsec.sources`, `*-bouncer-iptables.yaml.local` | Ubuntu: apt source, iptables bouncer settings               |
| `analytics.yml`                                              | Umami (Analytics, below)                                    |
| `edge.yml`, `caddy/Caddyfile`                                | Caddy, the TLS edge (Edge, below)                           |
| `errors.yml`                                                 | GlitchTip (Errors, below)                                   |

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
| `/etc/foa/secrets/worker_sentry.env` (optional, HR-22)  | root, 0600      | `SENTRY_DSN=` for every worker        |
| `/etc/foa/secrets/worker_prod_r2.env` (optional, HR-08) | root, 0600      | Prod bucket `R2_*`, worker-prod only  |
| `/etc/foa/secrets/worker_media_r2.env` (optional)       | root, 0600      | Prod bucket `R2_*`, worker-media only |
| `/etc/foa/secrets/worker_prod_field_keys.env`           | root, 0600      | App `FIELD_*` keys, worker-prod only  |
| `/etc/foa/preview-files.env` (optional)                 | root, 0600      | Non-prod `R2_*`: staging, previews    |
| `/etc/foa/secrets/pgbouncer_userlist.txt`               | 6432, 0400      | PgBouncer `auth_file` (derived)       |
| `/etc/foa/secrets/pgbackrest_repo1_cipher_pass`         | root, 0400      | pgBackRest repo1 passphrase           |
| `/etc/foa/secrets/pgbackrest_cipher.conf`               | 999, 0400       | pgBackRest `conf.d` snippet (derived) |
| `/etc/foa/vercel-urls.env`                              | root, 0600      | URLs to paste into Vercel (derived)   |
| `/etc/foa/lego/`                                        | root, 0700      | ACME account key, certificate, key    |
| `/etc/foa/pgbouncer-tls/`                               | root:6432, 0750 | Installed cert (0444) and key (0400)  |

999 is `postgres` inside the Postgres image; 6432 is `pgbouncer` in ours;
1000 is `node` in the worker image. The worker secrets come from
`scripts/worker-roles.sh` (Workers, below), not `bootstrap-secrets.sh`;
the optional `.env` files are written by hand (Workers, "Scan, PDF and
media sidecars" and "Links and field keys").
Passwords are 32 random bytes as hex (URL-safe). Containers get them as
Compose secrets (`/run/secrets/...`), never as environment values.

`vercel-urls.env` has exactly these keys (host `FOA_DB_DOMAIN`, default
`db.friendsofanimals.dev`; port 6432; `?sslmode=verify-full`):

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

**Fedora prerequisites**, as root, before the bring-up block below:

1. Install Docker from Docker's own repository
   (`download.docker.com/linux/fedora`), `docker-buildx-plugin` included:
   Compose refuses `up --build` without buildx 0.17 or later. Then check the
   host tools the scripts call (`gdbus` from `glib2` runs the firewall unit's
   watcher, `flock` comes with `util-linux`) and `dnf install` any that are
   missing.

   ```sh
   dnf config-manager addrepo --from-repofile https://download.docker.com/linux/fedora/docker-ce.repo
   dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   rpm -q openssl diffutils coreutils gawk jq git-core curl iproute ca-certificates glib2 util-linux
   ```

2. Write `/etc/docker/daemon.json` before Docker's first start.
   `"firewall-backend": "iptables"` pins the backend that has `DOCKER-USER`,
   which the firewall unit needs (the nftables backend, experimental in
   Docker 29, has none), and `iptables` and `ip6tables` make Docker create
   that chain for both families. The other keys are the defaults plus log
   rotation for the throwaway containers (lego, smoke test, restore drill);
   the compose services set their own. Left out on purpose:
   `ip-forward-no-drop` (Docker sets the FORWARD policy to DROP, which is
   wanted, because firewalld's public zone allows forwarding) and
   `live-restore` (containers should get a clean SIGINT when Docker stops).

   ```sh
   install -d -m 0755 /etc/docker
   cat > /etc/docker/daemon.json <<'EOF'
   {
     "firewall-backend": "iptables",
     "iptables": true,
     "ip6tables": true,
     "userland-proxy": true,
     "log-driver": "json-file",
     "log-opts": { "max-size": "50m", "max-file": "5" }
   }
   EOF
   chmod 0644 /etc/docker/daemon.json
   dockerd --validate --config-file=/etc/docker/daemon.json   # configuration OK
   ```

3. Add two systemd drop-ins. On `systemctl stop docker` or
   `systemctl restart docker`, dockerd gives Postgres its 120 s
   `stop_grace_period` for the shutdown checkpoint, but systemd kills dockerd
   after Fedora's default 45 s (docker.service sets no stop timeout of its
   own); 180 s lets the grace period apply. A reboot is different: systemd
   stops the container scopes itself, with the 45 s default, and a slow
   checkpoint then ends in crash recovery on the next start (safe, just
   slower). Fedora's systemd-oomd also watches `system.slice`, where Docker
   runs the containers (`10-oomd-per-slice-defaults.conf`, kill at 80 %
   memory pressure), so pressure from interactive work could SIGKILL
   foa-pg-prod. `auto` takes `system.slice`, sshd included, off its list; the
   kernel OOM killer still applies, and `user@0.service` is still watched, so
   interactive work is killed first.

   ```sh
   install -d -m 0755 /etc/systemd/system/docker.service.d /etc/systemd/system/system.slice.d
   printf '[Service]\nTimeoutStopSec=180s\n' > /etc/systemd/system/docker.service.d/50-foa-stop-timeout.conf
   printf '[Slice]\nManagedOOMMemoryPressure=auto\n' > /etc/systemd/system/system.slice.d/50-foa-no-oomd-kill.conf
   systemctl daemon-reload
   ```

4. Start Docker. The RPM neither enables nor starts it (Fedora's preset
   enables only `docker.socket`), and the stack needs dockerd from boot;
   `scripts/install-systemd.sh` enables it again later.

   ```sh
   systemctl enable --now docker
   docker info 2>/dev/null | grep -E 'Firewall Backend|Storage Driver|driver-type|Cgroup Driver|Logging Driver'
   #   iptables+firewalld, overlayfs (containerd snapshotter), systemd, json-file
   ```

**Bring-up**, on either OS (the `firewall-cmd` lines are Fedora-only):

```sh
git clone https://github.com/SiddharthMuramkar/friends-of-animals.git /srv/foa
cd /srv/foa/docker
scripts/bootstrap-secrets.sh                 # /etc/foa/...
scripts/install-cert.sh                      # placeholder cert so PgBouncer can start
docker compose -f compose.yml up -d --build --wait
#   first start runs postgres/initdb -> bootstrap: roles, foa, foa_seed, foa_staging
docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa stanza-create
docker exec -u postgres foa-pg-prod pgbackrest --stanza=foa check
#   Fedora: let Let's Encrypt reach lego on port 80 (runtime + permanent, no reload)
firewall-cmd --zone=public --add-service=http
firewall-cmd --permanent --zone=public --add-service=http
scripts/cert-renew.sh --staging              # optional dry run against LE staging
scripts/cert-renew.sh                        # real certificate, installs + reloads PgBouncer
scripts/install-systemd.sh                   # enables docker.service, firewall unit + timers
scripts/install-crowdsec.sh                  # dnf + nftables bouncer (Ubuntu: apt + iptables)
#   at once, with the owner's SSH session open: the foa-admin allowlist (CrowdSec)
cscli allowlists inspect foa-admin >/dev/null 2>&1 ||
  cscli allowlists create foa-admin -d "FOA: VPS addresses and the owner's SSH client"
cscli allowlists add foa-admin 189.72.156.29 2a02:4780:63:e413::1 \
  $(ss -Htn state established '( sport = :22 )' | awk '{print $4}' |
    sed -E 's/:[0-9]+$//; s/^\[//; s/\]$//' | sort -u)
systemctl start foa-pgbackrest-full.service  # first full backup
scripts/restore-drill.sh
scripts/smoke-test.sh                        # client checks through db.friendsofanimals.dev:6432
```

Then copy the values from `/etc/foa/vercel-urls.env` into Vercel, as
`DATABASE_URL` and `DIRECT_URL`: `PROD_*` into Production. `STAGING_*` and
`PREVIEW_*` stay unused while Vercel has no staging environment and no
previews ([ADR 0001](../docs/adr/0001-ci-e2e-and-prebuilt-deploys.md)).

To rebuild production from backups instead of starting empty, run the
`pgbackrest restore` (below) into the `foa-vps_pg-prod-data` volume _before_
the first `up` of pg-prod (an initialised volume skips `initdb`, and the
restored cluster already has its roles). On a new machine that needs the
off-site repo2; the local repo1 dies with the old VPS.

Updating: `git -C /srv/foa pull`, then `docker compose -f
/srv/foa/docker/compose.yml up -d --build --wait` and, if units changed,
`systemctl daemon-reload`; if the firewall unit or `docker-user-fw.sh`
changed, also `systemctl restart foa-docker-user-fw` (its watcher goes on
running the old version until then). Config-only PgBouncer changes: `docker
kill -s HUP foa-pgbouncer`. Postgres config changes: `SELECT pg_reload_conf()`
(or `docker restart foa-pg-prod` for settings that need a server start);
`pgbackrest.conf` is read by every pgBackRest command. That works because
the config is mounted as directories (`postgres/` at `/etc/postgresql`,
`pgbouncer/` at `/etc/pgbouncer/foa`): git replaces a file on checkout, and a
single-file bind mount would go on showing the container the old one.

Docker upgrades restart dockerd and with it the whole stack (`live-restore`
is off), so schedule them. On Fedora, dnf5-automatic (security updates only)
never upgrades Docker, because Docker's repository publishes no advisories.

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

- PgBouncer's host name is `FOA_DB_DOMAIN`, default `db.friendsofanimals.dev`
  (an A record to 189.72.156.29). `cert-renew.sh`, `install-cert.sh`,
  `bootstrap-secrets.sh` and `smoke-test.sh` read it through
  `scripts/db-host.sh`, which stops them (exit 2) on a value that isn't a
  lower-case host name. Given `--print-config`, each prints its settings
  (`cert-renew.sh` also the lego command) and changes nothing.
  `foa-cert-renew.service` reads optional settings from
  `/etc/foa/db-host.env` (not secret), for example:

  ```sh
  # More names on the certificate, space-separated
  FOA_DB_DOMAIN_ALIASES=db.old.example
  # ACME account e-mail
  FOA_ACME_EMAIL=ops@example.org
  ```

  systemd reads that file (`EnvironmentFile=`) and keeps everything after
  the `=` as the value, a `#` included, so a comment goes on a line of its
  own. `cert-renew.sh` refuses (exit 2) a name, e-mail or webroot with a
  comment left in it rather than pass it to lego. A shell's
  `. /etc/foa/db-host.env` drops such a comment, so check the file the way
  the timer reads it:

  ```sh
  systemd-run --wait --pipe -q -p EnvironmentFile=/etc/foa/db-host.env \
    /srv/foa/docker/scripts/cert-renew.sh --print-config
  ```

  Only that service reads the file. Run by hand, the scripts take
  `FOA_DB_DOMAIN` from the environment, so if the file sets it, export the
  same value first. (`smoke-test.sh` stops when a URL in `vercel-urls.env`
  names another host.)

- Let's Encrypt via **HTTP-01** with `goacme/lego:v5.6.0` (`--network host`).
  Not DNS-01: that would need an account-wide Vercel token on this box. No
  ACME account e-mail is registered (set `FOA_ACME_EMAIL` to add one).
  - While nothing else holds port 80 on the public address, lego answers the
    challenge itself, listening only on `189.72.156.29:80` for the seconds a
    challenge takes (a service on `127.0.0.1:80` doesn't count).
  - Once another server holds it (foa-caddy listens on every address), lego
    writes the challenge into `FOA_ACME_WEBROOT` (default
    `/var/lib/foa/acme-webroot`), and that server must serve the directory's
    `/.well-known/acme-challenge/` on port 80 for every name on the
    certificate. The webroot must be a directory under `/var/lib/foa`: the
    run makes it root's with mode 0755, even one that already exists.
    foa-caddy (compose project `foa-edge` in `edge.yml`) mounts the directory
    read-only at `/srv/acme` and has a site block for each name:

    ```caddyfile
    http://db.friendsofanimals.dev {
      handle /.well-known/acme-challenge/* {
        root * /srv/acme
        file_server
      }
      handle {
        respond 404
      }
    }
    ```
- `FOA_DB_DOMAIN_ALIASES` (space-separated) puts more names on the same
  certificate, after the host: PgBouncer serves one certificate, so a host
  name being retired keeps working until it is dropped from the list. The
  certificate holds exactly the host and these names (lego
  `--force-cert-domains`; a name listed twice counts once). The first run
  after the list changes re-issues it, with a new name added or a dropped
  one taken off. Every name must resolve to this host whenever lego orders,
  or the whole order fails, so drop a name from the list before its DNS
  goes.
- Port 80 must get through the host's INPUT filter: on Fedora that is the
  `http` service in firewalld's public zone (Firewall, below); on Ubuntu ufw
  is inactive. `cert-renew.sh` warns, and changes nothing, when firewalld's
  zone for that address allows neither the `http` service nor 80/tcp.
- The database host has no AAAA record. Adding one would break renewals:
  Let's Encrypt tries IPv6 first and falls back to IPv4 only on a timeout,
  and port 80 answers on the IPv4 address only.
- `foa-cert-renew.timer` runs `scripts/cert-renew.sh` daily: `lego run
  --renew-days 30` renews below 30 days left (or when the CA's renewal info
  asks, or the names changed), then `scripts/install-cert.sh` copies cert +
  key into `/etc/foa/pgbouncer-tls` if they changed and sends SIGHUP
  (RELOAD) to PgBouncer. New connections get the new certificate; open ones
  keep theirs.
- A certificate issued elsewhere (for example from Caddy's storage) goes in
  with `FOA_CERT_CRT=<crt> FOA_CERT_KEY=<key> scripts/install-cert.sh`: the
  same key match check, owners, modes and reload. It refuses one variable
  without the other, a missing or empty file, or a certificate that doesn't
  name `FOA_DB_DOMAIN` or has a day or less left (exit 1, nothing
  installed). `cert-renew.sh` always installs lego's pair.
- Let's Encrypt lifetimes drop to 64 days on 2027-02-10 and 45 days on
  2028-02-16; the daily timer covers both. Watch `journalctl -u
  foa-cert-renew` (alerting is a TODO).
- Manual: `systemctl start foa-cert-renew.service`; check with
  `openssl s_client -connect db.friendsofanimals.dev:6432 -starttls postgres -servername db.friendsofanimals.dev </dev/null`.

## Firewall

The host firewall is firewalld on Fedora (nftables backend, eth0 in zone
`public`) and ufw on Ubuntu (inactive there). Neither filters
Docker-published ports: Docker DNATs them before INPUT, so they take the
FORWARD path. firewalld puts Docker's bridges in its `docker` zone with a
`docker-forwarding` policy, and with `StrictForwardPorts=no` it accepts every
DNAT-ed connection, so a published port passes whatever the public zone
lists. Don't add 6432 to firewalld; it isn't needed.

`foa-docker-user-fw.service` runs `scripts/docker-user-fw.sh`, which keeps a
chain `FOA-INBOUND`, jumped to from `DOCKER-USER` for `-i eth0` (set
`FOA_EXT_IF` in `/etc/foa/firewall.env` for another interface), IPv4 and
IPv6:

1. `ESTABLISHED,RELATED` → RETURN
2. new TCP whose conntrack original destination port is 6432 → RETURN
   (from anywhere for now)
3. everything else → DROP

`DOCKER-USER` exists only with Docker's iptables firewall backend
(iptables-nft on Fedora), hence the pin in `/etc/docker/daemon.json`.
iptables-nft's FORWARD chain runs before firewalld's (priority filter against
filter + 10), and an nftables drop is final, so the DROP holds whatever
firewalld accepts afterwards.

The unit is `Type=simple`. `ExecStartPre` runs `apply`, which waits up to
about 30 s for `DOCKER-USER`; `ExecStart` runs `watch`, which follows
firewalld on D-Bus (`gdbus monitor`) and re-applies the rules, IPv4 and IPv6,
after every firewalld reload and whenever firewalld starts or stops.
`PartOf=docker.service` re-runs it whenever Docker restarts. A failed apply or
a dead watcher is retried every 30 s, re-applying first. Without firewalld
installed (Ubuntu), `watch` exits at once and the unit stays active (exited).
`systemctl reload foa-docker-user-fw` re-applies the rules;
`scripts/docker-user-fw.sh show` prints the FORWARD jump, `DOCKER-USER` and
`FOA-INBOUND`.

**Never use `firewall-cmd --direct` or `/etc/firewalld/direct.xml`.**
firewalld leaves the iptables-nft tables alone only while it has no direct
configuration of its own. With any direct rule, chain or passthrough it
flushes them on every reload, start and stop, taking Docker's NAT and
`FOA-INBOUND` with them, and adding the first one flushes them at once, with
no signal for the watcher to catch (`systemctl restart docker` restores them).

Host ports are INPUT traffic, which this unit never touches:

- **SSH**: the `ssh` service in firewalld's public zone and the SSH config
  are left untouched (Ubuntu: ufw untouched).
- **Port 80** for ACME (lego runs on the host network), opened in the runtime
  and the permanent configuration, so no reload is needed:

  ```sh
  firewall-cmd --zone=public --add-service=http
  firewall-cmd --permanent --zone=public --add-service=http
  ```

  It stays open, IPv4 and IPv6. Caddy listens there (Edge, below); while it
  is stopped, nothing listens outside a challenge, and the kernel answers
  with a reset. Ubuntu: ufw is inactive, nothing to do.

- **Port 443** for Caddy (Edge, below), opened the same way:

  ```sh
  firewall-cmd --zone=public --add-service=https
  firewall-cmd --permanent --zone=public --add-service=https
  ```

CrowdSec's bouncer blocks banned addresses on top of all this (below). Any
port published later must bind 127.0.0.1; this chain drops it on eth0
regardless. Docker enables IP forwarding and sets the iptables FORWARD policy
to DROP, so a future rootful podman or libvirt bridge would need its own
accept in `DOCKER-USER`.

**Allowlist (TODO):** when Vercel Static IPs are bought, put them in
`/etc/foa/firewall.env` as `PGBOUNCER_ALLOWED_SOURCES="<ip>/32 <ip>/32"` and
`systemctl restart foa-docker-user-fw` (restart, not reload: the running
watcher would put the old list back at the next firewalld event); also allow
only them on 6432 in the Hostinger firewall and whitelist them in CrowdSec
(`crowdsec/foa-whitelist.yaml` and a LAPI allowlist, below).

## CrowdSec

`scripts/install-crowdsec.sh` installs CrowdSec 1.8 and its firewall bouncer
from CrowdSec's own package repository on packagecloud (no `curl | bash`; the
signing keys' fingerprints are pinned in the script). It picks the OS by `ID`
in `/etc/os-release`:

- **Fedora** (this VPS): dnf, with `crowdsec/crowdsec.repo`, packagecloud's
  `rpm_any` tree of EL9 builds (static Go binaries): Fedora's repositories
  have no crowdsec, and packagecloud's Fedora trees are empty. dnf checks the
  repository metadata and every package against the two pinned keys, and
  `includepkgs` keeps the repository to CrowdSec's own packages. The bouncer
  is `crowdsec-firewall-bouncer-nftables`
  (`crowdsec-firewall-bouncer-nftables.yaml.local`). It keeps its own tables,
  `ip crowdsec` and `ip6 crowdsec6`, with a chain on the input hook (SSH and
  other host services) and one on the forward hook (PgBouncer's published
  port, DNAT-ed before it could reach input), at priority -10: ahead of
  Docker's FORWARD (0) and firewalld (+10), and a drop is final. firewalld and
  Docker never touch these tables, so bans survive `firewall-cmd --reload` and
  Docker restarts. The RPM signing key expires 2027-05-12; re-running the
  script fetches the extended key.
- **Ubuntu**: apt, with `crowdsec/crowdsec.sources` as a deb822 source
  (Ubuntu's archive only has 1.4.6; upstream's `noble` builds are used), and
  `crowdsec-firewall-bouncer-iptables`
  (`crowdsec-firewall-bouncer-iptables.yaml.local`), which adds its own jump
  at the top of `INPUT` and `DOCKER-USER`.

On both it installs the `crowdsecurity/pgsql` collection, the acquisition of
the `foa-pgbouncer` container's docker logs (`type: pgbouncer`), a local
parser for PgBouncer's `closing because: no such user` (logins as `postgres`
or unknown roles, which the hub parser misses), and a whitelist for the VPS's
own addresses (IPv4 and IPv6) and the compose subnet.

It also installs the `crowdsecurity/caddy` collection (the generic HTTP
scenarios) on foa-caddy's JSON access log. Caddy writes it to stdout for the
stats and errors sites (`caddy/Caddyfile`), the logging driver puts it in
journald, and `crowdsec/acquis-foa-caddy.yaml` reads it from there
(`CONTAINER_NAME=foa-caddy`, `PRIORITY=6`: stdout only, not Caddy's own
log). It also passes `--output=cat`: CrowdSec runs `journalctl --follow -n 0`
with the filter entries appended and no output mode of its own, and in
journalctl's default format each line starts with
`<date> <host> foa-caddy[<pid>]: `, which the caddy parser can't read.
Nearly every request reaching the edge comes from Vercel's shared egress
addresses: the site's `/stats` rewrites and the Sentry envelopes. A ban on
one of them would cut it off from PgBouncer too, so Caddy doesn't log
exactly those paths (`/script.js` and `/api/send` on stats,
`/api/<project>/envelope/` on errors; Edge, below), for every method and
query string: the rewrites match the path only and forward both, so a
visitor could otherwise send `PUT /stats/script.js` or a probe query and
get Vercel's address logged. CrowdSec never sees those paths, so it misses
a direct scanner on them too (TODO, "Edge rate limit"). Anything else, from
anyone, still counts. systemd drop-ins start
crowdsec (its docker acquisition makes it exit if the Docker API is not up
yet) and the bouncer after Docker. Brute force (5 failures, leaking 1 per
10 s) bans the source.

That whitelist is a parser whitelist: it stops local alerts only, not
community blocklist entries. The LAPI allowlist **`foa-admin`** covers both.
It holds the VPS's two addresses and the owner's SSH clients, added right
after the install (Bring-up, above). **SSH lock-out:** a ban drops
established SSH sessions too, the Fedora RPM turns on the sshd scenarios, and
a home IP can change after the allowlist was made; add a new one with
`cscli allowlists add foa-admin <ip>`. If the owner is locked out anyway,
open the Hostinger browser console and run `cscli decisions delete --ip <ip>`.

```sh
cscli metrics show acquisition parsers   # docker:foa-pgbouncer, journalctl (foa-caddy) lines read/parsed
cscli alerts list; cscli decisions list
cscli decisions delete --ip <ip>         # unban
cscli allowlists inspect foa-admin
cscli explain --type pgbouncer --log '<log line>'
journalctl -n 1 -o cat CONTAINER_NAME=foa-caddy PRIORITY=6 > /tmp/caddy.log
cscli explain --type caddy -f /tmp/caddy.log   # caddy-logs: parser success
nft list table ip crowdsec               # Fedora: the bouncer's chains and ban sets
```

Shared Vercel egress IPs could be banned if the app fails logins repeatedly,
if someone scans the edge from their own Vercel functions (the HTTP
scenarios ban at the host, PgBouncer included), or if they land on a
community blocklist: whitelist the Static IPs when they exist,
in `crowdsec/foa-whitelist.yaml` and a LAPI allowlist.

[CrowdSec issue #4781](https://github.com/crowdsecurity/crowdsec/issues/4781):
the docker acquisition leaks a stream in dockerd for every container log
line over 64 KiB. PgBouncer's lines are short, but if
`ls /proc/$(pidof dockerd)/fd | wc -l` keeps growing, run
`systemctl restart crowdsec`.

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

## Off-site copy of files (Backblaze B2)

R2 keeps no old versions, so production's uploaded files are copied every
night to one Backblaze B2 bucket (#68). The copy runs inside `worker-prod` as
the pg-boss schedule `offsite_copy`
(`src/server/modules/offsite-copy/schedule.ts`), so it starts once #61's
worker (`docker/workers.yml`) is deployed. Staging, previews and local runs
never copy.

- **When:** 01:30 IST, an hour before pgBackRest. A run starts no new copy
  after two hours; what is left waits for the next night (the first full copy
  can take several nights) and doesn't count as a failure.
- **What:** every object in `OFFSITE_SOURCE_BUCKETS` that is new or changed
  (etag or size) since its last copy, to `<B2_BUCKET>/<source bucket>/<key>`,
  with its type, its metadata and its R2 etag as `foa-source-etag`. Keys under
  `staging/`, `local/`, `pr-<n>/` or `br-<hash>/` are never copied. A
  single-part object goes with its Content-MD5, so B2 refuses damaged bytes,
  and every write asks for SSE-B2. The table `offsite_copy` records each copy.
- **Deletions:** an object gone from R2 is marked, and its copy stays for
  `OFFSITE_RETENTION_DAYS` (30) counted from the first night that found it
  gone; then the copy and its row are deleted. An object back in R2 before
  then is unmarked (and copied again only if it changed). A listing that comes
  back empty while B2 holds live copies refuses that bucket, as a wrong bucket
  or token would look. Marking more than a tenth of a bucket's copies (ten or
  more) in one night sends a Sentry warning: the retention window is the time
  to look.
- **A bucket that is really empty now** (every file deleted on purpose) is
  refused every night, with a Sentry event on each final attempt. Once you
  have checked in R2 that it is empty, start its retention window by hand,
  on pg-prod's `foa` as a member of `foa_app`:
  `UPDATE offsite_copy SET deleted_in_source_at = now() WHERE source_bucket =
  '<bucket>' AND deleted_in_source_at IS NULL;`. The copies stay for
  `OFFSITE_RETENTION_DAYS`, then go as usual.
- **Failures:** a run with a failed copy, purge or listing throws, and pg-boss
  retries it three times, 15 minutes apart with backoff (each attempt expires
  after three hours). A retry copies only what is still missing. Sentry gets
  one event on the final attempt (tag `job:offsite_copy`) with counts and at
  most ten keys. Production without its settings fails the same way and names
  each missing variable.
- **Losing `offsite_copy`** is safe: the next run copies everything again and
  never deletes a copy it has no row for.

Owner setup (HR-25, HR-13): a private B2 bucket with default encryption
(SSE-B2) on and a lifecycle rule that keeps prior versions for 1-7 days (an
S3 delete only hides a B2 file, so this is a second, short safety net), and
an application key restricted to that bucket with `listFiles`, `readFiles`,
`writeFiles` and `deleteFiles`. In R2, an API token with Object Read only on
the production buckets. The restore needs a separate token that may write;
the operator keeps it, not the VPS.

### Settings (worker-prod only)

Each variable can be given as `<NAME>_FILE`, the path of a file holding the
value. Keys and secrets arrive that way, as Compose secrets, never as
environment values.

| Variable                       | What                                                    | Secret |
| ------------------------------ | ------------------------------------------------------- | ------ |
| `APP_ENV`                      | `production`; anything else copies nothing              | no     |
| `OFFSITE_SOURCE_BUCKETS`       | The production R2 buckets, separated by commas          | no     |
| `OFFSITE_RETENTION_DAYS`       | Days a copy outlives its object (1-3650, default 30)    | no     |
| `R2_ACCOUNT_ID`                | The Cloudflare account id (32 hex characters)           | no     |
| `OFFSITE_R2_ACCESS_KEY_ID`     | The read-only R2 token's key id                         | yes    |
| `OFFSITE_R2_SECRET_ACCESS_KEY` | The read-only R2 token's secret                         | yes    |
| `B2_S3_ENDPOINT`               | B2's S3 endpoint, `https://s3.<region>.backblazeb2.com` | no     |
| `B2_REGION`                    | The B2 region, e.g. `eu-central-003`                    | no     |
| `B2_BUCKET`                    | The B2 bucket; not one of the source buckets            | no     |
| `B2_KEY_ID`                    | The B2 application key's id                             | yes    |
| `B2_APPLICATION_KEY`           | The B2 application key                                  | yes    |

For `docker/workers.yml` (#61), `worker-prod` takes them like this, with each
secret file under `/etc/foa/secrets/` (0400, owned by the worker's user):

```yaml
services:
  worker-prod:
    environment:
      OFFSITE_SOURCE_BUCKETS: foa-files-prod
      R2_ACCOUNT_ID: <account id>
      OFFSITE_R2_ACCESS_KEY_ID_FILE: /run/secrets/offsite_r2_access_key_id
      OFFSITE_R2_SECRET_ACCESS_KEY_FILE: /run/secrets/offsite_r2_secret_access_key
      B2_S3_ENDPOINT: https://s3.<region>.backblazeb2.com
      B2_REGION: <region>
      B2_BUCKET: <bucket>
      B2_KEY_ID_FILE: /run/secrets/b2_key_id
      B2_APPLICATION_KEY_FILE: /run/secrets/b2_application_key
    secrets:
      - offsite_r2_access_key_id
      - offsite_r2_secret_access_key
      - b2_key_id
      - b2_application_key
secrets:
  offsite_r2_access_key_id:
    file: /etc/foa/secrets/offsite_r2_access_key_id
  offsite_r2_secret_access_key:
    file: /etc/foa/secrets/offsite_r2_secret_access_key
  b2_key_id:
    file: /etc/foa/secrets/b2_key_id
  b2_application_key:
    file: /etc/foa/secrets/b2_application_key
```

### Restore one file

You need the file's R2 bucket and key (`file_asset.bucket` and
`storage_key`, or the keys in the Sentry event) and the R2 token that may
write to the bucket you restore into. Type the token in; `-e NAME` without a
value hands the container your shell's value, so it never reaches the shell
history or the VPS's disk:

```sh
cd /srv/foa/docker
read -r OFFSITE_RESTORE_R2_ACCESS_KEY_ID
read -rs OFFSITE_RESTORE_R2_SECRET_ACCESS_KEY
export OFFSITE_RESTORE_R2_ACCESS_KEY_ID OFFSITE_RESTORE_R2_SECRET_ACCESS_KEY
docker compose -f workers.yml exec \
  -e OFFSITE_RESTORE_R2_ACCESS_KEY_ID -e OFFSITE_RESTORE_R2_SECRET_ACCESS_KEY \
  worker-prod pnpm offsite:restore --bucket <bucket> --key <key>
unset OFFSITE_RESTORE_R2_ACCESS_KEY_ID OFFSITE_RESTORE_R2_SECRET_ACCESS_KEY
```

- It writes the B2 copy back to `<bucket>/<key>` with its type and metadata,
  sending the Content-MD5 of the etag R2 had, so R2 refuses a damaged copy.
- An object already at that key is left alone: add `--overwrite` to replace
  it, or `--to <bucket>` to restore into another bucket first and compare.
- `B2 holds no copy`: check the bucket and key; a file deleted from R2 more
  than the retention window (plus a night) ago is gone, apart from B2's
  hidden versions for a few more days (restore one in B2's web console).
- Exit codes: 0 restored, 1 refused or failed (the message says why), 2 bad
  arguments.
- It restores bytes only. A `file_asset` row deleted along with the file
  must be put back separately.
- While it runs, the token is in the process's environment, so anyone who can
  read `/proc/<pid>/environ` in the container, or `docker inspect` the exec,
  can see it. Use a token made for this restore and revoke it afterwards.

## Preview databases and the sweeper

**Dormant.** There are no Vercel previews (see
[ADR 0001](../docs/adr/0001-ci-e2e-and-prebuilt-deploys.md)), so nothing
creates preview databases and the sweeper finds none. Kept for when previews
come back.

`scripts/sweep-preview-dbs.sh` (hourly via `foa-preview-sweep.timer`) lists
pg-nonprod databases whose comment starts with `foa-preview `:

- `pr=<n>`: dropped (`DROP DATABASE ... WITH (FORCE)`) when
  `GET /repos/SiddharthMuramkar/friends-of-animals/pulls/<n>` says
  `state=closed`;
- `branch=<ref>`: dropped when `git ls-remote --exit-code --heads` reports the
  branch gone (exit 2).

Anything uncertain (API error, rate limit, odd name or comment) is kept;
`foa_seed`, `foa_staging`, `postgres` and the templates are never touched,
and only names shaped like a preview's (`foa_pr_<n>_<fp>` or
`foa_br_[<slug>_]<hash>_<fp>`) whose comment matches the name's storage prefix
are dropped. `--dry-run`
prints what it would drop. Unauthenticated GitHub API calls are limited to 60
an hour; with many open previews, or if the repo goes private, put a read-only
`GITHUB_TOKEN=...` in `/etc/foa/sweeper.env` (0600).

Before each drop the sweeper records it in
`/var/lib/foa/preview-purge/<database>.pending` (`FOA_PREVIEW_PURGE_STATE`;
one sweep at a time, under a lock there). At the end of every sweep, for each
record whose storage prefix no database uses any more and whose PR is still
closed (or branch still gone), it runs `scripts/run-preview-dropped-hooks.sh
<database>`, which runs every executable `scripts/preview-dropped.d/*.sh`
with that name. The record goes once the hooks succeed; a failing hook is
logged and retried on the next sweep (a dry run runs none). To see what is
pending, `ls /var/lib/foa/preview-purge`. `50-purge-files.sh` deletes that
preview's files (`pr-<n>/` or `br-<hash>/` in the non-production bucket) by
running `pnpm files:purge-preview --database <name>` in the worker image
(`FOA_WORKER_IMAGE`, default `foa-workers/worker-preview`, the image
`workers.yml` builds; never pulled). It reads the
**non-production** bucket's `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` and `R2_BUCKET` from `/etc/foa/preview-files.env`
(root, 0600; never production's, and no `APP_ENV`: the hook sets
`APP_ENV=preview`). Without that file it fails and the files stay.

## Workers

`workers.yml` (Compose project `foa-workers`, issue #61) runs the background
workers and their sidecars next to the database stack. The database workers
join its `db` network (`foa-vps_db`, so start `compose.yml` first). Each runs
`src/worker/main.ts` from the
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
  `/api/health/worker` reads ("Monitoring and alerts").
  `restart: unless-stopped` restarts a worker that exits; Docker doesn't
  restart an unhealthy one, so watch `docker ps`.
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

### Reconciling a cancellation email

Set `SES_CONFIGURATION_SET` to a configuration set with event publishing
enabled before sending tracked cancellation emails. Without it SES sends
are refused before contacting the provider.

When a failed outbox delivery says an email needs reconciliation, look up
the delivery ID under `outbox_delivery_id` in the SES configuration set's
event destination. For `registration.send_cancellation`, use the outbox ID.
For `notifications.dispatch`, use each `message_delivery.id` linked to the
outbox `event_id` with channel `email`, status `pending` and attempts above
zero. Each recipient has its own ID.

Use the provider's acceptance or definitive rejection as evidence. A missing
event leaves the outcome uncertain. Keep the reservation and failed outbox
row until the provider can confirm the outcome.

After verifying each outcome, lock the failed outbox row and reconcile its
reservations in one transaction. For an accepted family email, record the
acceptance time in `competition_cancellation_email.sent_at`. For a verified
unsent family email, delete the reservation with that ID and a null `sent_at`.
For an account email, move its pending `message_delivery` row to `sent` if
accepted or `failed` if verified unsent and refresh `updated_at`. Return the
same outbox row to `pending`, set `available_at` to now, reset `attempts` to
zero, and clear `locked_until`, `failed_at` and `last_error`. The relay skips
accepted sends and retries those verified unsent with their original IDs.

### Preview databases: attach and detach

There are no Vercel previews today
(`docs/adr/0001-ci-e2e-and-prebuilt-deploys.md`), so `worker-preview` finds
no preview database and idles, still healthy. If previews come back, it
behaves as follows.

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
  docker compose -f workers.yml up -d --build --wait --wait-timeout 660 \
  worker-prod foa-clamav foa-gotenberg
docker compose -f workers.yml ps worker-prod foa-clamav foa-gotenberg
```

Then check that the production worker's heartbeat row is fresh. Its
`last_seen_at` moves every 5 s.

```sh
docker exec foa-pg-prod psql -U postgres -d foa -c 'SELECT worker, last_seen_at, version FROM worker_heartbeat'
```

`worker-preview` writes a row only in the previews it serves, so with no
previews it has none; `ps` showing it healthy means it can list them.

### Run, restart and read the logs

Run from `/srv/foa/docker`. `WORKER_VERSION` is only recorded in the
heartbeat rows; leave it out and they say `unknown`.

| Worker           | Run (build and start)                                               | Restart                                                | Logs                                                              |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `worker-prod`    | `docker compose -f workers.yml up -d --build --wait worker-prod`    | `docker compose -f workers.yml restart worker-prod`    | `docker compose -f workers.yml logs -f --tail=200 worker-prod`    |
| `worker-staging` | `docker compose -f workers.yml up -d --build --wait worker-staging` | `docker compose -f workers.yml restart worker-staging` | `docker compose -f workers.yml logs -f --tail=200 worker-staging` |
| `worker-preview` | `docker compose -f workers.yml up -d --build --wait worker-preview` | `docker compose -f workers.yml restart worker-preview` | `docker compose -f workers.yml logs -f --tail=200 worker-preview` |

- Stop one: `docker compose -f workers.yml stop worker-staging` (it finishes
  its poll, stops pg-boss and closes its connections within 30 s).
- Updating: `git -C /srv/foa pull`, then the "Run" line; only a changed
  image is recreated. The workers build from `/srv/foa` (main), and each
  has its own untagged image (`foa-workers/worker-<name>`), so rebuilding
  one never swaps another's and a deploy leaves no old tag behind.
- Only errors: `docker compose -f workers.yml logs worker-preview | grep '"level":"error"'`.
- Rotating a worker password: replace its file in `/etc/foa/secrets`, rerun
  `scripts/worker-roles.sh`, restart that worker.
- A local run needs none of this: `pnpm worker:dev` drains the local
  database (`DIRECT_URL`) in single mode with `APP_ENV=local`, capturing
  email, and restarts on code changes.

### Links and field keys (worker-prod)

Some messages need more than the database. A coordinator invitation (#74)
carries a link to `/invitations/<token>` on the site, and the worker reads
the invitee's address and the link's token from their encrypted columns;
an SMS to a stored phone decrypts the phone the same way. So worker-prod
has `APP_URL: https://friendsofanimals.dev` in `workers.yml`, and reads
`FIELD_ENCRYPTION_KEYS` and `FIELD_HMAC_KEY` from
`/etc/foa/secrets/worker_prod_field_keys.env` (optional, root 0600, HR-05).
They must be the production app's own values (Vercel Production, kept in
`/etc/foa/secrets/app/`): with other keys the worker can't read what the
app stored. Without the file each such delivery fails, stays on the
outbox and retries, with a reason that names no address; every other
message still goes.

Write the file from the app's key files without printing them, then
recreate worker-prod:

```sh
install -m 0600 -o root -g root /dev/null /etc/foa/secrets/worker_prod_field_keys.env
{
  printf 'FIELD_ENCRYPTION_KEYS=%s\n' "$(cat /etc/foa/secrets/app/field_encryption_keys)"
  printf 'FIELD_HMAC_KEY=%s\n' "$(cat /etc/foa/secrets/app/field_hmac_key)"
} > /etc/foa/secrets/worker_prod_field_keys.env
docker compose -f workers.yml up -d --wait worker-prod
```

When the app's keys change (a new key ring version), rewrite this file and
recreate worker-prod together with the app's change. `worker-staging` and
`worker-preview` get neither setting: there is no staging or preview site
today (`docs/adr/0001-ci-e2e-and-prebuilt-deploys.md`). Give them their
site's `APP_URL`, and staging its keys, if one comes back.

### Scan, PDF and media sidecars

| Service         | Connection and health check                                                                                             | Memory |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| `foa-clamav`    | Database workers use `CLAMD_HOST=foa-clamav` and `CLAMD_PORT=3310`. The health check sends `PING` to `127.0.0.1:3310`.  | 2 GiB  |
| `foa-gotenberg` | Media uses `GOTENBERG_URL=http://foa-gotenberg:3000`. The health check calls `GET /health` on loopback.                 | 1 GiB  |
| `worker-media`  | Runs the media entry point with a read-only root and a 1 GiB `/tmp` tmpfs. Health requires a heartbeat under 120 s old. | 2 GiB  |

The media image also copies the approved `public/brand/foa-logo-watermark*.png`
assets and small tiles-only `apple-touch-icon.png`. The stamping job uses these exact files, sharp for safe artwork copies,
and Poppler for the first-page certificate raster; it never renders in the web
app or the default worker.

All three log to journald and use private networks. Clamd listens on the
internal `scan` bridge and loopback. FreshClam uses a separate bridge to
reach the signature mirror and keeps its databases in `foa-clamav-db`.
Allow ten minutes for the initial signature load. Scans wait during a
signature reload so ClamAV can stay within its memory limit. Check the
journal for signature-load failures. `clamav/clamd.conf` raises clamd's
stream, file and scan limits (210M, 420M, 5 minutes) so a 200 MB entry
video (#86) is scanned whole rather than flagged for its size; recreate
`foa-clamav` after changing them.

The upload scan also reads each file from its environment's R2 bucket, so a
database worker scans only with all four `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` and `R2_BUCKET` (HR-08). Without them every scan fails
and uploads wait unscanned. Each worker lists its own optional env file;
none goes through the shared `x-worker` anchor, which every worker merges:

| Worker                             | R2 file (root, 0600)                   | Bucket                                 |
| ---------------------------------- | -------------------------------------- | -------------------------------------- |
| `worker-prod`                      | `/etc/foa/secrets/worker_prod_r2.env`  | production                             |
| `worker-media` (derivatives)       | `/etc/foa/secrets/worker_media_r2.env` | production                             |
| `worker-staging`, `worker-preview` | `/etc/foa/preview-files.env`           | non-production (also the purge hook's) |

Write the production file with the R2 token scoped to the production
bucket, without printing it, then recreate worker-prod:

```sh
install -m 0600 -o root -g root /dev/null /etc/foa/secrets/worker_prod_r2.env
# R2_ACCOUNT_ID=, R2_ACCESS_KEY_ID=, R2_SECRET_ACCESS_KEY=, R2_BUCKET= lines
docker compose -f workers.yml up -d --wait worker-prod
```

Put only the four `R2_` lines in these files: a service's `environment:`
overrides anything else they set.

The certificate renderer (#100) sends self-contained `index.html` with the bundled approved logo and QR to Gotenberg’s Chromium HTML route. It uses A4 landscape, tagged PDF output and the image’s Noto Sans Devanagari font. The web app and default worker cannot invoke the certificate PDF renderer.

Gotenberg and the media worker share the internal `pdf` network. Send
documents and their assets as file uploads. Chromium and LibreOffice
accept local URLs under `/tmp` and API requests time out after 30 s.

To recreate the scan and PDF sidecars after updating their image or
configuration, run from `/srv/foa/docker`. Keep the signature volume
attached so ClamAV can reuse its database.

```sh
docker compose -f workers.yml up -d --force-recreate --wait --wait-timeout 660 \
  foa-clamav foa-gotenberg
docker compose -f workers.yml ps foa-clamav foa-gotenberg
```

The `media` profile is opt-in. After the Files migrations are applied,
write `/etc/foa/secrets/worker_media_r2.env` (root, mode 0600) with the four
`R2_*` variables for the private production bucket, as for worker-prod's file
above. Only `worker-media` reads it. Its token must allow reads and writes in
that bucket, because the media worker stores the derivatives there.

The default worker scans uploads and queues image derivatives, video
transcodes and raster-only PDF essay copies. The media worker connects directly to the same database (on `db`,
which also routes to R2) and drains only those deliveries, one at a time.
`MEDIA_TIMEOUT_SECONDS` defaults to 60 seconds for image processing. A video
(#86) is transcoded by the image's own ffmpeg, with a deadline from its
length (up to 13 minutes for a 3-minute clip) and a 20-minute relay lease;
the PDF adapter (#96) is Poppler, with a two-minute rendering deadline and
40-page cap. `pnpm test:media` runs both real adapters' contracts inside the
image. The default worker's `files.backfill_essay_pdfs` schedule queues
previously clean essay PDFs that have no media processing record. The media
worker uses the container heartbeat
file for health checks. The database heartbeat read by `/api/health/worker`
continues to track the default worker. The PDF adapter in #100 uses the
Gotenberg endpoint.

```sh
WORKER_VERSION=$(git -C /srv/foa rev-parse --short HEAD) \
  docker compose -f workers.yml --profile media up -d --build --wait \
  worker-media foa-gotenberg
```

## Checks

`scripts/smoke-test.sh` runs 31 client-side checks through
`db.friendsofanimals.dev:6432` from a throwaway `postgres:18.7-trixie` container:
each URL logs in as the right role and database with `verify-full`, direct
TLS and TLS 1.3, parameterized and named prepared statements through the
transaction pool, `foa_app` cannot create in `public`, `nonprod_migrator` can
clone `foa_seed`, the preview roles cannot reach `foa_staging` and the staging
roles reach nothing else, the role timeouts hold through the pool (a 16 s
query as `foa_app` is cancelled), and refusals (superuser, admin console,
`foa_seed`, cross-environment logins, plaintext, wrong host name). Passwords
never appear on a command line (`ps`): the URLs are split into libpq
variables in a 0600 env file, passed with `docker run --env-file` and removed
afterwards. It needs the real certificate (its `verify-full` checks fail
against the placeholder by design). The container gets the host's CA bundle
as one file, symlinks resolved: on Fedora `/etc/ssl/certs/ca-certificates.crt`
links into `/etc/pki/ca-trust`, which would dangle inside the container.

## Monitoring and alerts

[GitHub Actions Uptime](../.github/workflows/uptime.yml) is scheduled every
five minutes on the default branch. It can also run on demand from Actions.
Both HTTPS probes require HTTP 200 from the configured URL. Redirects fail
the probe. The database probe tests TCP connectivity without authenticating.
Each HTTPS probe retries once after 30 seconds on a timeout or an HTTP 408,
429, 500, 502, 503 or 504 response. A DNS failure, a refused connection or
a TLS error fails that step at once. The database probe tries a second time
30 seconds after a failed connection.

| Check  | Target                            | Alerts when                                                | Alert goes to                       | Silence and un-silence                                    |
| ------ | --------------------------------- | ---------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| App    | `/api/health`                     | The HTTPS request fails or returns a status other than 200 | Scheduled recipient via Actions     | Disable Uptime in Actions and have the owner re-enable it |
| Pooler | `db.friendsofanimals.dev:6432`    | TCP cannot connect on either attempt                       | Scheduled recipient via Actions     | Same as App                                               |
| Worker | `/api/health/worker`              | The HTTPS request fails or returns a status other than 200 | Scheduled recipient via Actions     | Same as App                                               |
| Errors | GlitchTip app and worker projects | An error matches the configured alert rule                 | Owner via error-tracking alert rule | Archive or unarchive the issue in the error tracker       |

The worker writes its `worker_heartbeat` row after each poll. The health
route returns HTTP 200 with `Cache-Control: no-store` while the heartbeat is
at most 120 seconds old. A stale or missing heartbeat or a failed query
returns HTTP 503.

GitHub initially sends scheduled notifications to the workflow creator. A
cron edit shifts delivery to the editor, and re-enabling a disabled schedule
shifts it to the account that re-enabled the workflow. A default-branch change
can also change the scheduled run actor. Manual runs notify the person who
started the run according to their settings.
[Scheduled workflow actor](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#actor-for-scheduled-workflows) ·
[Workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)

The intended recipient is the repository owner's account,
`SiddharthMuramkar`. Use that account to enable or re-enable Uptime and to
edit its cron. In GitHub's notification settings under System → Actions,
enable Email or On GitHub and select **Only notify for failed workflows**.
[GitHub Actions notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications)

In a public repository, GitHub disables scheduled workflows after 60 days
without repository activity. A disabled Uptime stops checking and sends no
alert. If the Actions tab shows Uptime as disabled, re-enable it with the
owner's account as described above.

**HR-23 recipient receipt is pending.** Have the owner confirm the actor on
a normal scheduled Uptime run. To verify delivery, use a separate test
repository owned by the same account. Schedule a workflow named
`HR-23 notification drill` with empty permissions and a single `exit 1`
step. After the first scheduled failure, disable the drill. Record the run
URL, actor, notification channel, and UTC time of the owner's receipt under
HR-23.

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
(PgBouncer, CrowdSec, and Caddy for requests sent straight to the edge, never
the site's visitors: Edge (Caddy), "Access log"); keeping them a year waits
on counsel (HR-30).

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

## Analytics (Umami)

Cookieless page views for the public site (#118). Compose project
`foa-analytics` (`analytics.yml`), separate from `foa-vps`, so bringing the
database stack down or up never touches it.

| Container   | Image                                | Address                  | Published | Limits                           |
| ----------- | ------------------------------------ | ------------------------ | --------- | -------------------------------- |
| `foa-umami` | `ghcr.io/umami-software/umami:3.5.0` | 10.112.12.30:3000 (`db`) | no        | 1 CPU, 1 GB, `oom_score_adj` 500 |

- **Data**: database `umami` on pg-prod, owned by role `umami`
  (`postgres/bootstrap/umami.sql`, connection limit 10). pgBackRest backs up
  the whole pg-prod cluster, so `umami` is in every backup and restore drill.
  Umami runs its own migrations when it starts.
- **Ingress**: Caddy (Edge, below) serves `https://stats.friendsofanimals.dev`
  and proxies it to 10.112.12.30:3000 across the `db` bridge. Umami publishes
  no port and holds no certificate.
- **What the site sends**: the production build renders the tracker when
  `NEXT_PUBLIC_UMAMI_WEBSITE_ID` and `UMAMI_ORIGIN` are set.
  The site loads it as `/stats/script.js` and posts to `/stats/api/send` on
  its own origin; Next rewrites just those two paths to `UMAMI_ORIGIN`. No
  cookies, no query strings or fragments, and none of the site's own pages
  as referrers. Nothing is sent from signed-in
  pages, sign-in and sign-up, or from a browser that showed a signed-in page
  in the last 30 days (`src/lib/analytics/umami.ts`).

Secrets (never in git):

| Path                                    | Mode, owner | What                                                                   |
| --------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `/etc/foa/analytics.env`                | 0600 root   | `DATABASE_URL` (role umami), `APP_SECRET`, `TWO_FACTOR_ENCRYPTION_KEY` |
| `/etc/foa/secrets/umami_admin_password` | 0400 root   | Umami's `admin` password, which replaced the seeded one                |

Bring-up (owner, HR-52), with the database stack and the edge running.
The stats site serves 503 until the bootstrap replaces Umami's seeded admin
login. On each run, the bootstrap closes the site before provisioning the
database and reopens it only after the login replacement succeeds.

```sh
cd /srv/foa && git pull
# Env file, role and database umami, pg_hba reload; then Umami, and its
# seeded admin login replaced by a random password in
# /etc/foa/secrets/umami_admin_password. This opens the stats site:
sudo docker/scripts/analytics-bootstrap.sh
```

The stats site is already in `caddy/Caddyfile`; its A record must point at
the VPS before Caddy can get its certificate (Edge, below).

Then at `https://stats.friendsofanimals.dev`: sign in as `admin` with the
password in `/etc/foa/secrets/umami_admin_password` (read it on the VPS
yourself; if you change it in the dashboard, put the new one in that file
too), turn on two-factor authentication, and add a website for
`friendsofanimals.dev`. Set `NEXT_PUBLIC_UMAMI_WEBSITE_ID` to that website's
ID and `UMAMI_ORIGIN=https://stats.friendsofanimals.dev` in Vercel Production.
Follow the [production deployment runbook](../README.md#deploying).
Check that a page view arrives, and that `pgbackrest info` after the next
backup and the next restore drill both show `umami`.

To keep the dashboard off the internet altogether, have the stats site in
`caddy/Caddyfile` serve only `/script.js` and `/api/send` (a pull request,
like any change there). Only the tracker and the collect endpoint stay
public, and the site's rewrites need nothing else. Reach the dashboard over
SSH instead: `ssh -L 3000:10.112.12.30:3000 <vps>`, then open
`http://localhost:3000`.

Umami counts unique visitors by IP address. Requests reach it through
Vercel's rewrite and then Caddy, so the connecting address is Vercel's.
Vercel's rewrite sets `X-Real-IP` to the visitor's address, replacing
whatever the browser sent, and `analytics.yml` sets
`CLIENT_IP_HEADER=x-real-ip`. Caddy passes `X-Real-IP` through and drops the
other headers Umami would fall back to (`CF-Connecting-IP`,
`True-Client-IP`, `X-Client-IP` and the other CDN ones), so a header a
browser adds can't replace the address Vercel set. That doesn't make the
address unforgeable: Umami 3.5.0 takes an `ip` field in the `/api/send`
body before any header, and a request sent straight to
`stats.friendsofanimals.dev` can carry its own `X-Real-IP` (and the
headers Caddy doesn't drop, such as `X-Appengine-User-Ip`). Only the
counts and their countries are at stake: a forged address reaches Umami's
statistics, never the site.

Upgrade: bump the image tag in `analytics.yml`, `git pull`, then rerun the
bootstrap. Caddy serves 503 whenever `/var/lib/foa/caddy/gates/stats` is
absent. Before restoring or replacing Umami's database, remove that marker
and confirm the stats site returns 503. After maintenance, rerun the
bootstrap to verify the admin login and reopen the site. If the login step
fails, correct the problem and rerun the bootstrap.

To rotate the database password, delete the `DATABASE_URL` line from
`analytics.env` and rerun the bootstrap. Compose recreates Umami with the
new environment.

```sh
docker compose -f docker/analytics.yml ps
docker exec foa-umami curl -fsS http://127.0.0.1:3000/api/heartbeat   # {"ok":true}
```

## Edge (Caddy)

Caddy terminates TLS on the VPS for the services that need a public HTTPS
name (#118). Compose project `foa-edge` (`edge.yml`), sites in
`caddy/Caddyfile`.

| Container   | Image          | Network | Listens            | Limits                               |
| ----------- | -------------- | ------- | ------------------ | ------------------------------------ |
| `foa-caddy` | `caddy:2.11.9` | host    | :80, :443 (h1, h2) | 0.5 CPU, 256 MB, `oom_score_adj` 500 |

| Site                                                         | Serves                                           |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `stats.friendsofanimals.dev`                                 | Umami at 10.112.12.30:3000 (Analytics, above)    |
| `errors.friendsofanimals.dev`                                | GlitchTip at 10.112.13.10:8000 (Errors, below)   |
| `http://db.friendsofanimals.dev`, `http://db.shipped-it.dev` | Port 80 only: lego's challenge files, else a 404 |

- **Host network**: Caddy binds :80 and :443 on the host itself, so
  firewalld's `http` and `https` services govern them (Firewall, above);
  Docker makes no rules for it and `FOA-INBOUND` doesn't apply. Umami and
  GlitchTip publish no port: Caddy reaches them across their bridges. The
  admin API is the unix socket `/config/admin.sock` (0600) inside the
  container, `/var/lib/foa/caddy/config/admin.sock` on the host, not a TCP
  port: on the host network any local process could reach a port.
- **Hardened**: Caddy runs as root (the image has no other user) but with
  every capability dropped except `NET_BIND_SERVICE`, `no-new-privileges`,
  and a read-only root filesystem. It writes only `/data`, `/config` and a
  tmpfs `/tmp`.
- **Certificates**: Caddy gets and renews the stats and errors certificates
  itself from Let's Encrypt; `acme_ca` pins the production CA. Each name
  needs its A record (189.72.156.29, no AAAA) before Caddy loads its site.
  Certificates and ACME state live in `/var/lib/foa/caddy/{data,config}`:
  keep them across recreates, or Caddy asks for new certificates, and Let's
  Encrypt issues at most 5 a week for the same set of names.
- **One owner of port 80**: foa-caddy listens on this port while it runs.
  `scripts/cert-renew.sh` then uses lego's webroot mode for the PgBouncer
  certificate. lego writes the challenge into `/var/lib/foa/acme-webroot`,
  and Caddy serves it read-only for the `http://db.*` names. When port 80
  is free, lego answers the challenge on its standalone listener (TLS
  certificate, above).
- **Access log**: the stats and errors sites write a JSON access log to
  stdout (the `access_log` snippet in `caddy/Caddyfile`), which goes to
  journald with the container's other lines (Logs, above) and from there to
  CrowdSec. It never holds a visitor of the site: Caddy skips the paths
  the site proxies for them, whatever the method or query (`log_skip`: the
  tracker script and page views on stats, Sentry envelopes on errors). For
  every other request it deletes
  the headers that carry someone's address, location or page (`X-Real-Ip`,
  `X-Forwarded-For`, `Forwarded`, Vercel's `X-Vercel-Forwarded-For` and
  `X-Vercel-Ip-*`, `Referer`) and redacts cookies and `Authorization`. What
  remains is the connecting address (a scanner's, or the owner's on the
  dashboard), host, method, path with its query string, status and user
  agent: what CrowdSec's caddy parser reads. Caddy's own log (stderr) goes
  through the same filter (`log default`): when Umami or GlitchTip is down,
  each request it couldn't proxy, a skipped one included, lands there with
  its headers.
- **Abuse control**: CrowdSec's `crowdsecurity/caddy` collection (the
  generic HTTP scenarios: probing, crawling, sensitive files, bad user
  agents, known CVEs) bans abusive sources at the host (CrowdSec, above).
  There is no Caddy rate limit. The `caddy:2.11.9` image has no rate-limit
  module, so one needs a custom build with a pinned
  `github.com/mholt/caddy-ratelimit`. And nearly every request arrives from
  Vercel's few shared egress addresses: a limit per address would throttle
  every visitor at once, and one per `X-Real-IP` trusts a header any direct
  request can set. See TODO, "Edge rate limit".
- **New host**: point `acme_ca` at Let's Encrypt's staging CA
  (`https://acme-staging-v02.api.letsencrypt.org/directory`) for the first
  start, and back to production once a certificate is issued, so a mistake
  can't run into production's rate limits.

Start, reload and recreate, from `/srv/foa`:

```sh
cd /srv/foa && git pull
firewall-cmd --zone=public --add-service=https             # Firewall, above
firewall-cmd --permanent --zone=public --add-service=https
docker compose -f docker/edge.yml up -d --wait
# After a Caddyfile change:
docker exec foa-caddy caddy reload --config /etc/caddy/Caddyfile --address unix//config/admin.sock
docker logs --since 10m foa-caddy     # certificate issuance and errors
```

`caddy/` is mounted as a directory, so a reload reads the Caddyfile that git
just wrote; a single-file mount would keep showing the old one. A recreate
keeps the project, container and data paths, so the certificates survive it.

## Errors (GlitchTip)

GlitchTip collects the site's and the workers' errors through the Sentry SDK
(#66) at `https://errors.friendsofanimals.dev`. Compose project `foa-errors`
(`errors.yml`), network `foa-errors` = `10.112.13.0/24` on bridge
`br-foa-errors`.

| Container          | Image                       | Address           | Published | Limits                      |
| ------------------ | --------------------------- | ----------------- | --------- | --------------------------- |
| `foa-glitchtip`    | `glitchtip/glitchtip:7.0.0` | 10.112.13.10:8000 | no        | 1 GB, `oom_score_adj` 500   |
| `foa-glitchtip-pg` | `postgres:18.7-alpine`      | 10.112.13.11:5432 | no        | 512 MB, `oom_score_adj` 500 |

- **Hardened**: neither container gains new privileges. GlitchTip runs as
  its image's user (`app`, 5000) with no capabilities; its Postgres keeps
  only `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID` and `SETUID`, which its
  entrypoint needs to own the data directory, read the password file and
  drop to `postgres`.
- **One container** runs GlitchTip's web server and its workers.
  `VALKEY_URL` is empty, so Postgres is the task queue, cache and session
  store: no Valkey or Redis.
- **Its own Postgres**, not pg-prod: GlitchTip's partitioned tables need
  `max_locks_per_transaction=512`, and pg-prod's settings and `pg_hba` are
  tuned for `foa`. Data in `/var/lib/foa/glitchtip/pg` (owned by 70, the
  image's postgres user), uploads in `/var/lib/foa/glitchtip/uploads` (owned
  by 5000, GlitchTip's user). Neither is in pgBackRest: losing them loses the
  error history, nothing else.
- **Closed**: self-sign-up ends with the first user, only superusers create
  organisations, and the Django admin, the OpenAPI page, MCP, uptime checks
  and log ingestion are off. Mail goes to the container log
  (`EMAIL_URL=consolemail://`).
- **Ingress**: Caddy (Edge, above). Browsers send their events through the
  site's own `/monitoring` route (#66), so its CSP keeps `connect-src
  'self'`.

Secrets (never in git, never printed; each value is `openssl rand -hex
32`):

| Path                                     | Mode, owner | What                                                                             |
| ---------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `/etc/foa/secrets/glitchtip.env`         | 0600 root   | `SECRET_KEY`, and `DATABASE_URL` for role glitchtip at 10.112.13.11:5432         |
| `/etc/foa/secrets/glitchtip_pg_password` | 0400 70     | The same password, for foa-glitchtip-pg's first start (`POSTGRES_PASSWORD_FILE`) |

**First start on a new host**, or after losing `/var/lib/foa/glitchtip/pg`
(no backup restores it): GlitchTip lets the first account that signs up
become superuser, even with sign-up turned off, and Caddy already routes
`errors.friendsofanimals.dev` with a public certificate. So create the
owner's account before the web server runs: start only the database, run the
migrations and `createsuperuser` in one-off containers, then start GlitchTip.
foa-glitchtip must be stopped meanwhile (after a database loss:
`docker compose -f docker/errors.yml stop glitchtip`): the one-off
containers take its fixed address, 10.112.13.10.

```sh
cd /srv/foa && git pull
docker compose -f docker/errors.yml stop glitchtip    # if it runs
docker compose -f docker/errors.yml up -d --wait glitchtip-pg
docker compose -f docker/errors.yml run --rm glitchtip ./manage.py migrate
docker compose -f docker/errors.yml run --rm glitchtip ./manage.py createsuperuser
docker compose -f docker/errors.yml up -d --wait
```

Start and recreate, with the edge running and the superuser in place:

```sh
cd /srv/foa && git pull
# GlitchTip migrates its database on start: up to 2 minutes.
docker compose -f docker/errors.yml up -d --wait
docker compose -f docker/errors.yml ps
```

The organisation `foa` and its two projects, one for the site and one for
the workers, live in GlitchTip's database. Their DSNs are Vercel
Production's `NEXT_PUBLIC_SENTRY_DSN` and `/etc/foa/secrets/worker_sentry.env`.
Upgrade: bump the tag in `errors.yml`, `git pull`, then `up -d --wait` again.

## TODO and owner actions

1. **Vercel Static IPs** (deferred): allowlist them in
   `/etc/foa/firewall.env`, the Hostinger firewall and CrowdSec (whitelist
   and LAPI allowlist).
   Until then 6432 is open to the internet, protected by TLS, SCRAM with
   32-byte random passwords, PgBouncer 1.26.1 and CrowdSec. Production
   migrations run in the "Deploy production" GitHub Actions job (`vercel
   build` on a GitHub runner), not on Vercel, so an allowlist must also let
   that job reach 6432 (or the migration step must move to the VPS), or it
   blocks every migration.
2. **Off-site copy of files (#68, HR-25, HR-13)**: B2 bucket and key, a
   read-only R2 token, the settings in `worker-prod`, the retention value
   (30 days proposed) and one restore tried against real buckets (above).
3. **Off-site backups on FOA's Cloudflare (#18)**: pgBackRest `repo2` on R2
   (own passphrase), plus a daily `age`-encrypted `pg_dump` to a separate,
   bucket-locked R2 bucket kept 35 days. Until then backups live on the same
   disk as the database.
4. **Hostinger managed firewall**: if it is ever enabled it must allow TCP 22,
   80 (ACME renewals, Caddy), 443 (Caddy) and 6432, with the SSH rule added
   first.
5. **Offline copy** of `/etc/foa/secrets/pgbackrest_repo1_cipher_pass` with
   the owner.
6. **Alerting** (operations ticket): failed `foa-pgbackrest-*`,
   `foa-restore-drill`, `foa-cert-renew` or archiving
   (`pg_stat_archiver.failed_count`), and a periodic `pgbackrest check`. The
   restore drill cannot see archiving that has stalled, because it can only
   replay the WAL that reached the repository.
7. **Workers (HR-07):** apply the roles and start `workers.yml` (Workers,
   "First start"), and settle the CPU and memory caps there for the shared
   VPS.
8. **Edge rate limit** (deferred, #118): CrowdSec's HTTP scenarios are the
   edge's abuse control today (Edge, "Abuse control"). If Umami's
   `/api/send` or GlitchTip's envelopes are ever flooded, build Caddy with
   a pinned `caddy-ratelimit` (an image built and pinned here, not
   `caddy:2.11.9`), and limit the paths Vercel doesn't proxy per address
   and the proxied ones per site.
