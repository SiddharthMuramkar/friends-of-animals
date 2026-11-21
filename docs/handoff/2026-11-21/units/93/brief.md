# Brief 93: Request, dispatch and receive physical artwork (unit 93, issue #93, M3)

| | |
|---|---|
| Blocked by | 92, 84b (and through them 85b, 89b, #61 #62 #69 #70 #73 #74/#75 #81; #59 #60 for `can()` and staff 2FA) |
| Size, flags | L · risk (minors: guardian routing; PD: dispatcher identity; F2: full enum up front; worker skew: reminder + ack) |
| Keys / order | none held. H15 (artwork enum + transition table) is **owned here**; #94 extends it serially |
| Branch | `ticket/93-request-dispatch-and-receive-physical` → PR into `M3`, `M3 #93: Request, dispatch and receive physical artwork` |
| Head start | `a18dd4f` on the branch: `src/server/modules/physical-artwork/domain/{status,decide,schedule,code}.ts` + tests (180). Rebase onto `foa/M3` when the build starts |

## Scope
In: the Physical artwork module's first slice. Full `physical_artwork_status` enum (8 values, M34-2); `physical_artwork`
table; `requestPhysicalArtwork` (bulk, competition manager); the `artwork.requested` notice (Artwork ID, packaging
instructions with shipping payer, FOA address, IST deadline) to coordinators / adult participant / guardian;
`recordArtworkDispatch` (courier + tracking, one or more artworks of one sender); `markArtworkReceived` + automatic
acknowledgement; the dispatch-deadline reminder; settings; audit; 4 pages; seed. No siblings: 93 owns all of #93.
Out: verification, condition photos, discrepancies, storage, custody log, return/retain (#94); readiness API (#94);
courier integrations (ticket); cancelling a request or extending a deadline (no `cancelled` value in M34-2's list; follow-up
if FOA asks); automatic request on verification (old spec; the ticket says FOA picks entries); labels/QR PDF; admin home
tile (#117); auction states (M8, never in DDL).

## Acceptance criteria (numbered, with seam)
1. **Request** (S1). `as(competitionManager).requestPhysicalArtwork({competitionId, entryIds:[3 foa_verified]})` → 3 rows
   `requested`, codes unique and matching `^[A-Z]{3,6}\d{2}-A-[0-9A-HJKMNP-TV-Z]{6}$` with the competition's code as prefix;
   `dispatchDeadline` = end of the IST day `artwork.dispatchDays` (14) after the request; instructions, payer and address
   snapshotted. Refused, writing nothing (all-or-nothing): entry not `foa_verified` → `entry_not_verified`; competition
   without the physical rule → `physical_not_required`; entry already has an artwork → `already_requested`; entry of another
   competition → `not_found`; production with a placeholder address → `facility_address_not_configured`.
2. **Told what, where, by when** (S1, drain). School-route entry → every coordinator of its institution registration gets
   `artwork_requested` (email fake + inbox) with code, entry code, instructions, "shipping paid by FOA/you", address and the
   IST deadline (`longDateTime`); adult individual → the participant; minor individual (under 13 and 13–17) → the guardian,
   never the child. One outbox row `artwork.requested` per artwork; drain twice = one message.
3. **Dispatch** (S1). `recordArtworkDispatch({artworkIds, courierName, trackingNumber})` by the responsible sender →
   `dispatched`, courier trimmed, tracking normalised (spaces removed, upper case), `dispatchedBy/At` from the clock, one
   audit row per artwork, `artwork.dispatched` event (`late: true` after the deadline; late dispatch is allowed). Mixed
   senders, a non-`requested` artwork or bad input → refused for all (`not_requested`, `already_dispatched`,
   `courier_name_required|too_long`, `tracking_number_required|invalid`, `mixed_senders`).
4. **Receive + acknowledgement** (S1, drain). `markArtworkReceived({artworkId})` by staff → `received`, `receivedBy/At`;
   drain → `artwork_received` acknowledgement to the dispatcher (or, if dispatch was never recorded, to the request's
   recipients). From `requested` it is allowed and flagged `dispatchRecorded: false` (shown "dispatch not recorded").
   Again → `already_received`.
5. **Reminder** (S1, fake clock). Status `requested` at deadline − `artwork.dispatchReminderLeadHours` (72) → drain → one
   `artwork_dispatch_reminder` to the request's recipients (drain twice = one). Dispatched before that instant → none.
   Received (never dispatched) → none. When the lead time is longer than the window, no reminder is scheduled.
6. **Transition table** (unit, `domain/status.test.ts`). All 8×8 pairs: allowed `requested→dispatched` (sender),
   `dispatched→received` (staff), `requested→received` (staff); everything else refused, incl. `received→dispatched`,
   `dispatched→requested`, self-loops and every #94 status (rows #94 adds later).
7. **Audit** (S1). Request, dispatch, receive each write one audit row per artwork (actor, role, before/after status).
8. **Authz** (S1), every new use case. Request: competition manager (scoped, 2FA) ✓; coordinator, foa_verifier, manager of
   another competition ✗. Dispatch: that registration's coordinator ✓, the adult participant ✓, the minor's guardian ✓, the
   13–17 participant ✓; another institution's coordinator, another family's guardian, staff ✗ (`not_found` for ids outside
   scope). Receive: staff_admin / competition manager / foa_verifier with 2FA ✓, without 2FA `second_factor_required`,
   coordinator and participant ✗. Lists: each actor sees only its own artworks. Reminder handler: system actor only.
9. **Pages, axe, seed** (S2 written, not run; S1 `seed.test.ts`). `/admin/artwork`, `/admin/artwork/[artworkCode]`,
   `/institution/artwork`, `/dashboard/artwork`, `expectRendersAccessibly` + one `.dark` run each, in
   `tests/e2e/93-physical-artwork.spec.ts`. Seed: on the seeded competition, artworks in `requested` (one overdue),
   `dispatched` and `received`, school route and individual route (one minor).

## Files
New (parallel-safe): `src/server/modules/physical-artwork/{domain/{status,decide,schedule,code}.ts ✔ + tests,
use-cases/*.ts, index.ts, *.test.ts}`, `src/server/db/schema/physical-artwork.ts`, `src/server/seed/physical-artwork.ts`,
`src/app/admin/artwork/{page.tsx,[artworkCode]/page.tsx,_components/*}`, `src/app/institution/artwork/page.tsx`,
`src/app/dashboard/artwork/page.tsx`, `messages/en-IN/{artwork,adminArtwork}.json`, `tests/e2e/93-physical-artwork.spec.ts`,
one generated migration `NNNN_93_physical_artwork.sql`.
Hotspots: H15 (owned), H9 events→templates, H10 reminder registry (84b), H7 settings, H8 `can()` table, H1 schema barrel,
H6 seed barrel, H3 `messages.ts`, H19 `app-routes.ts` + admin/institution/dashboard nav, H26/H27 dashboard + institution
trees, H5 data inventory, `src/server/app.ts` (one line).

## Design (risk-flagged; codebase-design vocabulary)
- **A. Shipment aggregate**: `artwork_shipment` row (sender, courier, tracking) referenced by artworks. Models a school's
  15-work parcel, but adds a second aggregate, a second status question (partial receipt) and a receive-by-shipment
  interface before anyone needs it. #131/#133 shipments are buyer deliveries, not this.
- **B. Thin table + guards in each use case**: export `ARTWORK_TRANSITIONS`, put deadline, lateness, input parsing and
  reminder rules in the use cases and the job handler. Shallow: the deletion test shows nothing lost, rules spread over
  4 callers, and #94 copies them.
- **C. Per-artwork rows + one pure decision module** ← **chosen**. `decideArtwork(state, command, now)` (commands
  `dispatch | receive | remind`) and `decideArtworkRequest(facts)` hold every rule; `dispatchDeadline` /
  `dispatchReminderAt` hold the IST time rules; `artworkCodeFormat` / `normaliseArtworkCode` the code. The table carries
  who may make each move (`by: sender | staff`). Use cases stay thin: `can()`, lock rows `FOR UPDATE`, decide, write
  status + audit + `emit` in one tx. Bulk dispatch = same courier/tracking on N rows in one call (grouping is implicit by
  tracking number; a shipment table can be backfilled later). Leverage: one interface, 4 use cases + 1 handler + the
  table test; locality: deadline/lateness/normalisation live in one file; #94 adds rows and commands to the same shape
  as #92's `decide`.
- Table `physical_artwork`: id uuidv7; `entry_id` unique FK; `competition_id`; `artwork_code` unique; `status`
  `physical_artwork_status` (requested, dispatched, received, discrepancy, verified, on_exhibition, retained, returned;
  default none, no value referenced by any DDL); `institution_registration_id` null; `registration_id`; `requested_by`,
  `requested_at`; `dispatch_deadline`; `packaging_instructions`, `shipping_payer` text (`foa|sender`, zod, not an enum),
  `facility_address` (snapshots); `courier_name`, `tracking_number` (index), `dispatched_by`, `dispatched_at`;
  `received_by`, `received_at`. CHECK `(courier_name IS NULL) = (dispatched_at IS NULL)`. No `storage_location` (#94).
- Settings (#62): `artwork.dispatchDays` (14, 3–60), `artwork.dispatchReminderLeadHours` (72, 1–336),
  `artwork.packagingInstructions`, `artwork.shippingPayer` (`sender`), `org.foaFacilityAddress` (placeholder). The
  request form pre-fills instructions/payer from settings and lets the manager edit them; the row keeps the snapshot.
- Sender = institution route → the registration's coordinators; individual → the participant (teen may act) or guardian.
  Messages follow #81 (minor → guardian).

## Interface needs (adopt the real names found on M3)
```ts
// 85b + #92 entries
export const entry: PgTable<{ id; code; competitionId; registrationId; institutionRegistrationId: string | null; status }>;
export type EntryStatus = "..." | "foa_verified" | "...";               // #92 adds foa_verified
// #70 competitions
export const competition: PgTable<{ id; code /* ^[A-Z]{3,6}\d{2}$ */; physicalArtworkRule: "none" | string }>;
export function requiresPhysicalArtwork(c: { physicalArtworkRule: string }): boolean;
// #73 codes
export function withUniqueCode<T>(o: { format: CodeFormat; constraint: string }, attempt: (code: string) => Promise<T>): Promise<T>;
// #59 / #60
export function can(actor: Actor, action: "artwork.request" | "artwork.dispatch" | "artwork.receive" | "artwork.read",
  resource: { competitionId: string } | { artworkId: string }): Promise<void>;  // DomainError forbidden | second_factor_required
export function audit(tx: AppDb, row: { action: string; entityType: "physical_artwork"; entityId: string; before: unknown; after: unknown }): Promise<void>;
// #61 outbox and jobs (+ harness drain())
export function emit(tx: AppDb, e: { type: "artwork.requested" | "artwork.dispatched" | "artwork.received";
  aggregateType: "physical_artwork"; aggregateId: string; payload: object }): Promise<void>;
export function scheduleAt(tx: AppDb, name: "artwork.dispatch_reminder", at: Date, key: string): Promise<void>;
// 84b reminders: per-subject reminder if its registry supports it, else #61 scheduleAt above with a run-time re-check
export function scheduleSubjectReminder(tx: AppDb, r: { name: string; subjectKey: string; fireAt: Date }): Promise<void>;
// #62 settings
export function getSetting<K extends SettingKey>(db: AppDb, key: K): Promise<SettingValue<K>>;
export function isPlaceholder(value: string): boolean;                    // production refuses placeholders
// #69 / #74 / #81 notifications
export function registrationCoordinators(tx: AppDb, institutionRegistrationId: string): Promise<Recipient[]>;
export function participantRecipients(tx: AppDb, registrationId: string): Promise<Recipient[]>; // guardian if minor
export function actsForRegistration(tx: AppDb, actor: Actor, registrationId: string): Promise<boolean>; // self, teen, guardian
```

## Residue
HR-40 (facility address, packaging copy, shipping payer, dispatch window; seeded sample values, production refuses the
placeholder address) · HR-14 (DLT for the 3 SMS-capable templates: requested, reminder, received; `sms.enabled` off) ·
HR-31 (retention for dispatcher identity, courier and tracking number; inventory rows added) · HR-10/M3 (redeploy
`worker-preview` so the reminder and acknowledgement handlers run on previews).

## Test plan
Unit (done ✔): `domain/status.test.ts` (64-pair table), `domain/decide.test.ts`, `domain/schedule.test.ts`,
`domain/code.test.ts`. Seam 1 (`createHarness`, PGlite, fake clock, `drain()`, fakes): `request.test.ts`,
`dispatch.test.ts`, `reminder.test.ts`, `receive.test.ts`, `authz.test.ts` (matrix over every new use case),
`read-models.test.ts`, seed test. Seam 2: `tests/e2e/93-physical-artwork.spec.ts` (Not run: no Postgres here; previews
fail at `db:migrate`). Gates per rules.md.

## Slices (ordered)
1. **Request and notice**: AC 1, 2, 6, 7, 8 (request rows). Schema + migration, settings, `requestPhysicalArtwork`,
   `artwork.requested` event + template + recipients. S1 `request.test.ts`.
2. **Dispatch**: AC 3, 7, 8 (dispatch rows). `recordArtworkDispatch`, `artwork.dispatched`. S1 `dispatch.test.ts`.
3. **Reminder**: AC 5. Schedule at request, handler re-checks via `decideArtwork(remind)`. S1 `reminder.test.ts`.
4. **Receive and acknowledgement**: AC 4, 7, 8 (receive rows). `markArtworkReceived`, ack template. S1 `receive.test.ts`.
5. **Pages and seed**: AC 8 (lists), 9. List/detail read models, find by code or tracking number, 4 pages, nav links,
   seed, e2e spec. S1 `read-models.test.ts` + `seed.test.ts`; S2 spec written.
