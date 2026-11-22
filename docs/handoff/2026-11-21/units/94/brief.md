# Brief 94: Verify physical artwork and record its custody (unit 94, issue #94, M3)

| | |
|---|---|
| Blocked by | 93 (and through it 92, 84b, 85b, #59 #60 #61 #62 #63 #69 #73 #74/#75 #81); extra: #85 (display copy for the side-by-side), 99a only as the real emitter of `results.published` |
| Size, flags | L · A (private photos, signed URLs) · K (guardians' return requests) · PD (photos, return requester, hand-over name) · F2 (one `file_asset_purpose` value, own migration) |
| Keys / order | H15 (artwork enum + transitions, **serial after 93**), H21 `file_asset_purpose`; merges before 95c/97 (they read readiness) |
| Branch | `ticket/94-verify-physical-artwork-and-record` → PR into `M3`, `M3 #94: Verify physical artwork and record its custody` |
| Head start | `c8d3522`: `src/server/modules/physical-artwork/domain/custody.ts` + test (120 cases). Rebase onto `foa/M3` (with 93) at build start |

## Scope
In: verify a received work (checklist, condition, dimensions, material, ≥2 condition photos, storage location);
raise/resolve a discrepancy (blocks verify and judging); custody log (append-only) + current storage location; exhibit,
store, move; family/coordinator return request inside the window; automatic retain at window close; staff record a
return; the `physically ready for judging` API; signed-URL photo reads; pages; seed. No siblings: 94 owns all of #94.
Out: request/dispatch/receive (93); auction states (M8, never in DDL); discrepancy reply by the sender with documents
(old spec; not in the ticket); withdrawing a return request; label/QR PDFs; admin home tile (#117); messages beyond the
event rows below (templates only if #69's route rows need them; see Residue).

## Acceptance criteria (numbered, with seam)
1. **Verify** (S1). `as(verifier).verifyArtwork({artworkId, checklist, condition, conditionNotes, widthMm, heightMm,
   depthMm, material, storageLocation, photos:[{fileId, kind}]})` on `received` → `verified`; one `artwork_verification`
   row, N `artwork_photo` rows, `physical_artwork.storage_location` set, custody `stored`, one audit row, one
   `artwork.verified` outbox row. Refused, writing nothing: <2 photos, no front+back, a photo `scanning`/`quarantined`
   (`photo_not_ready`), bad dimensions, no material, damaged without notes, failed checklist (`checklist_failed` + items),
   a photo that isn't `artwork_condition_photo` or belongs to another artwork (`invalid_photo`). Rules: `custody.ts` ✔.
2. **Discrepancy** (S1). `raiseArtworkDiscrepancy({artworkId, reason, notes})` → `discrepancy`, open row; then verify →
   `discrepancy_open`, readiness false; `resolveArtworkDiscrepancy({artworkId, resolution})` → `received`, row resolved
   (by/at/resolution); verify then succeeds. A second open row is impossible (partial unique index, no enum literal in
   the predicate). `listArtworkDiscrepancies({competitionId?})` = open ones, oldest first.
3. **Return request** (S1). Test emits `results.published {competitionId, releaseId, publishedAt: T}` and drains →
   `artwork_results_window` row (closes T + `artwork.returnWindowDays`). Guardian of the minor creator:
   `requestArtworkReturn({artworkId})` at T+29d ✓ (row open, `artwork.return_requested`); at T+30d → `return_window_closed`;
   before the event or before T → `return_window_not_open`; again → `return_already_requested`.
4. **Retain at close** (S1). The consumer schedules `artwork.retain_unrequested` with `availableAt = closesAt` (61a's
   one-off future action). `clock.set(T+30d)`, drain → every verified/on_exhibition work of that competition with no open
   request → `retained` (system actor in audit, custody `retained`, `retainedAt` set); the requested one stays; received/
   discrepancy untouched; draining twice changes nothing. A second `results.published` for the same competition keeps the
   first window (idempotent).
5. **Readiness** (S1 + unit). `isPhysicallyReadyForJudging(db, entryId)` and set-based
   `physicallyReadyEntryIds(db, {competitionId})` (or an SQL condition for 95c/97 pool queries): truth table over all 8
   statuses + no artwork row → only verified, on_exhibition, retained. Pure part ✔.
6. **Signed photo URLs** (S1). `getArtworkPhotoUrl({photoId})`: verifier ✓, competition manager of that competition ✓,
   staff_admin ✓; participant ✗, guardian ✗, coordinator ✗, visitor ✗. `h.storage.get(url)` works at +299 s, refused after
   `clock.advance(300 s + 1 ms)`. The URL has no participant id, entry/registration code or name (key is
   `<prefix>artwork_condition_photo/<uuidv7>`). No public route serves these files.
7. **Custody moves and return** (S1). `exhibitArtwork`, `storeArtwork` (retained work comes back `retained`),
   `moveArtwork` (status unchanged), `retainArtwork` (manual, after close), `recordArtworkReturn({artworkId, via})`: needs
   an open request for verified/on_exhibition (`no_return_request`), none for received/discrepancy; marks the request
   `fulfilled`; `artwork.returned`. `getArtworkCustody({artworkId})` lists the log oldest first with current location.
8. **Transition table** (unit). `custody.test.ts` ✔ (8 statuses × 9 commands). At build: append `CUSTODY_TRANSITIONS`
   (12 rows) to 93's `ARTWORK_TRANSITIONS` and extend 93's `status.test.ts` so every unlisted pair stays refused.
9. **Append-only custody** (S1). UPDATE/DELETE/TRUNCATE on `artwork_custody_event` raise (trigger, like `audit_log`).
10. **Authz** (S1), every new use case: verify/raise/photo URL/discrepancy list → `foa_verifier` ✓ (with 2FA), coordinator
    ✗, participant ✗, no 2FA → `second_factor_required`; resolve/exhibit/store/move/retain/return → verifier or that
    competition's manager ✓, coordinator ✗; `requestArtworkReturn` → adult creator, the minor's guardian, the school
    registration's coordinator ✓, another guardian/another institution's coordinator ✗; retain job → system only.
11. **axe** (S2, written, not run here). `tests/e2e/94-artwork-custody.spec.ts`: verify page, discrepancy queue, extended
    detail page, return-request panel; `expectRendersAccessibly` + one `.dark` run.
12. **Seed** (S1 `seed.test.ts`). One verified work with 2 clean photos and a custody trail, one in `discrepancy`, one
    `received` ready to verify, one with an open return request (window open); idempotent.

## Files
New (parallel-safe): `src/server/modules/physical-artwork/{domain/custody.ts ✔, use-cases/{verify,discrepancy,custody,
return,readiness,photos}.ts, handlers/{results-published,retain-unrequested}.ts, *.test.ts}`,
`src/server/db/schema/artwork-custody.ts`, `src/server/seed/artwork-custody.ts`, `src/app/admin/artwork/[artworkCode]/
verify/{page.tsx,_components/*}`, `src/app/admin/artwork/discrepancies/page.tsx`, `messages/en-IN/artworkCustody.json`,
`tests/e2e/94-artwork-custody.spec.ts`, migrations `NNNN_94_pre_file_purpose.sql` (generated, only `ADD VALUE
'artwork_condition_photo'`), `NNNN_94_artwork_custody.sql` (generated), `NNNN_94_custody_append_only.sql` (`--custom`).
Hotspots: H15 93's `status.ts` (+ test) and `physical_artwork` (add `storage_location text null`, `retained_at`) and
`markArtworkReceived` (append custody `received` in the same tx); H21 file purpose registry + Files read rule; H9 events →
templates; H7 settings (`artwork.returnWindowDays` 30, 1–365); H8 `can()` rules; H5 data inventory; H26/H27 dashboard and
institution artwork pages ("Ask for it back"); `/admin/artwork/[artworkCode]` (93's page: custody log + actions); H1/H6
barrels; H3 `messages.ts`; `src/server/app.ts` (one line, or 93's module object extended).

## Design (risk-flagged; codebase-design vocabulary, 3 interfaces)
- **A. Status-centric, thin side tables.** Discrepancy and return live in `physical_artwork.status`; side tables hold the
  records. Readiness is one indexed predicate (`status IN (...)`), so 95c/97/98 pool queries stay set-based. Rules end up
  spread across ~10 use cases.
- **B. Custody-event-first.** Status is folded from append-only events. #131's auction states would just be more events,
  but readiness needs a fold or a projection (two sources of truth, N+1 risk in pool queries) and every write is harder.
- **C. A + one pure decision core (chosen, built).** `decideCustody(state, command, now)` covers 9 commands; use cases are
  lock (`FOR UPDATE` on the artwork) → `can()` → load state → decide → write status + record + custody row + audit + `emit`
  in one tx. **Leverage:** one interface, 9 behaviours, tested as a table for pennies. **Locality:** window, retain,
  photo and return rules sit in one file. It matches 92's `decide` and 93's `decide`. The custody log is an audit
  trail, not the source of status. **Deletion test:** remove `decideCustody` and the guards scatter across 9 use cases
  and 2 handlers. #131 adds `list_for_auction`/`sold` commands outside the enum (its own lot table), so C costs it nothing.
- Tables: `artwork_verification` (artwork_id unique FK, verified_by, verified_at, 4 checklist bools, condition enum
  `artwork_condition`, condition_notes, width_mm/height_mm int, depth_mm null, material; CHECKs on ranges);
  `artwork_photo` (id, artwork_id, file_asset_id unique, kind enum `artwork_photo_kind`, created_by/at);
  `artwork_discrepancy` (id, artwork_id, reason text (zod registry, like 92), notes, raised_by/at, resolved_by/at null,
  resolution null; unique (artwork_id) WHERE resolved_at IS NULL); `artwork_custody_event` (id, artwork_id, kind enum
  `artwork_custody_kind` received|stored|exhibited|moved|retained|returned, location null, actor_user_id null = system, at;
  trigger); `artwork_return_request` (artwork_id unique, requested_by, requested_at, status text open|fulfilled, fulfilled_at,
  via jsonb null); `artwork_results_window` (competition_id pk, release_id, results_published_at, closes_at). New enum
  types are created with their values in one migration (fine); only `file_asset_purpose` gets `ADD VALUE` (own migration).
- Photo reads: Files keeps the scan gate and presign; this module adds a read rule for `artwork_condition_photo` (staff
  roles above) through Files' rule registry, or calls a Files-internal `signedDownloadUrl(deps, fileId)` after its own
  `can()`. The verifier uploads via Files' `requestUpload` (purpose `artwork_condition_photo`, image/jpeg|png|heic,
  20 MB, `capture="environment"`).

## Interface needs (code against these; adopt the real names found on M3)
```ts
// 93 physical-artwork
import { PHYSICAL_ARTWORK_STATUSES, type PhysicalArtworkStatus, ARTWORK_TRANSITIONS } from "./domain/status";
export const physicalArtwork: PgTable<{ id; entryId; competitionId; artworkCode; status; institutionRegistrationId: string | null;
  registrationId; receivedAt: Date | null }>;            // 94 adds storageLocation, retainedAt
export function markArtworkReceived(ctx: UseCaseContext, i: { artworkId: string }): Promise<void>;  // 94 appends custody row
// #59 / #60 / #92
export function authorize(ctx: UseCaseContext, action: Action, resource?: { scopes?: Scope[]; ownerId?: string }): Promise<{ role: Role | null }>;
export function recordAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entity: { type: "physical_artwork"; id: string };
  before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
// roles used: "foa_verifier" (92), "competition_manager" @ competition, "staff_admin"; DomainError("second_factor_required")
// #61
export function emit(tx: AppDb, clock: Clock, e: DomainEvent, o?: { availableAt?: Date }): Promise<void>;
// events: artwork.verified|discrepancy_raised|discrepancy_resolved|exhibited|stored|retained|return_requested|returned,
// artwork.retain_unrequested {competitionId}; consumed: results.published {competitionId, releaseId, publishedAt}
// #62
export function getSetting(db: AppDb, key: "artwork.returnWindowDays"): Promise<number>;
// #63 files
export const fileAsset: PgTable<{ id; ownerUserId; purpose; status: "pending_upload"|"uploaded"|"scanning"|"clean"|"quarantined"|"rejected"|"deleted" }>;
export function signedDownloadUrl(deps: Deps, fileId: string): Promise<{ url: string; expiresAt: Date }>; // gate + 300 s presign
// #85 derivatives: displayUrl(deps, entryFileId): Promise<string | null>   (side-by-side; null → "no preview yet")
// #81 / #74-#75 relations
export function isGuardianOf(db: AppDb, userId: string, participantId: string): Promise<boolean>;
export function isCoordinatorOf(db: AppDb, userId: string, institutionRegistrationId: string): Promise<boolean>;
```

## Residue
HR-17 (who holds `foa_verifier`, 2FA). HR-40 append (M3 defaults chosen here: 2 photos incl. front + back, 30-day window
from results, automatic retain at close, verified work returned only on request, requesters = adult creator / guardian /
school coordinator, resolve → received → re-verify, notes required for damaged, competition manager not a verifier).
HR-31 append (condition photos may show names, return requester, hand-over recipient name, courier tracking). HR-10 (the
results consumer and retain handler need `worker-preview` rebuilt from M3 on previews). HR-14 only if return messages get
SMS routes (default email + in-app).

## Test plan
Unit: `custody.test.ts` ✔ (120); 93's `status.test.ts` + rows. Seam 1 (`createHarness`, PGlite, fake clock, `drain()`,
storage/scanner fakes): `verify.test.ts`, `discrepancy.test.ts`, `custody-moves.test.ts`, `return-window.test.ts`,
`photos.test.ts`, `readiness.test.ts`, `authz.test.ts` (matrix over every new use case), `seed.test.ts`. Seam 2:
`tests/e2e/94-artwork-custody.spec.ts` (Not run: no Postgres server here; previews fail at `db:migrate`). Gates per rules.md.

## Slices (ordered)
1. **Verify, photos, readiness**: AC 1, 5, 6, 8, 9, 10 (those rows). Purpose migration, schema + trigger, custody rows,
   `verifyArtwork`, `getArtworkPhotoUrl`, readiness API, table rows into 93's status. S1 `verify.test.ts`, `photos.test.ts`,
   `readiness.test.ts`.
2. **Discrepancies**: AC 2, 10. Raise, resolve, queue. S1 `discrepancy.test.ts`.
3. **Custody moves and return**: AC 7, 10. Exhibit, store, move, manual retain, record return, custody read. S1
   `custody-moves.test.ts`.
4. **Return window and retain job**: AC 3, 4, 10. `results.published` consumer, window table, `requestArtworkReturn`,
   retain handler. S1 `return-window.test.ts`.
5. **Pages and seed**: AC 11, 12. Verify page (display copy side by side), discrepancy queue, detail custody log +
   actions, "Ask for it back" panels, seed, e2e spec. S1 `seed.test.ts`; S2 spec written.
