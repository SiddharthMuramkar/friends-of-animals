# 57a review, round 1, at 0569f4f97809f11165221fb6346934442c2a6756

These are independent cold reviews (standards, spec, security). Fix every **blocking** finding, test-first where it changes behaviour.
Minor findings: fix them if cheap, otherwise list them under the PR's `## Residue`. If you reject a finding, state the evidence in the PR body.
Do not add retries or raise timeouts to make the flake go away; fix its cause.

## standards: fail

Fail: one blocking standards problem, a flaky Vitest gate. Each worker builds its migrated PGlite template inside the first test of each file, within the 5 s timeout. On this shared 8-CPU box, 2 of 5 clean `pnpm test` runs timed out, against 0 of 3 on foa/M0.
Checks that passed: typecheck, lint and format. The build gate and `check:build` pass. The tree stays clean. `drizzle-kit check` reports no problems, and regenerating 0001 from the M0 base gives byte-identical SQL and snapshot. No dependencies were added. Schema and seed files stay plain-Node safe. No mocks of internal modules. The email contract runs against both the fake and the capture adapter. Commits follow the convention.
Minor findings: the email-normalisation invariant is not a constraint, FormAlert duplicates Callout's tone map, TextField's prop spread can override its aria wiring, `{db, clock}` is declared inline in several places, and the seed and accounts comments describe things that are not there yet.
Worktrees /root/foa-wt/_rv-57a-standards and _rv-57a-standards-base were removed.

### standards-1 [blocking] test quality / harness stability (src/test/db.ts:53)

**Problem:** Each Vitest worker builds its migrated PGlite template lazily, inside the first test of each file, so that test has to fit a full migration plus a clone into the default 5 s testTimeout. With eight PGlite test files now migrating at once, `pnpm test` (gate 1) times out on this 8-CPU box under its normal shared load. M0 itself passes every run. This is the X1 harness every later unit inherits, and each new PGlite test file adds another concurrent migration, so the flake gets worse over time.

**Evidence:** Clean `nice -n 10 pnpm test` runs at 0569f4f: 2 of 5 failed (load average 10 to 15). Failures: `FAIL src/server/deps.test.ts > emailSenderFor > captures email on local ...`, `FAIL src/test/db.test.ts > createTestDb > applies the migrations, including pg_trgm`, `FAIL src/test/harness.test.ts > createHarness > starts the clock ...`, `FAIL src/server/ports/email-capture.test.ts > ... delivers a message ...`, `FAIL src/server/seed/seed.test.ts > seedPreview > creates a super admin ...`, `FAIL src/server/use-cases.test.ts > ... gives every use case ...`, each with `Error: Test timed out in 5000ms`. foa/M0 (442dd99) under the same load: 3 of 3 passed. Verbose reporter on a passing head run: the first test in each PGlite file took 3068 to 3558 ms, against 1170 ms for the second.

**Fix:** Move the template build out of the test body. One way: a `setupFiles` entry in vitest.config.ts with `beforeAll(() => warmTestDbTemplate(), 30_000)`. Another: a `globalSetup` that migrates once and writes `dumpDataDir()`, which workers then load with `new PGlite({ loadDataDir })` (the approach issues-M0 §3.4 describes). Either way, the per-test cost becomes a clone. Do not add retries.

### standards-2 [minor] schema invariants (src/server/db/schema/identity.ts:15)

**Problem:** The column comment says the email is 'Stored trimmed and lower-cased; one account per address', but only uniqueness is a constraint. A writer that skips normaliseEmailAddress, such as a future Better Auth path or a manual fix, can create 'Asha@x' next to 'asha@x'. That breaks one account per address. Spec §10.9 says to express invariants as constraints.

**Evidence:** `email: text().notNull().unique(),` and drizzle/0001_57_harness.sql has only `CONSTRAINT "user_email_unique" UNIQUE("email")`.

**Fix:** Add `check("user_email_normalised", sql`${t.email} = lower(btrim(${t.email}))`)` to the table, or a unique index on `lower(email)`, before the migration lands on M0. Then regenerate 0001.

### standards-3 [minor] form kit (Duplicated Code, judgement call) (src/components/form/form-alert.tsx:9-25)

**Problem:** FormAlert repeats Callout's tone map (icon, box classes and label colour for danger and success) and its outer markup. The two copies can drift when a token or shape changes.

**Evidence:** form-alert.tsx: `danger: { icon: OctagonAlert, box: "border-danger-border bg-danger-bg", word: "text-danger" ...}`. src/components/site/callout.tsx: `danger: { icon: OctagonAlert, box: "border-danger-border bg-danger-bg", label: "text-danger" }`.

**Fix:** Extract the tone map and box class string into a small shared module that both the async Callout and the client-safe FormAlert import.

### standards-4 [minor] form kit accessibility (src/components/form/text-field.tsx:56-62)

**Problem:** `{...input}` is spread after the computed `aria-describedby` and `aria-invalid`. A caller who passes either prop silently drops the hint and error association that the component exists to guarantee.

**Evidence:** `<input id={id} aria-describedby={describedBy || undefined} aria-invalid={error ? true : undefined} className={inputStyles} {...input} />`

**Fix:** Spread `{...input}` first, or Omit 'aria-describedby' and 'aria-invalid' from TextFieldProps (merging any caller ids into describedBy).

### standards-5 [minor] Data Clumps (judgement call) (src/server/deps.ts:31-33)

**Problem:** `{ db: AppDb; clock: Clock }` is declared inline in emailSenderFor and in captureEmailSender (email-capture.ts:24-30), although src/server/seed/types.ts already names the same shape SeedDeps.

**Evidence:** deps.ts: `deps: { db: AppDb; clock: Clock }`. email-capture.ts: `}: { db: AppDb; clock: Clock; }): EmailSender`. seed/types.ts: `export type SeedDeps = { db: AppDb; clock: Clock };`

**Fix:** Name the pair once, for example `type Store = Pick<Deps, "db" | "clock">` beside Deps or in db/app-db.ts, and use it in all three places.

### standards-6 [minor] comments that misstate the code (scripts/seed.ts:1-7)

**Problem:** The header says the seed 'runs after every migration' and that `vercel-build` can always run it, but `vercel-build` still does not run it. Also, src/server/seed/accounts.ts:4 says 'Playwright reads these constants (tests/e2e/support/accounts.ts)', and that file does not exist.

**Evidence:** package.json:24 `"vercel-build": "pnpm db:migrate && next build && pnpm check:build"`. `ls tests/e2e/support` gives `No such file or directory`.

**Fix:** Wire `pnpm db:seed` into vercel-build if this unit owns that, or reword both comments to say what happens today and which ticket adds the hook and the Playwright helper.


## spec: fail

57a is mostly solid. It has the template-clone PGlite harness (about 263 ms per world), `as(actor)` with a duplicate-name check at compile time, the clock port and FakeClock, app-generated UUIDv7, the email port with a fake, a capture adapter and a shared contract, idempotent seed builders limited to preview/local, the form kit, GLOSSARY.md and docs/agents/seam-1.md. `pnpm check` passed on rerun (504 tests; the first run had 4 timeouts at load average 15.5). The build with no database and `check:build` also pass, with public pages still prerendered.
It fails on two in-scope items. First, `vercel-build` doesn't run `pnpm db:seed`, which breaks ticket AC6 and the 57a split. Second, there's no migrations fingerprint in the preview DB name, which spec §1.9 and dag.md §1.1 assign to 57a.
Minor findings: the capture mailbox orders same-millisecond messages at random, unlike the fake (9 of 20 wrong in a scratch test). Template migration inside the first test flakes under load. `can()`, drain, roles and BA clock-alignment hooks are deferred. Docs have a dangling comment reference.

### spec-1 [blocking] seed / preview deploy (ticket AC6, split 57a) (package.json:24)

**Problem:** The seed never runs on preview deployments. `pnpm db:seed` was added, but `vercel-build` still runs only migrate, build and check. The ticket AC says "Preview deployments run the seed command after migrations", and the issues-M0.md split gives 57a "`pnpm db:seed` + `vercel-build` hook (preview/local only, idempotent)". §3.6 says `vercel-build` should become `pnpm db:migrate && pnpm db:seed && next build && pnpm check:build`. The code's own comments say the hook exists when it doesn't, and no test covers the wiring.

**Evidence:** `git show 0569f4f:package.json | grep vercel-build` prints `"vercel-build": "pnpm db:migrate && next build && pnpm check:build",`. scripts/seed.ts:7 says "it exits 0 without connecting, so `vercel-build` can always run it". src/server/seed/target.ts:12 says "so `vercel-build` can run it everywhere".

**Fix:** Change `vercel-build` to `pnpm db:migrate && pnpm db:seed && next build && pnpm check:build`. Add a cheap test, for example in scripts/*.test.ts, that reads package.json and checks that `db:seed` comes right after `db:migrate` and before `next build`.

### spec-2 [blocking] preview DB migration fingerprint (spec §1.9, dag.md §1.1) (src/server/db/database-url.ts:50)

**Problem:** Preview database names carry no migrations fingerprint. Spec §1.9 says "A migration regenerated after the PR's DB applied the old one breaks that preview (57a adds a migrations fingerprint to the DB name; section 13)". dag.md §1.1 also lists "preview-DB migration fingerprint and form kit → 57a". The form kit landed but the fingerprint didn't. Without it, every merge-queue regeneration of `drizzle/` leaves a stale preview DB. Drizzle's migrator compares only `created_at`, so re-dated entries are skipped silently.

**Evidence:** `git diff foa/M0...0569f4f --stat -- src/server/db/database-url.ts scripts/preview-database.ts scripts/migrate.ts` is empty. `previewDatabase()` still returns `{ name: \`foa_pr_${pr}\`, ... }`. The new src/server/seed/target.test.ts even expects `postgres://m:p@db.example.test:6432/foa_pr_140`. `git grep -i fingerprint 0569f4f -- scripts src` finds nothing in code.

**Fix:** Add a short hash of the migration set to both preview name forms, so a regenerated folder gets a fresh database. A SHA-256 of `drizzle/meta/_journal.json` tags plus `when` values works, for example `foa_pr_<n>_<fp8>` and `foa_br_<slug>_<hash>_<fp8>`, still within 63 bytes. Keep the `foa-preview pr=<n>` / `branch=<ref>` comment format the sweeper parses. Migrate, seed and runtime `resolveDatabaseUrl` must use the same name. Add tests in database-url tests and target.test.ts.

### spec-3 [minor] fake faithfulness (email contract) (src/server/ports/email-capture.ts:57)

**Problem:** `readCapturedEmail` promises "newest first", but two messages sent in the same millisecond come back in random order. The UUIDv7 tiebreak is random within a millisecond, while `FakeEmail` is always newest-first. The shared contract only tests messages 30 s apart, so it misses the gap. Seam 1 tests of the capture mailbox (57b) that resend a code without advancing the FakeClock will be flaky.

**Evidence:** Scratch test in a throwaway worktree: 20 rounds of two captured sends to one address at the same FakeClock instant, then `readCapturedEmail(db,{to})[0]`. Output: `capture returned the older message first in 9 of 20`. FakeEmail returned the newer one 20 of 20.

**Fix:** Add a contract case for "two messages at the same instant, the later one first". Make the adapter pass it, either with a monotonic tiebreak (a bigserial `seq` column ordered after `created_at`) or by making `uuidv7()` monotonic within one millisecond.

### spec-4 [minor] test stability under load (src/test/db.ts:53)

**Problem:** The per-worker template is migrated lazily inside the first test of each file, so that test pays the full migration cost within Vitest's default 5 s timeout. On this shared 8-CPU box the gate flaked once.

**Evidence:** First `pnpm check` at load average 15.55 gave `Test Files 4 failed | 43 passed (47)` with `Error: Test timed out in 5000ms` in the first test of email-capture.test.ts and harness.test.ts. An immediate rerun passed: `Tests 504 passed (504)`.

**Fix:** Build the template outside test bodies, for example in a Vitest `setupFiles` hook or a `beforeAll` with its own timeout, or give PGlite suites a larger `testTimeout`. Never add retries.

### spec-5 [minor] harness contract hooks (issues-M0.md §3.2, §3.3, §3.5, §3.7) (src/server/actor.ts:17)

**Problem:** Several hooks the split lists for 57a are missing: the `can()` stub (the split says "actor model, minimal can() stub"), `Actor.roles` / `secondFactorAt`, `world.drain()` (a no-op until #61), the `PERSONAL_DATA_FIELDS` registry, and `FakeEmail.codeFor()`. The harness also doesn't align system `Date` with the FakeClock. 57b needs that alignment if Better Auth checks OTP expiry with its own clock. Each of these can land with its owning ticket (X1 allows appending), but 57b and 57c must then pick up `can()` and the clock alignment.

**Evidence:** `git grep -nE "\bcan\(" 0569f4f -- src` finds nothing. The `user` actor is `{ kind: "user"; userId; sessionId; meta }`. The Harness interface has no `drain`. FakeClock has no `vi.setSystemTime` call.

**Fix:** Add a minimal `can()` with a call-site convention now, or have 57b do it with its first use case. Have 57b add the BA clock alignment, with a self-test that OTP expiry follows `clock.advance`, as §3.3 asks.

### spec-6 [minor] docs (src/server/seed/accounts.ts:4)

**Problem:** Comments point to `tests/e2e/support/accounts.ts`, which doesn't exist. GLOSSARY.md has `Seed data` but no `Seed builder` (check 6 in §3.8). There are no ADRs, though §10.8 makes ADRs conditional, so that part is optional.

**Evidence:** `git ls-tree -r --name-only 0569f4f tests/e2e` lists only global-setup.ts, smoke.spec.ts and vercel-bypass*.

**Fix:** Reword the comment as "(57b adds tests/e2e/support/accounts.ts)", or add the re-export now. Optionally add `Seed builder` to GLOSSARY.md.

**ACs not proved:**

- AC1 sibling: A visitor signs up with an email and code and lands signed in; a returning user signs in the same way (57b (Better Auth, OTP use cases, /sign-up, /sign-in) per the issues-M0.md split)
- AC2 sibling: Codes expire after a short time; too many requests per email or IP are refused with a clear message (57b (both rate limiters, OTP expiry); HR-19 defaults)
- AC3 sibling: A user can list their sessions and sign out of one or all (57c)
- AC6 refuted: Preview deployments run the seed command after migrations (57a: pnpm db:seed + vercel-build hook); seeded accounts can sign in (57b) (package.json:24 `vercel-build` = `pnpm db:migrate && next build && pnpm check:build`, with no `pnpm db:seed`. The seed itself is proved idempotent and limited to preview/local by seed.test.ts and target.test.ts.)
- AC7 sibling: Seam 2 Playwright journey signs up by email code on the preview via the capture mailbox (57b; preview run is HR-01/HR-02 residue)
- AC8 sibling: axe is clean on the sign-up, sign-in and sessions pages (57b and 57c (57a has no pages))
- AC15 refuted: Migrations fingerprint in the preview DB name (spec §1.9; dag.md §1.1 assigns it to 57a) (database-url.ts:50 still returns `foa_pr_${pr}`, and `git grep -i fingerprint` finds nothing in code)
- AC17 sibling: Minimal can() stub (issues-M0.md split for 57a) (Not built. 57a has no use cases, and the rules it would hold (visitor requests/verifies codes, user lists/revokes own sessions) belong to 57b/57c use cases. Flagged as a minor finding so 57b adds it.)

## security: fail

Verdict: fail. No security or privacy hole in the code itself. Production refuses to send email rather than capturing it. On Vercel the seed refuses staging and production (exit 0 without connecting) and fails when APP_ENV is missing. No secrets or personal data reach logs, and there are no new dependencies. `pnpm check` passes in a throwaway worktree (47 files, 504 tests).
Blocking, both scope rather than security: the seed is not wired into `vercel-build`, which is a ticket AC that the split proposal gives to 57a; and the migrations fingerprint in preview database names and the `.gitattributes` union-lines check, both listed as 57a ACs in spec §1.9 and P0-12, are missing.
Minor: `user.email` uniqueness is case-sensitive (cheap to fix while migration 0001 is not yet on M0); captured messages are never purged on staging; a missing APP_ENV off Vercel lets the seed hit any DIRECT_URL; there is no deny-by-default `can()` stub.

### security-1 [blocking] scope / infra (V flag): seed never runs on previews (package.json:24)

**Problem:** Ticket #57 has the AC "Preview deployments run the seed command after migrations". The split proposal (issues-M0.md, #57 "57a ... `pnpm db:seed` + `vercel-build` hook (preview/local only, idempotent)") and code-server.md §6 give the hook to 57a. `vercel-build` is unchanged, so no preview database is ever seeded. Meanwhile scripts/seed.ts:3,7 and src/server/seed/target.ts claim it "runs after every migration" and that "`vercel-build` can always run it". This is the risky infra part of the unit, and nothing in code or residue says it was deferred.

**Evidence:** `git show 0569f4f:package.json | grep vercel-build` -> `"vercel-build": "pnpm db:migrate && next build && pnpm check:build",`. Wiring it would be safe. In a scratch worktree: `APP_ENV=production DIRECT_URL=... pnpm db:seed` -> `Not seeding. APP_ENV=production: ...` exit 0; `VERCEL=1 APP_ENV=staging ...` -> `Not seeding. APP_ENV=staging` exit 0; `VERCEL=1` with APP_ENV unset -> `APP_ENV is not set...` exit 1.

**Fix:** Set `vercel-build` to `pnpm db:migrate && pnpm db:seed && next build && pnpm check:build` (code-server.md §6) and keep the exit-0 refusal for staging and production. If the hook is meant for 57b, say so in the code comments and in residue instead of claiming it already runs.

### security-2 [blocking] scope: 57a ACs named in the spec are missing (outside the security remit; flagged per review-common) (src/server/db/database-url.ts:47)

**Problem:** Several sources name these as 57a ACs: spec §1.9 ("57a adds a migrations fingerprint to the DB name"), P0-12 ("57a's brief adds ACs: ... migrations fingerprint in the preview-DB name, a check that both `.gitattributes` union lines exist"), §13.6 step 5 and dag.md §1.1. `previewDatabase()` still returns `foa_pr_<n>` / `foa_br_<slug>_<hash>` with no fingerprint. There is no `.gitattributes` at this SHA and no check for its union lines.

**Evidence:** `git diff --stat foa/M0...0569f4f` does not touch database-url.ts. `git show 0569f4f:.gitattributes` -> `fatal: path '.gitattributes' does not exist`. `git grep -i fingerprint 0569f4f -- src scripts` -> only an unrelated line of privacy-page copy.

**Fix:** Add a migrations fingerprint (for example 6-8 hex characters of sha256 over the drizzle journal tags) to preview database names. Use it in both `migrationTarget` and `resolveDatabaseUrl`, so seedTarget picks it up too. Keep names within 63 bytes and matching the sweeper regex `^foa_(pr|br)_[a-z0-9_]{1,56}$`. Add a test that both `.gitattributes` `merge=union` lines exist (schema and seed barrels). If the orchestrator moved these items, record where they went.

### security-3 [minor] authentication / identity integrity (src/server/db/schema/identity.ts:15)

**Problem:** The column comment says "Stored trimmed and lower-cased; one account per address", but only the seed code enforces that. The `UNIQUE(email)` in drizzle/0001_57_harness.sql:10 is case- and whitespace-sensitive. Better Auth (57b) and #58 will write this table outside FOA's normaliser, so the same address could end up with two accounts (the `A@x.com` vs `a@x.com ` abuse case in rubric R4).

**Evidence:** Scratch test on the real migrations inserted 'asha@example.test', 'Asha@Example.test' and ' asha@example.test'. All three rows were accepted: `ROWS [{"email":"asha@example.test"},{"email":"Asha@Example.test"},{"email":" asha@example.test"}]`.

**Fix:** Add `CHECK (email = lower(btrim(email)))` (or a unique index on `lower(email)`) to this migration now. Migration 0001 is not on M0 yet, so editing it costs nothing today; once it lands it can't be changed.

### security-4 [minor] personal data / retention (src/server/db/schema/mailbox.ts:23)

**Problem:** `captured_message` keeps every captured email (recipient address, subject, body with the one-time code) forever, and nothing purges it. Staging captures too, and staging is the public live site (issues-M0 F5), so real visitors' addresses and codes will build up there with no retention period.

**Evidence:** Scratch test: send through `emailSenderFor("staging", ...)`, call `clock.advance({ days: 365 })`, then `readCapturedEmail` -> `[{"to":"real.person@gmail.com","subject":"Your code","text":"Your code is 123456",...}]`. The row is still there.

**Fix:** Purge captured messages after a short window, for example delete rows with `created_at < now - 7 days` on each send, or a job once #61 lands. List the table under HR-31 when the data inventory (#73) exists.

### security-5 [minor] infra / seed guard (src/server/seed/target.ts:18)

**Problem:** `env.APP_ENV ?? "local"` treats a missing APP_ENV as local and seeds whatever DIRECT_URL names, even a remote production or staging URL. On Vercel this is refused because APP_ENV is required there, so only hand-run commands are exposed. Once #59 makes super-admin@example.test a super admin, a staging database seeded by mistake (staging captures email) would hold a super-admin login with a known address.

**Evidence:** Scratch test: `seedTarget(parseEnv(migrationEnvSchema, { DIRECT_URL: "postgres://foa_migrator:x@db.shipped-it.dev:6432/foa?sslmode=verify-full" }))` -> `{"seed":true,"url":"postgres://foa_migrator:x@db.shipped-it.dev:6432/foa?sslmode=verify-full"}`.

**Fix:** For local, require a loopback or Compose host (localhost, 127.0.0.1, ::1, db), or refuse the database names `foa` and `foa_staging`. Leave the preview path as it is.

### security-6 [minor] authorization seam (src/server/use-cases.ts:40)

**Problem:** The split proposal lists a "minimal `can()` stub" for 57a. #59's hotspot note expects "actor type and `can()` stub created by #57", and §1.11 requires every use case to start with `can()`. There is no `can()` anywhere. No production use case exists yet, so nothing is exposed today, but 57b's first use cases would have no policy hook.

**Evidence:** `git grep -n -E "\bcan\(" 0569f4f -- src/server src/lib` -> no matches.

**Fix:** Add a deny-by-default `can(actor, action, resource?)` in src/server/ (for example policy.ts) with an allow test and a deny test, so 57b's use cases start with it and #59 only replaces its internals.

