# Brief 92: FOA verification of digital entries (unit 92, issue #92, M2)

| | |
|---|---|
| Blocked by | 89b (and through it 85b, 87, 88, 89a; M0 #59 #60 #61 #62 #63; M1 #69 #70 #71 #81) |
| Size, flags | L · A (new staff role, signed access to minors' work) · K · PD · F2 (role value in its own migration) |
| Keys / order | X7 `enum:role`; Q2 merge order **92 before 91a**; X11 is not held (92 only *reads* `school_round`) |
| Branch | `ticket/92-foa-verification-of-digital-entries` → PR into `M2`, `M2 #92: FOA verification of digital entries` |
| Head start | `98aa05f` on the branch (pure core, see "Design"). Rebase onto `foa/M2` when the build starts |

## Scope
In: the `foa_verifier` staff role; the verification queue (both routes); verify / send back with a reason; resubmission
before the deadline (with or without a new file) back into the queue; the scheduled forwarding of individual entries at
the submission deadline; setting `entries.resubmission_days`; events, templates, audit; admin pages, participant
sent-back panel, coordinator sent-back list; seed; transition rows. No siblings: 92 owns all of #92.
Out: physical track (#93/#94 read `foa_verified`), the admin home queue tile (#117), reopen guard (#90 reads our
decisions; F15), shortlist-only creation (91a), essay/video derivatives (86a/86b; we only display what exists).

## Acceptance criteria (numbered, with seam)
1. **Queue, both routes** (S1). `as(verifier).listVerificationQueue({})` lists every `submitted_to_foa` entry from the
   school and individual routes, oldest arrival first; filters `competitionId`, `route`; excludes `processing`,
   `submitted`, `rejected`, `failed`, `sent_back`, `foa_verified`. Items carry code, category, discipline, route, arrived-at.
2. **Individual route, no school round** (S1). Individual entry `submitted` → `clock.set(submissionClosesAt)`, `drain()` →
   `submitted_to_foa`, no `school_round` row exists. An entry still `processing` at the deadline is forwarded as soon as it
   reaches `submitted`. `rejected`/`failed` never forwarded. A school-route `submitted` entry is untouched by the job.
3. **School route arrival** (S1). After 89b `finaliseSchoolRound`, shortlisted entries appear in the queue.
4. **Verify** (S1). `verifyEntry({entryId})` → `foa_verified`; the resubmitter (individual: participant, or guardian if
   minor; school: the registration's coordinators) gets `entry_foa_verified` (email fake / inbox); one
   `entry.foa_verified` outbox row. Again → `already_verified`; on a `sent_back` entry → `awaiting_resubmission`.
5. **Send back** (S1). No reason → `reason_required`; `other` without text → `reason_text_required`; >500 chars →
   `reason_text_too_long`. With reason → `sent_back`, `resubmissionDueAt = now + 7d`; setting 3 → +3d. Recipient gets
   `entry_sent_back` with the reason and deadline (IST `longDateTime`).
6. **Resubmit** (S1). Before the deadline: no new file → `submitted_to_foa` at once, back in the queue; new file → stays
   `sent_back` until the replacement is live, then `submitted_to_foa` (even if live after the deadline). Rejected/failed
   replacement → stays `sent_back`, retry allowed before deadline. `clock.advance({days: 8})` → `resubmission_closed`,
   entry stays `sent_back`. History keeps every decision (2 `entry_verification` rows after send-back + verify).
7. **Transition table** (unit, 85b's `entries/status.test.ts`). Allowed rows added: `submitted→submitted_to_foa`,
   `submitted_to_foa→foa_verified`, `submitted_to_foa→sent_back`, `sent_back→submitted_to_foa`. Forbidden stay forbidden:
   `submitted→foa_verified`, `sent_back→foa_verified`, anything out of `foa_verified`. Deadline/route rules: `decide.test.ts`.
8. **Audit** (S1). verify, send back, resubmit each write one audit row (actor, role, action, entity, before/after status).
9. **Authz** (S1), every new use case. Queue/detail/verify/send-back: `foa_verifier` with second factor passes; without →
   `second_factor_required`; coordinator, participant, competition manager → `forbidden`. `resubmitEntry`: owning
   participant/guardian (individual) or that institution's coordinator (school) pass; another family, another
   institution's coordinator, the verifier fail. `forwardIndividualEntries`: system actor only; a user fails.
10. **Lock order** (S1, review). Deciding on a school-route entry first takes `FOR UPDATE` on its `school_round` row (F15).
    If #90 is on M2: after a verify, reopen of that round is refused.
11. **axe** (S2, written, not run here). `tests/e2e/92-verification.spec.ts`: `/admin/verification`,
    `/admin/verification/[entryCode]`, participant sent-back panel; `expectRendersAccessibly` + one `.dark` run.
12. **Seed** (S1 `seed.test.ts`). Preview seed: one verifier (2FA via #60's preview mechanism), queue entries from both
    routes, one `sent_back` entry with an open window.

## Files
New (parallel-safe): `src/server/modules/verification/{domain/decide.ts ✔, use-cases/*.ts, index.ts, *.test.ts}`,
`src/server/db/schema/verification.ts`, `src/server/seed/verification.ts`, `src/app/admin/verification/{page.tsx,
[entryCode]/page.tsx, _components/*}`, `messages/en-IN/{adminVerification,entryResubmission}.json`,
`tests/e2e/92-verification.spec.ts`, `drizzle/NNNN_92_pre_enum_role.sql` (custom, `ADD VALUE 'foa_verifier'` only, if
roles are an enum) + `drizzle/NNNN_92_foa_verification.sql`.
Hotspots: H30/X7 role registry; H22 `entries/status.ts` (+ test); H23 replace-entry-file path (call, don't fork);
H24 competition schedule registry (deadline job, reschedule on `submissionClosesAt` edit); H26 `src/app/dashboard/entries/**`;
H27 `src/app/institution/competitions/[ref]/**`; H31 file `can()` rules; H7 settings; H8 `can()` table; H9 events →
templates; H19 `app-routes.ts` + admin nav; H3 `messages.ts`; H1 schema barrel; H6 seed barrel; `src/server/app.ts` (one line).

## Design (risk-flagged: three interfaces compared)
- **A. Entries sub-module**: use cases + `entry_verification` inside `modules/entries`. Shallow seam, most hotspot edits
  (H22/H23/H26 plus the module index), every 91a/86x rebase collides; #94 can't mirror it.
- **B. Separate Verification module**: owns `entry_verification`, queue and decisions; changes status only through
  Entries' `transitionEntry`. New folder, Entries stays the single writer of `entry_status`.
- **C. B plus a pure decision core** ← **chosen**. All rules sit behind one function, `decide(state, command, now)`
  (commands `verify | send_back | resubmit | replacement_live | forward`), already built and tested (60 cases). Use cases
  stay thin: lock, load state, `can()`, `decide`, then `transitionEntry` + `entry_verification` + audit + `emit` in one tx.
  Why: most leverage per interface (one function covers 5 behaviours, tested cheaply as a table), locality (the
  deadline/reason/route rules live in one file), a small hotspot footprint, and #94 can copy the shape. Deletion test: removing
  `decide` scatters the guards across 5 use cases and the consumer.
- Table `entry_verification` (id uuidv7, entry_id FK idx, decision `entry_verification_decision` (`verified`,`sent_back`),
  reason_code text null (zod registry, not an enum), reason_text null, decided_by_user_id, decided_at, resubmission_due_at
  null, resubmitted_at null, resubmitted_by_user_id null, resubmission_with_file bool null). `VerificationState` comes from
  `entry.status` + the latest row (`resubmissionPending` = `resubmitted_at` set, with a file, status still `sent_back`).
  CHECK: `decision='sent_back' ⇔ resubmission_due_at IS NOT NULL`. Reason codes stay text so HR-37 can change presets with no migration.

## Interface needs (what 92 codes against; adopt the real names found on M2)
```ts
// 85b entries
export const entryStatus: PgEnum<[..."submitted"|"submitted_to_foa"|"foa_verified"|"sent_back"...]>; export type EntryStatus;
export const entry: PgTable<{ id; code; competitionId; registrationId; institutionRegistrationId: string | null; status;
  categoryKey; disciplineKey; createdAt }>;                       // route = institutionRegistrationId ? "school" : "individual"
export function transitionEntry(tx: AppDb, i: { entryId: string; from: EntryStatus; to: EntryStatus; actor: Actor;
  at: Date; cause: string }): Promise<void>;                      // checks ENTRY_TRANSITIONS, WHERE status=from, history row
export function requestFileReplacement(ctx: UseCaseContext, tx: AppDb, i: { entryId: string; uploadId: string }): Promise<void>;
// event "entry.replacement_live" { entryId, fileId } and "entry.submitted" { entryId } consumable by modules
// 89a/89b school round
export const schoolRound: PgTable<{ id; institutionRegistrationId; status }>;
// #59 / #60 identity and audit
export function can(actor: Actor, action: "verification.read"|"entry.verify"|"entry.send_back"|"entry.resubmit",
  resource: { entryId: string }): Promise<void>;                  // throws DomainError forbidden | second_factor_required
export function audit(tx: AppDb, row: { action: string; entityType: "entry"; entityId: string; before: unknown; after: unknown }): Promise<void>;
// #61 outbox and jobs
export function emit(tx: AppDb, e: { type: VerificationEvent; aggregateType: "entry"; aggregateId: string; payload: object }): Promise<void>;
export function scheduleAt(tx: AppDb, name: "verification.forward_individual_entries", at: Date, key: string): Promise<void>;
// #62 settings: defineSetting({ key: "entries.resubmission_days", schema: z.int().min(1).max(60), default: 7 })
export function getSetting(db: AppDb, key: "entries.resubmission_days"): Promise<number>;
// #63 files: signedUrl(ctx, fileId, purpose: "display" | "original"): Promise<string>  (+ verifier resource rule)
// #69/#81 notifications: entryResubmitters(tx, entryId): Promise<Recipient[]>; templates registered per event
```

## Residue
HR-17 (who holds `foa_verifier`, 2FA enrolment) · HR-36 (verified/sent-back copy, reason preset labels) · HR-37 (7-day
default, four presets, metadata-only resubmission allowed, unlimited send-back rounds, competition manager is not a
verifier, school-route messages go to coordinators only, verifier may open originals via signed URL with audit) · HR-14
(DLT for the two SMS-capable templates; `sms.enabled` stays off).

## Test plan
Unit: `decide.test.ts` ✔ (60); `entries/status.test.ts` rows (AC7). Seam 1 (`createHarness`, PGlite, fake clock, `drain()`,
fakes): `queue.test.ts`, `forward-individual.test.ts`, `decisions.test.ts`, `resubmit.test.ts`, `authz.test.ts` (matrix
over every new use case), seed test. Seam 2: `tests/e2e/92-verification.spec.ts` (Not run: no Postgres here; previews fail at
`db:migrate`). Gates per rules.md.

## Slices (ordered)
1. **Role, forwarding, queue**: AC 1, 2, 3, 9 (queue rows). Role migration (F2 split), transition row
   `submitted→submitted_to_foa`, `forwardIndividualEntries` job + `entry.submitted` consumer, `listVerificationQueue`.
   S1 `queue.test.ts`, `forward-individual.test.ts`.
2. **Decisions**: AC 4, 5, 7, 8, 9, 10. `entry_verification` schema + migration, setting, `verifyEntry`, `sendBackEntry`,
   events + templates, audit, round lock. S1 `decisions.test.ts`.
3. **Resubmission**: AC 6, 9. `resubmitEntry` (+ replacement path), `entry.replacement_live` consumer. S1 `resubmit.test.ts`.
4. **Pages and seed**: AC 11, 12. `getEntryForVerification` (signed URLs), admin queue + detail, participant panel,
   coordinator list, seed, e2e spec. S1 `detail.test.ts` + `seed.test.ts`; S2 spec written.
