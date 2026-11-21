# 99a: results release: prepare, two-person approval with step-up, scheduled publish (#99, M4)

Branch `ticket/99-release` · worktree `/root/foa-wt/99a` · base `foa/M0` 442dd99 (rebase onto `foa/M4` at build) · L · risk (auth: two-person
rule, step-up, embargo; minors: prize messages) · no conflict key · blocked by 83a, 83b, 97 (and through them 60, 61a, 69, 72, 81b, 82).
Prepped by foa-p99 on 2026-11-21 against `foa/ticket/57-harness` 0569f4f (PR #140, may still change).
**Head start on the branch:** `48176b9 M4 #99: Add results release domain core`: `src/server/modules/results/domain/` (pure, 108 Vitest cases). Build slices import it as is.

## Scope
- **In (99a):** enum `results_release_status` (full set, M34-2) and table `results_release`; the snapshot of the locked final round
  (content + sha256 hash); use cases `listResultsWork`, `getResultsRelease`, `prepareResults`, `updateResultsDraft`, `submitResults`,
  `approveResults` (step-up), `rejectResults`, `cancelScheduledResults` (step-up), system `publishDueResults`; the publish job as an
  outbox row with `availableAt = publishAt`; the inline publish-now path when `publishAt <= now` at approval (M34-3); events
  `results.approval_requested`, `results.published` {competitionId, releaseId, publishedAt}, `results.prize_awarded` (one per
  award line); #69 route rows + templates + the `results_approvers` audience; `can()` rules; audit rows; preview seed; admin pages
  `/admin/results`, `/admin/results/[competitionCode]`, `/admin/results/[competitionCode]/approve`; namespace `adminResults`.
- **Out → 99b:** the public read model (`getPublicResults`), credits (#82's resolver), `/competitions/[slug]/results`, the link
  from the competition page (H25), cache tags and lifetimes, Lighthouse, namespace `results`.
- **Out, later:** certificates (100a consumes `results.published`); correcting published results (a new version flow; none now);
  the competition status machine (99a does **not** add `results_published` to `competition_status`: avoids X9 and F2; consumers
  use the event); #94's return window just consumes the event it already declared (M34-6).

## Acceptance criteria (testable)
1. **Prepare from the locked final round** (S1). `as(cm).prepareResults({competitionId})` → `draft`, version 1, snapshot = the final
   round's award lines (outcome ≠ none) in canonical order, `snapshotHash` = `snapshotHash(lines)`, `preparedBy` = cm. Refused
   `round_not_locked` (final round open), `no_final_round`, `release_in_progress` (a live release exists; partial unique index
   backs it). After a `rejected` release, prepare makes version 2.
2. **Draft edits** (S1). `updateResultsDraft({releaseId, publishAt, deliveryNote, refresh?})` only in `draft`; `refresh` re-snapshots and
   makes the caller `preparedBy`. `publishAt` in the past → `publish_at_past`; note > 500 chars → `delivery_note_too_long`.
3. **Two-person rule** (S1, ticket AC 1). `submitResults` only by `preparedBy`, needs `publishAt` → `pending_approval`; drain → every
   approver except the preparer gets `results.approval_requested` (email + inbox). `approveResults` by the preparer → `own_results`,
   nothing written. DB `CHECK (approved_by <> prepared_by)` rejects a raw-SQL bypass. Publishing without approval: no use case can
   move `draft`/`pending_approval` to `published`; the job refuses anything not `approved`.
4. **Step-up** (S1, ticket AC 2). A second staff member whose second factor is 10 min 1 s old → #60's `step_up_required`, nothing
   written; at 9 min 59 s → `approved`, `approvedBy`, `approvedAt`, one publish job row with `available_at = publishAt`.
5. **Publishes at the instant, not before** (S1, ticket AC 3). Approved with `publishAt = T`: `h.clock.set(T − 1 s)`, drain → still
   `approved`, no `results.published` row. `h.clock.set(T)`, drain → `published`, `publishedAt = T`, exactly one `results.published`
   event. Drain again → nothing new (idempotent). Approval when `publishAt <= now` publishes in the same transaction.
6. **Stale snapshot** (S1). Snapshot changed by raw SQL after approval → the job sets `rejected` with reason `stale_snapshot`, emits
   nothing, writes an audit row. Same check at approval: hash mismatch → `stale_snapshot`.
7. **Prize messages** (S1, ticket AC 5). On publish, one `results.prize_awarded` per award line (band ≠ null); drain → adult winner
   gets the message with #72's prize text for the band and the delivery note; a minor winner's guardian gets it and the child does
   not (#81b's `guardian_of_participant`); a finalist without a band gets none. Draining twice sends once.
8. **Reject and cancel** (S1). `rejectResults({releaseId, reason})` from `pending_approval` by a non-preparer approver → `rejected`;
   reason 1–500 chars. `cancelScheduledResults` from `approved` before publish (step-up) → `rejected`; its job then does nothing.
9. **Transition table** (unit, done; ticket AC 6). Every ordered pair × cause (preparer, approver, system) in
   `domain/release-status.test.ts`. S1: `rejected` and `published` are terminal through every use case.
10. **Authorization** (S1, ticket AC 8). prepare/update/submit: competition manager of that competition ✓, content manager ✗, manager
    of another competition ✗. approve/reject/cancel: staff admin with step-up ✓, preparer ✗, finance ✗, member ✗. publish: system
    worker ✓, competition manager ✗, visitor ✗. Reads: manager ✓, judge ✗.
11. **Audit** (S1). One `audit_log` row per change: `results.prepared|updated|submitted|approved|rejected|cancelled|published`,
    entity `results_release`, before/after = status, version, publishAt, hash (no names).
12. **Seed** (S1). `seedPreview` twice → same rows: one competition with a published release, one with `pending_approval`.
13. **axe** (S2, Not run): `expectRendersAccessibly` light + dark on the 3 admin pages; `tests/e2e/99-results-admin.spec.ts`.

## Interface needs (code against these; rename to what landed)
```ts
// 57a: Deps { db; clock; email }, UseCaseContext, composeUseCases, createHarness, uuidv7(at), Actor {kind:"system"; process:"worker"}
// 59a: can/authorize(ctx, action, resource?: { scopes: Scope[]; ownerId?: string }) -> { role }  (throws DomainError("forbidden"))
//      recordAudit(tx, ctx, { action; entity: { type; id }; before; after; actorRole }); seed: h.seed.grant(user, grant)
// 60:  policy rule flag `secondFactor: "step-up"` on "results.approve" and "results.cancel"; error code "step_up_required";
//      harness: a staff actor whose session second factor was verified at a given instant (h.signIn + stamp helper)
// 61a: emit(tx, clock, event: DomainEvent, options?: { availableAt?: Date }); handler registry in outbox/events.ts; h.drain()
// 69:  message_route rows + templates (email, in_app); registerAudience(key, (db, { aggregateType, aggregateId }) => Recipient[])
// 72:  AWARD_BANDS: Record<AwardScheme, readonly AwardBand[]>; getCompetitionTerms...(competitionId).awards
//      -> [{ roundKey: "foa_final"; scheme; bands: [{ band; prize: string | null }] }]
// 81b: audience "guardian_of_participant" (adult -> self; minor -> active guardians; none -> suppressed)
// 97 (+98 when merged): the final round and its tagged outcomes
type RoundOutcome = "winner" | "runner_up" | "finalist" | "special_mention" | "none";
finalRound(db: AppDb, competitionId: string): Promise<{ id: string; status: "draft" | "open" | "locked" | "cancelled" } | null>;
roundAwardLines(db: AppDb, roundId: string): Promise<Array<{ entryId: string; entryCode: string; participantProfileId: string;
  discipline: string; ageGroup: string; outcome: RoundOutcome; awardPosition: 1 | 2 | 3 | null }>>;
// If 97 exposes only tables, 99a writes these two reads in its own module over 97's schema.
```
**99a provides** (99b, 100a, #94, #119, #120, #134):
```ts
type ResultsPublished = { type: "results.published"; aggregate: { type: "results_release"; id }; payload: { competitionId; releaseId; publishedAt: string } };
publishedRelease(db: AppDb, competitionId: string): Promise<{ id; version; publishedAt: Date; lines: SnapshotLine[] } | null>;
scheduledRelease(db: AppDb, competitionId: string): Promise<{ publishAt: Date } | null>; // approved, not yet published: date only
```

## Files
- **Head start (done):** `src/server/modules/results/domain/{release-status,snapshot,publish-plan,approval,prizes}.ts` + tests.
- **New:** `src/server/db/schema/results.ts`; generated migration `99_results_release`; `src/server/modules/results/{use-cases,reads,
  events,audiences,policy,index}.ts` + Seam 1 tests; `src/server/seed/results.ts`; `src/app/(staff)/admin/results/**` (pages,
  `actions.ts`, `_components/`, `_lib/` action-result mapping + test); `messages/en-IN/adminResults.json`;
  `tests/e2e/99-results-admin.spec.ts`.
- **Shared, one line each:** `schema/index.ts`, `seed/index.ts` (after 97's seeder), `src/server/app.ts` (`resultsUseCases`), the
  `can()` policy table, #61's handler registry (`results.publish_due`), #69's route/template seed + audience registry,
  `src/i18n/messages.ts`, the admin nav (59b), the data inventory (snapshot lines hold entry codes and profile ids, no names).
- **Hotspots:** H30 (`results.published` consumers: #94, 100a register their own), H9, H8, `drizzle/meta/*` (merge queue).

## Schema
`results_release`: id uuidv7, competition_id → competition, source_round_id (uuid, FK to 97's round), version smallint, status,
snapshot jsonb (canonical lines), snapshot_hash char(64), delivery_note text null, publish_at, prepared_by/at, submitted_at,
approved_by/at, rejected_by/at, rejection_reason, published_at. `CHECK (approved_by IS NULL OR approved_by <> prepared_by)`;
unique (competition_id, version); partial unique (competition_id) WHERE status IN ('draft','pending_approval','approved')
(literals from the same CREATE TYPE: F2-safe); index (status, publish_at).

## Design (codebase-design; risk-flagged, 3 compared)
- **A. Snapshot-and-hash release aggregate (chosen).** The release stores the exact award lines that were approved plus their sha256.
  Approval and publish both recompute and compare, so what goes public is byte-for-byte what the second person saw. Interface: one
  aggregate, 8 use cases, each a thin adapter (`can()` → load `FOR UPDATE` → pure decide → write → audit → emit). Every rule (table,
  two-person, publish timing, stale hash, prize lines) sits in `domain/` as pure functions: deep, and tested without a DB.
- **B. Live-derived results** (release pins only the round lock and the time). Smaller table, but a re-tag after approval changes what
  publishes without a second look: breaks the two-person rule in spirit. Rejected.
- **C. pg-boss `sendAfter` job.** Times with DB `now()`, so the fake clock can't drive it (61a design note). Rejected for the outbox
  row with `availableAt` (61a's one-off delayed action).
- **Decisions (reversible):** `rejected` and `published` are terminal; a fix after rejection is a new version. Only the preparer
  submits; refreshing re-assigns `preparedBy`. Rejecting needs no step-up; approving and cancelling do. Staff admin and super admin
  approve globally; a competition manager approves only a competition they manage and didn't prepare. The delivery note
  ("how they will receive it") is hashed with the lines. Times shown and entered in IST (70a's `ist.ts`).

## Residue
- **HR-17:** FOA names ≥ 2 results approvers with 2FA (R-APPROVERS). **HR-45:** prize/trophy/medal texts and the prize and approval
  message copy (seeded as drafts). **HR-44 + HR-30:** minors in prize messages and the public page (99b). **HR-14:** SMS for prize
  messages stays off until DLT. **HR-10:** redeploy `worker-preview` so the publish handler runs on previews (Seam 2 never waits on it:
  publish-now path).

## Test plan
- Unit (done): transition table, canonical order + hash stability, `planPublish` (early / stale / publish / noop), two-person and
  submit guards, prize lines.
- Seam 1 per slice on `createHarness()`: fake clock for step-up age and the publish instant, `h.drain()`, email fake, rows via `h.db`.
- Seam 2: `tests/e2e/99-results-admin.spec.ts`, written, **Not run** (no Postgres here; previews fail at `pnpm db:migrate`).

## Slices (L → 4; each one behaviour, one test file)
1. Schema + migration + `prepareResults`/`updateResultsDraft`/reads, audit, authz: `results/prepare.test.ts` (AC 1, 2, 10, 11).
2. Submit, approve with step-up, reject, two-person rule, approver messages: `results/approval.test.ts` (AC 3, 4, 8, 10).
3. Publish job, inline publish-now, stale hash, `results.published`, prize messages + guardian routing: `results/publish.test.ts` (AC 5, 6, 7, 9).
4. Seed, 3 admin pages, `adminResults`, Seam 2 spec: `src/server/seed/results.test.ts` + `tests/e2e/99-results-admin.spec.ts` (AC 12, 13).
