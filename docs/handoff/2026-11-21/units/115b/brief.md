# Brief 115b: privacy rights requests (export/erase)

Issue #115 · M5 · L · risk (PD, K, A, E, $) · no conflict key · branch `ticket/115-export-erase` · worktree `/root/foa-wt/115b` (cut from `foa/M0` 442dd99; rebase onto `foa/M5` at build).
Blockers **82** (consent withdrawal for a child) and **115a** (requests, queue, transitions). Through them it needs 114 (inventory with `subject` + `onExpiry` + floors, legal holds), 63a (storage port, `file_asset`), 61a (jobs/outbox), 64 (consent withdrawal), 60 (step-up), 62 (settings) and 69 (templates).
Sibling **115a** owns filing, the queue, assignment, notes, reject, correction, the role, both tables and the transition table.
**Head start (phase A):** pure core in `src/server/privacy/subject-data/domain/` (see the end).

## Scope
**In (115b):**
- An **access** request produces a complete export of the subject's data (`data.json` + the subject's own uploads) as a ZIP in the private bucket, delivered through a **signed link** that expires.
- An **erasure** request is previewed (per table: delete / anonymise / retain with basis and until), then executed as an idempotent job. It withdraws consents, deletes or anonymises per the inventory, keeps financial records under their floor, writes an `erasure_record`, and completes the request as `completed` or `partially_completed`, listing the retained categories.

New pieces: `file_asset_purpose` + `privacy_export` (H47), `erasure_record`, columns on `privacy_request` (`export_file_asset_id`, `export_ready_at`, `export_link_expires_at`, `retained` jsonb, `erasure_plan_fingerprint`), settings `privacy.exportLinkHours` (72) and `privacy.exportRetentionDays` (7), jobs `privacy.buildExport` and `privacy.executeErasure`, event `privacy_export.ready`, the export link on `/dashboard/privacy/[id]`, and erasure preview + execute on `/admin/privacy/requests/[id]`.
**Out:** filing, the queue and notes (115a). Retention sweeps (114). Breach notices (116b). Consumers of `consent.withdrawn` (#103/#104/#126/#131). Deleting `audit_log` rows (owner superuser path, HR-30). Restoring erasures after a backup restore (owner procedure that reads `erasure_record`, HR-30).

## Acceptance criteria as testable checks
1. **Export is complete** (S1). The world: a member who registered, submitted an entry, donated, received messages and a certificate, plus a second seeded member. `startPrivacyRequest` → `as(officer).buildSubjectExport({ id })` → `h.drain()` → one ZIP in `h.storage`. Its `data.json` holds, for every inventory table with a subject path, exactly the member's rows. The test asserts against a list **generated from the inventory for this world**, not hand-written. Uploads are under `files/`. The request becomes `completed` and `privacy_export.ready` is emitted.
2. **No leakage** (S1). Scanning the whole ZIP finds none of the second member's email, phone, names or ids. The pure guard `assertRowsBelongToSubject` refuses a section with a foreign row (the job fails closed, the request stays `in_progress`).
3. **Encrypted columns** (S1). Raw SQL shows ciphertext. The ZIP shows plaintext. The storage object is private (no public URL), and nothing decrypted is logged or put in the outbox payload.
4. **Signed link expiry** (S1). `getPrivacyExportLink({ id })` works for the requester (or the guardian who filed) until `ready_at + 72 h`, then returns `link_expired` (fake clock). Each URL is the 5-minute presigned GET from 63a. After `privacy.exportRetentionDays` the retention policy `privacyExports` deletes the object and the `file_asset`, and the link returns `export_deleted`. Another member and the officer get `forbidden` (staff never download a subject's export).
5. **Erasure preview** (S1). `previewErasure({ id })` lists per table: `delete` (e.g. message deliveries, entry originals), `anonymise` (profile PII columns), and `retain` with basis + until (donations, receipts, ledger, payments: `legal_obligation`, until the 8-FY floor; consent events and audit: append-only). It writes nothing.
6. **Erasure execute** (S1, step-up). `executeErasure({ id, fingerprint })` → drain gives:
   - profile PII null or tombstoned, entry originals deleted from the storage fake;
   - each given consent withdrawn (outbox `consent.withdrawn`, via 64/82);
   - donation rows and donor contact kept until the floor;
   - one `erasure_record` row (subject kind + id, request id, time);
   - the request `partially_completed` with `retained` = the preview's retained categories.
   Running execute again changes nothing (no new withdrawals, deletions or record). A fingerprint differing from the current plan → `plan_changed`, nothing done.
7. **Legal hold wins** (S1). With an active `legal_hold` on the subject, the preview shows every category `retain` (basis `legal_hold`), and execute withdraws consents only and completes `partially_completed`.
8. **Authorization, every new use case** (S1). Officer: `buildSubjectExport`, `previewErasure`, `executeErasure` (+ step-up: without it `step_up_required`). `staff_admin`, `super_admin` and a member are refused. Requester (or the filing guardian): `getPrivacyExportLink`. Another member is refused. A refusal writes nothing. Jobs run as system worker only.
9. **Inventory** (Vitest): `privacy_request.retained` (no PD: categories only), `erasure_record.subject_id` (non-personal id), and the export `file_asset` rows under policy `privacyExports`.
10. **Pages, axe clean light + dark** (S2, written, **Not run**): the export panel on `/dashboard/privacy/[id]` and the erasure panel on `/admin/privacy/requests/[id]`, in `tests/e2e/115-privacy-export-erase.spec.ts`.

## Files
- **Have (head start):** `src/server/privacy/subject-data/domain/{erasure-plan,export-link}.ts` + tests.
- **New:**
  - code: `src/server/privacy/subject-data/{subjects,export,erasure,jobs,use-cases,policy}.ts` + Seam 1 tests, `src/server/privacy/subject-data/zip.ts` (see Design);
  - schema and migrations: `src/server/db/schema/privacy-erasure.ts` (`erasure_record`), custom migration `115_pre_enum_file_purpose_privacy_export` (one `ALTER TYPE … ADD VALUE`, not used in DDL), generated `115_privacy_export_erase` (new columns, `erasure_record`);
  - messages and e2e: `messages/en-IN/{privacyRequests,adminGrievance}.json` (115a's, append keys), `tests/e2e/115-privacy-export-erase.spec.ts`.
- **Touch:** 63a `PURPOSE_RULES` (`privacy_export`: `application/zip`, max 200 MB, owner = requester); 114 policies (+`privacyExports`) and `INVENTORY`; 115a's transitions (`complete`, `complete_with_retained`); 61a job registry (2) and outbox event map; 69 template `privacy_export_ready`; 62 catalogue (2 keys); 59a policy table (4 actions); `app.ts`.
- **Hotspots:** H47 (enum value, own migration), H41/H5 (subject resolvers + anonymisers; every later PD ticket registers), H16 (consent withdrawal API), H9, H8, H7; `drizzle/meta/*` (merge queue). Shares `privacy_request` with 115a, so it rebases after 115a lands.

## Design (codebase-design; BUILD-3 contenders compared in context)
- **(a) Generic engine driven only by inventory entries.** Deep, one place, but inventory `via` paths can't express multi-hop joins (entry → registration → profile → guardian) or files in storage.
- **(b) Per-module `exportSubject` / `eraseSubject` registry**, with the inventory as a coverage check. Each module knows its joins, but erasure rules get copied N times and a module can forget a column.
- **(c) Risk-first two-phase erasure** (persisted plan rows, then execute) with a dry run. Safe, but a plan table goes stale and adds PD (row ids per subject) to keep.
- **Chosen: (a)'s decisions + (b)'s row finding + (c)'s approval without a plan table.**
  - Each module registers a small **subject resolver** per table: `rowsFor(tx, subject) → { id, floorLapsesAt }[]`, plus `files(tx, subject)`. The coverage test fails if an inventory table with a subject path has none.
  - The **pure `planErasure`** decides every row from the inventory entries alone: delete / anonymise patch / retain with reason (`floor`, `append_only`, `legal_hold`). The **plan fingerprint** (actions + columns + retained categories, never ids or counts) is shown at preview and must match at execute. So the officer approves what runs, and a schema or inventory change in between is refused.
  - Export uses the same resolvers. Encrypted columns decrypt through #58's column type inside the job only. `assertRowsBelongToSubject` re-checks every row before packing.
- **ZIP:** a ~100-line **store-only writer** (CRC-32 from `node:zlib` `crc32`), not a new dependency. Uploads are already-compressed images/PDFs, JSON is small, and it avoids H29 (`package.json` serialize) and supply-chain surface. Tested by reading back its central directory. Fallback: `fflate` exact pin if a contender needs streaming.
- **Order inside `executeErasure`:** withdraw consents (outbox), then delete storage objects (idempotent; a missing key is fine), then delete/anonymise rows, then `erasure_record` + request transition, all in one DB transaction after the storage step. A retry re-plans (already-erased rows are gone, so it's a no-op).

Reversible defaults (write them in the PR):
- **Who downloads.** Only the requester (or the filing guardian) downloads; staff never do.
- **Export lifetime.** Link 72 h, object kept 7 d.
- **Finish and record.** Export completes the request as soon as the ZIP is stored. `erasure_record` keeps ids only.
- **Teen erasure.** Erasure of a teen's own login account is filed by the guardian (115a) and erases the user's profile-linked data too.

## Interface needs (code against these; rename to what landed)
```ts
// 115a
privacyRequest: { id; reference; type; status; relation; subjectKind: "user" | "participant_profile"; subjectId; requestedByUserId; assignedToUserId };
decideRequestTransition({ from, event: "complete" | "complete_with_retained", type }); privacyRequestAuditSnapshot(row)
// 114
INVENTORY: InventoryEntry[]  // { table, column, category, subject: { kind, via }, retention: { policy, basis }, onExpiry }
floorLapsesAt(anchor: Date, floor: LegalFloor): Date; RETENTION_POLICIES[key].floor; activeHoldsFor(db, subjects: SubjectRef[]): Promise<ActiveLegalHold[]>
// 63a
ObjectStorage.put?(i: { bucket; key; bytes: Uint8Array; contentType }) // add to the port if 63a lacks a server-side put
createFileAsset(tx, ctx, { ownerUserId; purpose: "privacy_export"; contentType: "application/zip"; sizeBytes; status: "clean" }): Promise<{ id; storageKey }>;
getFileDownloadUrl({ fileId }): Promise<{ ok: true; url; expiresAt } | { ok: false; reason }>; h.storage
// 64 / 82
withdrawAllConsents(tx: AppDb, ctx: UseCaseContext, subject: { type: "user" | "participant_profile"; id: string }): Promise<{ withdrawn: number }>; // one appendConsentEvent per given purpose
// 61a: defineJob({ name: "privacy.buildExport" | "privacy.executeErasure", run(deps, { requestId }) }); enqueue(tx, name, payload, { singletonKey: requestId }); h.drain()
// 60: checkStepUp(ctx): { ok: true } | { ok: false; error: "step_up_required" }; h.stepUp(actor)
// 62: readSetting(db, "privacy.exportLinkHours" | "privacy.exportRetentionDays")
// 69: template privacy_export_ready (email + in-app; link to /dashboard/privacy/[id], never the signed URL)
```
Use cases: `buildSubjectExport`, `getPrivacyExportLink`, `previewErasure`, `executeErasure`. Jobs: `privacy.buildExport`, `privacy.executeErasure`.

## Residue
- **HR-30:** counsel: erasure exceptions list, audit retention vs erasure, teen erasure via guardian.
- **HR-31 / HR-47:** financial floor 8 years after FY end, export retention 7 d.
- **HR-13:** production R2 bucket. Until then production storage refuses, so export fails closed.
- **HR-10:** redeploy the worker with the two jobs.
- **HR-50:** `privacy_export_ready` copy.
- **Owner procedure:** replay `erasure_record` after a backup restore (HR-30).
- **Not run:** Seam 2, R2 contract.

## Test plan
- **Pure (done in phase A):** `erasure-plan.test.ts` (delete / anonymise / floor / append-only / hold; mixed tables; fingerprint stable across counts and ids, changes with actions), `export-link.test.ts`.
- **Seam 1:** `export.test.ts` (ACs 1–4), `erasure.test.ts` (5–7), `authz.test.ts` (8), on the 114 inventory test (9). Uses `createHarness()`, real migrations, `FakeClock`, `FakeStorage`, drain, 81a/82/77a/85/106a seed builders for the world.
- **Seam 2 (Not run):** `tests/e2e/115-privacy-export-erase.spec.ts`.

## Slices
1. **Subject resolvers + export ZIP + signed link** (ACs 1–4, 9 part): resolvers, `zip.ts`, job, purpose migration, settings. Test `src/server/privacy/subject-data/export.test.ts`.
2. **Erasure preview from the inventory** (5, 7 preview). Test `src/server/privacy/subject-data/erasure-preview.test.ts`.
3. **Erasure execute: consents, storage, rows, record, idempotent** (6, 7). Test `src/server/privacy/subject-data/erasure.test.ts`.
4. **Authorization + step-up across all four use cases** (8). Test `src/server/privacy/subject-data/authz.test.ts`.
5. **Pages + Seam 2** (10). `tests/e2e/115-privacy-export-erase.spec.ts` (written, Not run) + build gate.

## Head start (phase A, on `ticket/115-export-erase`, cut from `foa/M0`, no PR)
`src/server/privacy/subject-data/domain/` (pure, 14 Vitest cases):
- `erasure-plan.ts`: `planErasure({ now, onLegalHold, entries: ErasureEntry[], subjectRows: { table, rows: { id, floorLapsesAt }[] }[] })` → `{ tables: { table, deleteRowIds, anonymise: { rowIds, patch }[], retained }[], retained: RetainedCategory[], outcome: "completed" | "partially_completed", fingerprint }`. `ErasureEntry` is a structural subset of 114's `InventoryEntry` (pass `INVENTORY` as is); `ERASED` = 114's `TOMBSTONE` (import 114's once on trunk). Throws for a table with rows but no inventory entries. The caller computes `floorLapsesAt` with 114's `floorLapsesAt(anchor, policy.floor)`.
- `export-link.ts`: `exportLifetimes(readyAt, { linkHours, retentionDays })` → `{ linkExpiresAt, deleteAt }` (link never outlives the file), `decideExportLink({ now, export: { state: "none" } | { state: "ready", fileId, linkExpiresAt } | { state: "deleted" } })` → `{ ok, fileId } | export_not_ready | link_expired | export_deleted`.
- Not built in phase A: `zip.ts` (store-only writer) and `assertRowsBelongToSubject` (slice 1).
