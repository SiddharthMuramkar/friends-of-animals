# Code map: server, database, migrations, test harness (code-server.md)

Scope: `src/server/**`, `src/lib/**`, `src/test/**`, `drizzle/`, `drizzle.config.ts`, `scripts/{migrate,preview-database,
check-build,client-bundle,load-env}.ts`, `vitest.config.ts`. Read at `main` e340a6a (+ skills commits on the checkout).
`origin/M0` (0121d0d) adds only #67 restore-drill files and `docker/**/*.test.ts` to `vitest.config.ts`: no harness work.
Everything marked "verified" was run or read in `node_modules` in this container (Node 22.23, PGlite 0.5.16).

## 1. Files that exist today
| Path | Lines | Role |
|---|---|---|
| `src/server/db/index.ts` | 60 | `import "server-only"`; lazy `db` = `new Proxy` over `drizzle(postgres(url,{prepare:false,max:5,idle_timeout:20,connect_timeout:5,query_timeout:20,...directTls(url)}),{schema})`; type `Db` |
| `src/server/db/database-url.ts` | 155 | NO server-only (used by migrate.ts, env.schema.ts): `previewDatabase`, `resolveDatabaseUrl`, `migrationTarget`, `withDatabase`, `directTls` |
| `src/server/db/database-url.test.ts` | 263 | pure tests: preview names, 63-byte cap, hash, sslmode |
| `src/server/db/schema/index.ts` | 8 | schema barrel, today `export {};` (zero tables). Comment: one file per module, re-exported here; never `server-only` |
| `src/test/db.ts` | 42 | `createTestDb()`: `new PGlite({extensions:{pg_trgm}})` + `drizzle({client,schema})` + `migrate(...,{migrationsFolder:"drizzle"})`; type `TestDb` |
| `src/test/db.test.ts` | 32 | asserts pg_trgm + `similarity()`, and per-call isolation |
| `src/test/server-only.ts` | 2 | empty stand-in; `vitest.config.ts` aliases `server-only` to it and `@/` to `src/` |
| `drizzle/0000_enable_pg_trgm.sql` + `meta/0000_snapshot.json` + `meta/_journal.json` | 3/17/12 | one custom migration (`CREATE EXTENSION IF NOT EXISTS pg_trgm`), journal `version:"7"`, `when:1794970969591` |
| `drizzle.config.ts` | 17 | `loadEnvFiles()`; parses `migrationEnvSchema` (DIRECT_URL required even for `generate`); `schema:./src/server/db/schema/index.ts`, `out:./drizzle`, dialect postgresql, default prefix `index` |
| `scripts/migrate.ts` | 140 | DIRECT_URL only; preview: create DB from `foa_seed` then migrate; advisory lock `5066339983389443922` ("FOA_MIGR") around `migrate()` |
| `scripts/preview-database.ts` (+test 96) | 101 | `createPreviewDatabase(run, {name,comment}, {attempts,backoff,sleep,log})`: 42P04/23505 = exists, retries 55006 5x (1,2,4,8 s) |
| `scripts/check-build.ts`, `client-bundle.ts` (+test 99) | 100/59 | post-build: no `static{}`/lookbehind in client chunks (iOS 16.0), initial JS <= 170 000 B gz per prerendered page |
| `scripts/load-env.ts` | 12 | `process.loadEnvFile` for `.env.local` then `.env`; already-set vars win |
| `src/lib/*.ts` | 12 modules | pure helpers with colocated tests (fonts.ts has none): connection, contact, in-page, indexing, routes, security-headers, seo, site (`placeholder`), theme, utils, images/credits. No DB use |
| `src/env.schema.ts` / `src/env.ts` | ~280/25 | zod schemas `buildEnvSchema`, `envSchema` (DATABASE_URL), `migrationEnvSchema` (DIRECT_URL); `env()` cached, server-only |

## 2. DB access pattern
- App code imports `db` from `@/server/db`; the Proxy creates the client on first property access, so `next build` and imports
  need no database. One pool of 5 per function instance; PgBouncer transaction mode => never prepared statements, never
  session state (`SET`, advisory locks, `LISTEN`) through `db`. Session-level work goes through `DIRECT_URL` (migrator only).
- Only consumer today: `src/app/api/health/route.ts` (`await connection()` then `db.execute(sql\`select 1\`)`, 503 hides error).
- Result-shape trap (verified in `.d.ts`): `db.execute()` returns a postgres-js `RowList` (an array) in the app but a PGlite
  `Results` (`{rows}`) in tests (`db.test.ts` reads `.rows`). Use cases must use the query builder (`select/insert/...returning`)
  or a shared `rowsOf()` helper; never index `execute()` results directly. `Db` and `TestDb` are different types: type use
  cases against `PgDatabase<PgQueryResultHKT, typeof schema>` (drizzle-orm/pg-core) so both bind.
- PGlite is one connection, serial: true races (double webhook, receipt numbering) are not reproducible there. Enforce with
  constraints/locks in SQL; Seam 1 asserts idempotency by sequential replay; optional real-Postgres check via
  `.cursor/cloud-start.sh` (PG16 distro, `postgres://foa:foa@localhost:5432/foa`).
- Versions: PGlite 0.5.16 = PostgreSQL 18.6 (verified `select version()`); prod 18.7; cloud runner distro 16 => no PG17+-only SQL
  in anything a runner must apply to local Postgres.

## 3. Schema layout (target, per README + barrel comment)
- `src/server/db/schema/<module>.ts` per module (identity, roles, audit, outbox, settings, files, consent, competitions, ...),
  each re-exported by `export * from "./<module>";` in `schema/index.ts`. Statuses = Postgres enums named after the entity
  (#55 "Schema shape"); timestamps `timestamptz` UTC.
- Schema files and anything they import must load under plain Node (drizzle-kit, tsx): no `server-only`, no `@/env`, no Next.
- Hand-written SQL (partial unique indexes, append-only triggers #59, FTS, `cube`+`earthdistance` #127/#128) goes in custom
  migrations (`--custom`), never by editing generated SQL.

## 4. Migration workflow (verified)
- Generate: `DIRECT_URL=postgres://foa:foa@localhost:5432/foa pnpm db:generate --name <issue>_<slug>` (no connection made;
  1.2 s). Writes `drizzle/NNNN_<name>.sql`, `drizzle/meta/NNNN_snapshot.json`, appends `{idx, version:"7", when:Date.now(),
  tag, breakpoints:true}` to `_journal.json`; NNNN = last idx + 1. Without `--name` the tag is random (`0001_brave_hulk`).
- Custom: `pnpm db:generate --custom --name <x>` writes a file whose first line is exactly
  `-- Custom SQL migration file, put your code below! --` (bin.cjs 32948) and copies the previous snapshot.
- No change: prints `No schema changes, nothing to migrate` and writes nothing (usable as a drift gate).
- Apply: `pnpm db:migrate` (needs live Postgres) or implicitly in tests via `createTestDb()`.
- Migrator semantics (`drizzle-orm/pg-core/dialect.js` 44-72): reads ONLY the newest row of `drizzle.__drizzle_migrations`
  (`order by created_at desc limit 1`), applies every journal entry with `when > created_at`, all pending entries in ONE
  transaction, records `hash` but never compares it. Consequences: edited applied SQL is never detected; an entry whose `when`
  is <= the newest applied one is SILENTLY skipped; journal `when` must strictly increase in entry order.
- `pnpm exec drizzle-kit check` (bin.cjs 91716): exits 1 on snapshot collisions (two snapshots with the same `prevId`) or
  malformed snapshots; only WARNS on non-increasing `when`. `drizzle-kit drop` is an interactive TUI (unusable headless).
  Any interactive prompt (table/column rename resolution) rejects at once without a TTY ("Interactive prompts require a TTY
  terminal", bin.cjs 1449), so `generate </dev/null` fails fast instead of hanging. Renames: split into add+backfill+drop
  tickets or a custom migration.
- oxlint ignores `drizzle/**`; oxfmt ignores `drizzle/meta/**`. Generated SQL MUST be committed on the ticket branch: Vitest
  (CI) and the Vercel preview build both apply `drizzle/*.sql`, so a TS-only schema change fails CI and the preview.

## 5. Test DB harness
- Pattern (README, `src/app/api/health/route.test.ts`): `let testDb: TestDb; vi.mock("@/server/db", () => ({ get db() {
  return testDb; } }));` + `beforeEach(async () => { testDb = await createTestDb(); })`; mock `next/server` `connection`.
- Cost (verified here): fresh PGlite + 1 migration = 1.66 s; `await migrated.clone()` = 0.35-0.43 s and keeps extensions and
  `drizzle.__drizzle_migrations`. Replay cost grows with every migration; ~50 of 79 tickets touch schema. #57 should keep the
  `createTestDb()` signature but migrate once per worker into a template and return `template.clone()` (PGlite 0.5 has
  `clone()`, `dumpDataDir()`, `loadDataDir`). Re-measure `pnpm test` after #57 to set gate timeouts.
- Extensions: PGlite 0.5.16 contrib ships `cube`, `earthdistance`, `pgcrypto`, `citext`, `btree_gist`, `uuid_ossp`, `unaccent`,
  `pg_trgm`, ... Verified: `{cube, earthdistance}` load, `earth_distance(ll_to_earth(19.07,72.87), ll_to_earth(18.52,73.85))`
  = 120060 m, survives `clone()`. Rule: any migration with `CREATE EXTENSION x` must add `x` to `new PGlite({extensions})` in
  the same commit, else every DB test fails. Runtime check for prod: extension trusted on PG18 and creatable by `*_migrator`.
- `gen_random_uuid()` works in PGlite without extensions (verified via generated `uuid().defaultRandom()`).

## 6. Preview database per branch
- `vercel-build` = `pnpm db:migrate && next build && pnpm check:build`. With `APP_ENV=preview` the build creates and migrates
  `foa_pr_<VERCEL_GIT_PULL_REQUEST_ID>`, or `foa_br_<slug<=47>_<sha256(ref)[:8]>` while the branch has no PR, `TEMPLATE
  foa_seed` (empty today), comment `foa-preview pr=<n>` / `foa-preview branch=<ref>`; app runtime swaps the same name into
  `DATABASE_URL`. A branch pushed before its PR therefore gets a `foa_br_*` DB, then a separate fresh `foa_pr_*` DB.
- Sweeper `docker/scripts/sweep-preview-dbs.sh` (hourly, root, VPS): selects DBs by comment `LIKE 'foa-preview %'`, requires
  name `^foa_(pr|br)_[a-z0-9_]{1,56}$`, drops `pr=` DBs when the PR is closed, `branch=` DBs when the ref is gone; names are
  never parsed. One unauthenticated GitHub API call per `pr=` DB per hour (60/h budget).
- Seed: README names `scripts/seed.ts` (not yet present); #57 AC: previews run the seed after migrations => change
  `vercel-build` to `pnpm db:migrate && pnpm db:seed && next build && pnpm check:build`, seed idempotent (same-branch rebuilds
  reuse the DB) and refused unless `APP_ENV` is `local`/`preview`. Seed code must load under tsx (no `server-only`).

## 7. Existing tests and patterns
- 36 Vitest files (`src/**/*.test.ts(x)`, `scripts/**/*.test.ts`, `tests/e2e/**/*.test.ts`) + 1 Playwright `tests/e2e/smoke.spec.ts`;
  ~430 tests, 7-10 s. DB-backed: only `src/test/db.test.ts` and `src/app/api/health/route.test.ts`.
- Colocated `x.test.ts` beside `x.ts`; plain-English `describe/it`; `it.each` tables (20 uses); dependencies injected as
  functions/options (`fakeSql()` + `{log, sleep}` in `preview-database.test.ts`), `vi.spyOn(console,"error").mockImplementation`.
- No fake timers anywhere; time is injected as `now: Date` (`src/content/sample/selectors.ts`, `src/app/competitions/_lib/view.ts`);
  RSC "now" via `cachedNow()` (`src/components/showcase/clock.ts`, `"use cache"`). No jsdom: components are called as functions.

## 8. Seam 1 (#55 "Testing Decisions"): exists vs must be built
| Piece | Status | Built by | Proposed location / note |
|---|---|---|---|
| Fresh PGlite with real migrations | EXISTS | — | `src/test/db.ts`; add template+`clone()` in #57 |
| `as(actor).<useCase>(input)` facade | MISSING | #57 | `src/server/app.ts` (`as(actor, deps?)`); `Actor` = anonymous{ip} / user{userId,sessionId,ip}; same entry used by server actions + route handlers |
| Deps container (db, clock, ports) | MISSING | #57 | `src/server/deps.ts` (prod wiring) vs harness wiring; replaces `vi.mock("@/server/db")` for use-case tests |
| Fake clock | MISSING | #57 | port `src/server/ports/clock.ts` (`now()`), fake `src/test/fakes/clock.ts` (`set`, `advance`). Use cases write timestamps from `clock.now()`, never rely on `defaultNow()`. Libraries reading `Date` (Better Auth OTP/session expiry) need `vi.useFakeTimers({toFake:["Date"]})` + `vi.setSystemTime` synced by the fake; runtime-check Better Auth honours it |
| Harness entry | MISSING | #57 | `src/test/harness.ts`: `createHarness()` -> `{db, clock, email, as, seed}`; later fields appended by owning tickets |
| Email capture adapter + in-memory fake | MISSING | #57 | adapter persists messages (staff + Seam 2 read codes); fake `src/test/fakes/email.ts` |
| Seed builders + seed command | MISSING | #57 | `src/server/seed/<module>.ts` + barrel `src/server/seed/index.ts` (tsx-loadable, take `db`); `scripts/seed.ts`, `pnpm db:seed`. ~50 tickets "extend seed data" |
| SMS fake + capture, encrypted column type | MISSING | #58 | encrypted type is schema infra: serialize with other schema-infra tickets |
| Job/outbox drain in-process | MISSING | #61 | `harness.drain()` ("advance clock, drain jobs, assert"); 26 tickets use it |
| Storage + malware scanner fakes | MISSING | #63 | storage port; #68 uses it |
| Payment gateway fake + webhook simulator (valid/invalid signatures) | MISSING | #77 | then #106, #107, #133 |
| Media processor fake / PDF renderer fake | MISSING | #86 / #100 | `worker-media` ports |
| `cube`+`earthdistance` in PGlite | AVAILABLE, unused | #127/#128 | add to `extensions` with the migration |
| Audit-row assertions, append-only trigger | MISSING | #59 | custom migration + trigger test |

## 9. Hot files (same-file => serialize or resolve in merge queue)
- `src/server/db/schema/index.ts`: every schema ticket adds one line. Verified: a naive rebase conflicts here. Fix in wave 0:
  commit `.gitattributes` line `src/server/db/schema/index.ts merge=union` (verified: two branches' `export *` lines merge
  cleanly); same for `src/server/seed/index.ts`. `drizzle/meta/_journal.json` + `NNNN_snapshot.json`: always conflict
  (add/add) => regenerated, never hand-merged. Also hot: `src/test/harness.ts`, `src/test/db.ts`, `src/test/fakes/*`,
  `src/server/deps.ts`, `package.json` scripts, `vitest.config.ts`, `messages/en-IN/*.json` (union does not work on JSON).

## 10. Migration-numbering conflict: risk and mitigation (procedure verified end to end in a scratch clone)
Risk: branches cut from the same trunk both generate `0001_*`; after one merges, the other's journal/snapshot conflict, and
`drizzle-kit check` reports a collision. Worse, the PR preview DB (`foa_pr_<n>`) already applied the branch's old SQL: after
regeneration the migrator re-runs it and fails (verified: `relation "phones" already exists`), so the Vercel build fails and no
E2E status arrives; if instead a trunk entry's `when` is older than the branch's, it is silently skipped on that DB.
Rules: (1) runners commit generated SQL (CI needs it) with `--name <issue>_<slug>`, at most ONE generated migration per ticket
plus custom ones; custom SQL that must precede the generated DDL is named `<issue>_pre_<what>`. (2) Never regenerate an entry
already on `factory/trunk`. (3) Merge queue regenerates only if `git diff --quiet $BASE origin/factory/trunk -- drizzle` fails
or any branch `when` >= queue time; else plain rebase. (4) Schema slot: one schema-changing ticket at a time holds a mutex
(ledger field) from its pre-PR regeneration until its merge into trunk; its PR (hence `foa_pr_<n>`) is opened only after the
regeneration, so that DB never sees stale SQL. (5) If a regeneration happens after the PR DB applied old SQL (slot lost/timeout),
respin: push the head to `factory/<issue>-<slug>-r2`, open a new PR, close the old one (sweeper drops its DB).
Procedure (run in the ticket worktree, clean tree, after `git fetch origin`; ISSUE, SLUG, SUBJECT set):
```bash
set -euo pipefail; export DIRECT_URL=postgres://foa:foa@localhost:5432/foa   # parsed by drizzle.config.ts, never connected
TRUNK=origin/factory/trunk; BASE=$(git merge-base HEAD "$TRUNK"); SAVE=$(mktemp -d)
for f in $(git diff --name-only --diff-filter=A "$BASE" HEAD -- 'drizzle/*.sql' | sort); do        # keep custom bodies
  if head -n1 "$f" | grep -q '^-- Custom SQL migration file'; then cp "$f" "$SAVE/"; fi; done
git reset --soft "$BASE"                                         # squash the branch (PRs are squash-merged anyway)
git restore --source="$BASE" --staged --worktree -- drizzle      # drop every branch-added migration + journal change
git commit -q -m "$SUBJECT"; git rebase "$TRUNK"                 # barrel merges via union; resolve code/messages conflicts
regen_custom() { local s; s=$(basename "$1" .sql | cut -d_ -f2-)
  timeout 120 pnpm -s db:generate --custom --name "$s" </dev/null
  cp "$1" "$(ls drizzle/[0-9][0-9][0-9][0-9]_"$s".sql | tail -n1)"; }
for f in "$SAVE"/*_pre_*.sql; do [ -e "$f" ] && regen_custom "$f"; done
timeout 120 pnpm -s db:generate --name "${ISSUE}_${SLUG//-/_}" </dev/null   # schema delta vs trunk's latest snapshot
for f in $(ls "$SAVE"/*.sql 2>/dev/null | grep -v '_pre_' | sort); do regen_custom "$f"; done
jq -e '[.entries[].when] as $w | $w == ($w|sort) and ($w|unique|length) == ($w|length)' drizzle/meta/_journal.json
jq -e '[.entries[].idx] == [range(0; .entries|length)]' drizzle/meta/_journal.json
timeout 60 pnpm -s exec drizzle-kit check
out=$(timeout 60 pnpm -s db:generate </dev/null); grep -q 'No schema changes' <<<"$out"   # SQL matches TS
pnpm exec vitest run src/test/db.test.ts
git add -A drizzle && git commit -q --amend --no-edit && git push --force-with-lease origin "HEAD:factory/${ISSUE}-${SLUG}"
```
Verified result: trunk `0001_57_users`; branch's `0001_58_phone`+`0002_58_phone_trigger` became `0002_58_phone` +
`0003_58_phone_trigger` (custom body preserved), `when` strictly increasing, `drizzle-kit check` clean, fresh DB has both tables.
A non-zero `db:generate` (rename prompt) or failed gate returns the ticket to its runner with the error text.

## 11. Runtime checks for the Orchestrator
- `jq -c '.entries[]|[.idx,.tag,.when]' drizzle/meta/_journal.json` on trunk after every merge; alert if a `when` is in the future.
- After #57: `pnpm test` wall time; per-test DB cost (`clone()` vs fresh); whether Better Auth respects `vi.setSystemTime`.
- Whether the seed runs per preview DB (`vercel-build`) or into `foa_seed` (needs owner VPS action); `pnpm db:seed` idempotence.
- Prod/staging: `CREATE EXTENSION cube, earthdistance` allowed for `*_migrator` (owner runs on pg-nonprod first).
