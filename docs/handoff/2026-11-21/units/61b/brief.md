# Brief 61b: worker runtime on the VPS

Issue #61 (M0). Branch `ticket/61-worker-runtime`, worktree `/root/foa-wt/61b`, base `foa/M0`. Size L, key X6, blocked by 61a.
Head start on `ticket/61-worker-runtime`: efd9ae6 (`src/worker/preview-databases.ts` + test; pnpm check green, 462 tests).
Prepped by foa-p61 on 2026-11-21 against `foa/ticket/57-harness` 0569f4f (PR #140) and the 61a brief.

## Scope
- **In (61b):** `src/worker/**` (entrypoint, supervisor, preview discovery, heartbeat, schedules wiring); pg-boss 12 (exact
  pin) for `SCHEDULES` in single-database mode; migration `61_worker_heartbeat` (table shared with 66b); Dockerfile target
  `worker`; `docker/workers.yml` with `worker-prod`, `worker-staging`, `worker-preview`; bootstrap SQL for roles
  `foa_worker`, `staging_worker`, `nonprod_worker`; `pnpm worker` and `pnpm worker:dev`; `docker/README.md` run, restart
  and logs sections.
- **Out (61a owns):** the outbox, `emit`, `drainOutbox`, handlers, `h.drain()`, the preview drain route. **Out (66b):**
  Sentry for workers, uptime checks, `/api/health` heartbeat freshness, log retention. **Out (63b):** ClamAV and the
  `preview-dropped.d` purge hook (61b detaches on its own; no sweeper change needed).

## Acceptance criteria (testable)
1. Preview discovery (pure, **done**): from listed `(datname, comment)` rows, serve exactly the databases the sweeper
   would recognise: name `^foa_(pr|br)_[a-z0-9_]{1,56}$` whose comment is `foa-preview pr=<n>` (name `foa_pr_<n>`, same
   n) or `foa-preview branch=<ref>` (name `foa_br_…`); never `foa_seed`, `foa_staging`, `postgres`, templates, or a
   mismatched name and comment. `planPreviewChanges(serving, toServe)` gives attach and detach lists; `isDatabaseGone`
   is true for SQLSTATE `3D000` only. — Vitest.
2. A new PR preview's database is served without manual steps, and serving stops after it is dropped: a supervisor
   `tick()` with an injected lister attaches a tenant for a newly listed database, detaches one that disappears, and
   detaches a tenant whose drain fails with `3D000` before the next discovery. — Vitest with fakes (no timers, no sleeps).
3. Single-database mode (production, staging, local) drains the outbox each poll and writes a `worker_heartbeat` row
   (worker, environment, last_seen_at, version) and a heartbeat file; preview mode does the same per attached database
   (heartbeat row in each). — Seam 1-style on PGlite through 61a's `drainOutbox`.
4. Schedules: in single mode every `SCHEDULES` entry is registered with pg-boss (`schedule(name, cron, data, { tz })`
   plus `work(name, …)`); none in preview mode. — Vitest with a recording fake of the two pg-boss calls used.
5. Compose: `docker/workers.yml` defines the three services, each with `healthcheck` (heartbeat file age < 120 s),
   `restart: unless-stopped`, json-file logging, CPU and memory limits, the `db` network, no published ports, secrets
   from `/etc/foa/secrets`, and connects to Postgres directly (not PgBouncer: pg-boss needs session features). `docker`
   can't run here, so `docker/workers.test.ts` checks the file's text. The staging and preview workers appearing
   healthy on the VPS is HR-07.
6. `pnpm worker:dev` runs the worker against the local database (single mode, `APP_ENV=local`, capture email).
7. `docker/README.md` has, for each worker service, the run, restart and `docker compose -f docker/workers.yml logs`
   commands, plus attach/detach behaviour and the per-milestone `worker-preview` redeploy (HR-10). — review.

## Files
- New: `src/worker/preview-databases.ts` + test (**already built**), `src/worker/{config,supervisor,tenant,heartbeat,
  schedules,db,main,health}.ts` + tests, `src/server/db/schema/worker.ts` (`worker_heartbeat`), migration
  `--name 61_worker_heartbeat`, `docker/workers.yml`, `docker/workers.test.ts`,
  `docker/postgres/bootstrap/workers.sql` (roles; owner applies).
- Touch (hotspots): `Dockerfile` (new `worker` target, X6), `docker/README.md` (X6), `package.json` + lockfile (pg-boss,
  scripts; needs network: the pnpm store lacks pg-boss), `src/server/db/schema/index.ts` (barrel line), `drizzle/meta/*`.
  63b, 66b and 68 also hold X6: serialize merges. Don't edit `docker/compose.yml` (keeps the DB stack separate).
- The worker imports only plain-Node code (61a's outbox module, `ports/email*`, schema, `ids`); it never imports
  `src/server/deps.ts` or `src/server/db/index.ts` (`server-only`, `@/env`). It builds its own `Deps` per database with
  `drizzle(postgres(url, { max, prepare: false }))`.

## Design (codebase-design: 2 interfaces compared)
- **A. Supervisor over tenants (chosen).** One deep module, `createSupervisor({ mode, listDatabases, startTenant, clock })`
  with a single `tick()` the loop calls every poll. A tenant = one database's `Deps` + `drainOutbox` + heartbeat; preview
  mode reconciles tenants with `planPreviewChanges` every `WORKER_DISCOVERY_SECONDS` (60). Single mode is the same
  supervisor with a fixed one-database list. Tests drive `tick()` directly with fake listers and tenants: no timers.
- **B. One process per database, spawned by a shell loop or Compose profile.** Rejected: attach/detach would live in shell
  (untestable in Vitest), and each process holds its own pool, against F9's 1-2 connections per preview database.
- Preview mode runs the relay only (no pg-boss per preview database): cron schedules (retention, nightly copies) have no
  meaning on previews, and per-database `pgboss` schemas would need DDL rights on every `foa_pr_<n>`. One-off timed work
  is an outbox row with `availableAt` (61a), so it still runs on previews.
- Detach: stop the tenant's loop, `end()` its pool. Dropped with `FORCE`, the server kills the session (`57P01`); the
  next drain or discovery then sees `3D000` or the missing row and detaches.

## Interface needs (from 61a; signatures from the 61a brief)
```ts
import { drainOutbox, SCHEDULES, type DrainReport, type ScheduleDefinition } from "@/server/outbox";
// drainOutbox(deps: Deps, options?: { limit?: number }): Promise<DrainReport>
// Deps { db: AppDb; clock: Clock; email: EmailSender }: email = captureEmailSender({ db, clock }) outside production,
// unconfiguredEmailSender in production (HR-12), as emailSenderFor() in src/server/deps.ts decides.
```
Worker config (env, parsed with zod in `src/worker/config.ts`): `WORKER_MODE=single|preview`, `APP_ENV`,
`WORKER_DATABASE_URL` (single), `WORKER_ADMIN_URL` (preview: pg-nonprod `postgres` database; the path is swapped per
preview with `withDatabase()` from `src/server/db/database-url.ts`), `WORKER_POLL_SECONDS` (5),
`WORKER_DISCOVERY_SECONDS` (60), `WORKER_CONNECTIONS_PER_DATABASE` (1, max 2).

## Residue
- HR-07: apply `docker/postgres/bootstrap/workers.sql` (roles owning schema `pgboss`; `nonprod_worker` with CONNECT on
  `postgres` and on previews via the `foa_seed` template's grants), put worker passwords in `/etc/foa/secrets`,
  `docker compose -f docker/workers.yml up -d`, choose CPU/memory caps (F9), and confirm `worker-preview` attaches to a
  new `foa_pr_<n>` and lets go after the sweep. The VPS stack isn't up yet, so this waits for it.
- HR-10 (M1 on): rebuild only `worker-preview` from each milestone tip in a separate checkout.
- HR-12: SES keys for the production worker (dormant).
- Not run here: `docker compose config`, any container, the real pg-boss start (no Postgres server, no docker).

## Test plan
- Pure (done): `src/worker/preview-databases.test.ts`.
- Vitest: `config.test.ts`, `supervisor.test.ts` (attach, detach on disappearance, detach on `3D000`, single mode),
  `schedules.test.ts` (recording fake), `docker/workers.test.ts` (text checks).
- PGlite: `tenant.test.ts` (one tick drains a pending delivery and writes the heartbeat row).
- Not run: container health checks and attach/detach on the VPS (HR-07).

## Slices (ordered; each = one behaviour, one test file)
1. Preview discovery and change planning (AC1): `src/worker/preview-databases.test.ts` — **done**.
2. Tenant tick: drain + heartbeat row and file, `worker_heartbeat` migration (AC3): `src/worker/tenant.test.ts`.
3. Supervisor attach/detach and single mode, config parsing (AC2): `src/worker/supervisor.test.ts`.
4. pg-boss schedules, entrypoint, `pnpm worker:dev`, Dockerfile target (AC4, AC6): `src/worker/schedules.test.ts`.
5. `docker/workers.yml`, roles SQL, README (AC5, AC7): `docker/workers.test.ts`.
