# Brief 114: data inventory and retention jobs (#114, M5)

Branch `ticket/114-data-inventory-and-retention-jobs` · worktree `/root/foa-wt/114` · cut from `foa/M0` 442dd99 (rebase onto `foa/M5` at build) · size L · risk (PD, K, A, $) · no conflict key · blockers **73** (creates the inventory file) and **81b**; it also needs 59a, 60, 61a/61b, 62 and 69 on trunk. No siblings: unit 114 is the whole issue.
**Head start on the branch:** `058f149 M5 #114: Add data inventory and retention domain core`: `src/server/privacy/domain/{coverage,schema-columns,retention-period,retention-plan,anonymise}.ts`, 38 Vitest cases, `pnpm check` green. New files only; rebase onto `foa/M5` at build.

## Scope
**In:** the Privacy module's inventory and retention parts: (1) the inventory becomes typed code with a coverage test over the whole schema (every column is either a PD entry or on a `NON_PERSONAL` list), and 114 backfills every entry M0–M5 tickets left incomplete; (2) a retention engine plus a policy registry; (3) `legal_hold` table and use cases; (4) statutory floors (financial = 8 years after FY end) that no setting can shorten; (5) the daily schedule `privacy.retentionSweep` (02:15 IST); (6) one `retention.<policy>.days` setting per policy in #62's catalogue; (7) an audit row `privacy.retention_run` with counts only; (8) `/admin/privacy` (inventory, holds) as the last slice.
**Out:** rights requests, export and erasure (#115a/#115b: they reuse `subject` and `onExpiry` from the entries, F15/F16); deleting `audit_log` rows (append-only; owner-run superuser path, HR-30); breach log (#116); retention rows for tables that don't exist yet (each later PD ticket appends, H41/H5: the coverage test is the arbiter).

## Acceptance criteria as testable checks
1. **Coverage** (Vitest over the real barrel). `checkInventoryCoverage(schemaColumns(schema), INVENTORY, NON_PERSONAL, policies)` returns `[]` on trunk. Meta-tests with fixture tables (pure, **done**): an unclassified column, a stale entry, a column on both lists, a duplicate, an unknown policy, an empty purpose/period/subject, a `*_ciphertext` column on `NON_PERSONAL`, and `set_null` on a NOT NULL column each give one named problem.
2. **Retention deletes/anonymises** (Seam 1). Seed an expired and a fresh row for a delete policy and an anonymise policy; `h.clock.advance({ days: period + 1 })`; run the due schedule (`privacy.retentionSweep`) then `h.drain()` → expired rows gone / PD columns nulled or tombstoned, fresh rows untouched. Running it again changes nothing and writes one more `privacy.retention_run` audit row with zero counts.
3. **Holds and floors** (Seam 1 + pure, floor maths **done**). A row whose subject has an active `legal_hold` survives (counted `held`); after `releaseLegalHold` the next run removes it. A financial row (payment, #77) with `retention.financialRecords.days` stored raw at 30 survives until 1 April of FY-end+8 years IST (`retainedByFloor`); `changeSetting` with a value below the floor's minimum is refused `invalid_value`.
4. **Run audit** (Seam 1). Each run (and each preview) writes exactly one `audit_log` row, action `privacy.retention_run`, actor `system/worker`, `after` = `{ dryRun, policies: { <key>: { deleted, anonymised, held, retainedByFloor } } }` and nothing else (parsed by the strict `retentionRunAuditSchema`, **done**). Assert the JSON holds no email, phone, name or uuid.
5. **Periods are settings** (Seam 1, via #62). `changeSetting({ key: "retention.capturedMessages.days", value })` with step-up applies to the next run (no deploy) and writes #62's `settings.change` audit row; without step-up → `step_up_required`, nothing written.
6. **Authorization** (Seam 1, every new use case): `runRetentionSweep` system(worker|cli) only — super admin, staff admin and member refused; `previewRetentionSweep` super admin (staff admin, finance, member refused); `placeLegalHold`/`releaseLegalHold` super admin with step-up (staff admin, member refused; no step-up → `step_up_required`); `getInventory` staff admin and super admin (finance, member, visitor refused). Refusals write nothing.
7. **Seam 1 only** for all of the above: `as(actor).<useCase>` on PGlite with real migrations, `FakeClock`, provider fakes. No mocks of our modules.
8. **Page** (Seam 2, written, **Not run**): `tests/e2e/114-privacy.spec.ts` → `expectRendersAccessibly` on `/admin/privacy` (inventory + holds) light and dark.

## Files
- **Have (head start):** `src/server/privacy/domain/{coverage,schema-columns,retention-period,retention-plan,anonymise}.ts` + tests.
- **New:** `src/server/db/schema/privacy.ts` (`legal_hold`: id uuidv7, `subject_type` text, `subject_id` uuid, `reason` text ≤ 500, `placed_by_user_id`, `placed_at`, `released_by_user_id`, `released_at`; partial unique `(subject_type, subject_id) where released_at is null`); migration `--name 114_privacy_retention` (no custom SQL, no enum); `src/server/privacy/{inventory,non-personal,policies,sweep,holds,use-cases,policy}.ts` + Seam 1 tests; `src/server/privacy/policies/*.ts` (one adapter file per starter policy); `src/app/(staff)/admin/privacy/**`; `messages/en-IN/adminPrivacy.json`; `docs/privacy/data-inventory.md` (generated table, linked from the privacy notice later).
- **Inventory file:** 73 creates `src/server/privacy/inventory.ts` (M1 shape `{ table, column, purpose, retention: { period, basis, toConfirm: true } }`) and 74/75/78/79/81/83 append. 114 keeps the path and widens the type (adds `category`, `subject`, `retention.policy`, `onExpiry`), backfilling every existing entry. If trunk put it elsewhere, adopt that path and `git mv` the domain folder next to it.
- **Hotspots (append only):** schema barrel (+1), `app.ts` (`privacyUseCases`), #59 policy table (5 actions), #62 catalogue (one key per policy), 61's `SCHEDULES` (+1, H10), `src/i18n/messages.ts`, `src/lib/app-routes.ts`, admin nav (59b), `drizzle/meta/*` (merge queue). H41/H5 owner: every PD ticket in flight must pass the coverage test after rebase.

## Design (codebase-design, compared in context)
**Classification (F15).** (a) exhaustive: introspect every `PgTable` in the barrel, every column must be an entry or on `NON_PERSONAL` (explicit columns, no table wildcards); (b) a `pd()` column marker; (c) name heuristics + marker. **Chose (a)**: it fails closed on every new column, needs no change to how tables are declared, and the classifier is one pure function the meta-tests pin. (b)/(c) fail open when a runner forgets the marker, which is the failure the ticket exists to stop. The cost (later tickets classify non-PD columns too) is one line per table. Borrowed from (c): a `*_ciphertext` column can never be listed as non-personal.
**Engine.** (1) **Chosen: one engine, a registry of small policy adapters.** `RetentionPolicy = { key, action: "delete" | "anonymise", defaultDays, floor?, candidates(tx, cutoff, limit) → { id, anchor, subjects }[], apply(tx, ids) }`. The engine owns cutoff, floors, holds, batching, counts, audit and dry runs (deep: callers see `runRetentionSweep()`; tests see counts and rows). (2) Per-module schedules: hold/floor/audit logic copied N times, fails locality. (3) Fully inventory-driven generic SQL: deep but can't say "365 days after read" or join a row to its subject for holds. Policy `apply` for anonymise defaults to `anonymisePatch(entriesFor(table))` from the inventory, so the inventory stays the single source of what gets blanked.
**Holds.** Manual holds are per subject (`user`, `participant_profile`, `institution`, later `donor`); statutory holds are policy floors. A candidate is skipped if any of its subjects is held. No `retention_run` table: the audit row is the run record (fewer tables, no PD).
**Schedule.** `{ name: "privacy.retentionSweep", cron: "15 2 * * *", tz: "Asia/Kolkata", run(deps) }` calls `as(system worker).runRetentionSweep()`. Each policy skips when `to_regclass` finds its table absent (F17). Batches of 500 per transaction, looped until a batch is short.
**Defaults (reversible, in the PR):** expiry boundary `now − anchor ≥ days`; tombstone `"[removed]"` (text columns only; a NOT NULL non-text PD column must be `delete_row`), null otherwise; settings min = floor's minimum days, max 7305.

## Interface needs (code against these; rename to what lands)
```ts
// 57a: createHarness(), h.as, h.clock, h.deps, uuidv7(at); UseCaseContext = Deps & { actor }
// 59a
authorize(ctx, action: "privacy.sweep.run" | "privacy.sweep.preview" | "privacy.hold.place" | "privacy.hold.release" | "privacy.inventory.view", resource?): Promise<{ role: Role | null }>; // throws DomainError("forbidden")
recordAudit(tx, ctx, { action: "privacy.retention_run" | "privacy.hold_placed" | "privacy.hold_released"; entity: { type: string; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
h.seed.superAdmin(); h.seed.staffAdmin(); h.seed.grant(user, grant); h.signIn(user)
// 60
checkStepUp(ctx): { ok: true } | { ok: false; error: "step_up_required" }; h.stepUp(actor)
// 61a / 61b
type ScheduleDefinition = { name: string; cron: string; tz: "Asia/Kolkata" | "UTC"; run(deps: Deps): Promise<void> };
SCHEDULES: readonly ScheduleDefinition[]; h.drain(): Promise<DrainReport>; // fallback test helper: SCHEDULES.find(n).run(h.deps)
// 62
integerSetting({ default, min, max, unit: "days" }); readSetting(db, key); changeSetting({ key, value })
// 73 (+74/75/78/79/81/83): INVENTORY entries { table, column, purpose, retention: { period, basis, toConfirm: true } }
// 81b: guardian_invitation (kind guardian_request, status, expires_at), registration status pending_guardian
// 69: message_delivery (created_at), inbox_item (read_at); 63a: file_asset (status quarantined, updated_at); 77a: payment rows (created_at)
```

## Starter policies (runtime-check which tables exist on trunk)
`capturedMessages` delete 30 d (57a); `expiredVerifications` delete 1 d after expiry (57b); `expiredSessions` delete 30 d after expiry (57b; IP, UA); `messageDeliveries` delete 365 d (69); `readInboxItems` delete 365 d after read (69); `guardianRequests` anonymise contact 30 d after expiry/answer (81b); `quarantinedFiles` delete 30 d (63a); `financialRecords` anonymise payer contact, floor 8 FY (77a/79/80). `audit_log.ip/user_agent` → `retainedByDesign` (reported, never touched).

## Residue
- **HR-31:** every period is "confirm with counsel"; this ticket hosts the single G1 child later tickets append to.
- **HR-47:** financial floor 8 years after FY end (accountant).
- **HR-30:** audit-log IP/UA retention vs erasure; deletion is the owner's superuser path.
- **HR-10:** redeploy the worker so the schedule exists (staging worker runs `main`; previews run no cron).
- **HR-17:** a production super admin to place holds. Not run: Seam 2 (no Postgres server).

## Test plan
- **Pure (done):** `coverage.test.ts`, `schema-columns.test.ts`, `retention-period.test.ts`, `retention-plan.test.ts`, `anonymise.test.ts`.
- **Vitest over the real schema:** `src/server/privacy/inventory.test.ts` (AC 1).
- **Seam 1:** `sweep.test.ts`, `holds.test.ts`, `retention-settings.test.ts`, `inventory-view.test.ts` with `createHarness()`, fake clock, real migrations.
- **Seam 2 (Not run):** `tests/e2e/114-privacy.spec.ts`.

## Slices
1. **Inventory coverage on the real schema** (AC 1): widen 73's type, backfill entries, `NON_PERSONAL`, `docs/privacy/data-inventory.md`. Test `src/server/privacy/inventory.test.ts`.
2. **Sweep deletes and anonymises expired rows, audited** (AC 2, 4, 6 sweep/preview): engine, two starter policies, schedule, settings keys, run audit. Test `src/server/privacy/sweep.test.ts`.
3. **Legal holds and statutory floors** (AC 3, 6 holds): `legal_hold` schema + migration, place/release with step-up, `financialRecords`. Test `src/server/privacy/holds.test.ts`.
4. **Periods change through settings; remaining starter policies** (AC 5): Test `src/server/privacy/retention-settings.test.ts`.
5. **`getInventory` and `/admin/privacy`** (AC 6 inventory, 8). Test `src/server/privacy/inventory-view.test.ts` + `tests/e2e/114-privacy.spec.ts`.
