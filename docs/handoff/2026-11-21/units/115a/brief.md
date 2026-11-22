# Brief 115a: privacy rights requests and the grievance queue (requests)

Issue #115 · M5 · L · risk (PD, K, A) · key **X7** (role enum) · branch `ticket/115-requests` · worktree `/root/foa-wt/115a` (cut from `foa/M0` 442dd99; rebase onto `foa/M5` at build).
Blockers **63a**, **81b**, **114**. It also needs 57a/57b, 59a, 60, 61a, 62, 69, 73 (codes) on trunk.
Sibling **115b** (export/erase) owns the export engine, the signed export link, erasure preview and execution, and the completion of access and erasure requests.
**Head start (phase A):** pure core in `src/server/privacy/requests/domain/` (see the last section).

## Scope
**In (115a):** a signed-in user files an **access**, **correction** or **erasure** request for themselves, or a verified guardian files one for a linked child, then tracks it. The grievance officer works a **queue** with due dates, overdue flags, assignment, internal notes, start, reject, and completion of **correction** requests. Also:
- role `grievance_officer` (F13; X7);
- tables `privacy_request` and `privacy_request_note`;
- the request transition table;
- setting `privacy.requestDueDays` (30);
- events and templates for submitted, rejected, completed and overdue;
- the daily schedule `privacy.flagOverdue`;
- inventory entries and a retention policy for the new PD columns;
- 5 pages.

**Out, 115b:** `buildSubjectExport`, `privacy_export.ready`, the export link on `/dashboard/privacy/[id]`, `previewErasure` and `executeErasure`, completing access/erasure (`completed` / `partially_completed`), `erasure_record`, `file_asset_purpose` + `privacy_export`, settings `privacy.exportLinkHours` / `privacy.exportRetentionDays`.
**Out, later:** the 18th-birthday handover of a guardian-managed profile, which #81 and #82 both defer to "#115". 115a only refuses a guardian filing for an 18+ child (`child_is_adult`); the full handover goes to the orchestrator as a follow-up (see Residue).

## Acceptance criteria as testable checks
1. **Adult files and tracks** (S1). `as(adult).submitPrivacyRequest({ type, subject: { kind: "self" }, correctionDetails? })` for each of the 3 types returns `{ ok: true, requestId, reference }`. The row is `submitted`, relation `self`, subject `user`/own id, and `due_at = created_at + 30 days` (fake clock). `listMyPrivacyRequests()` shows all 3 with status and due date. `getMyPrivacyRequest({ id })` shows the timeline. Correction without details → `invalid_input`, nothing written.
2. **Guardian for a linked child** (S1). A verified guardian files for a linked 9-year-old → ok, relation `guardian`, subject `participant_profile`/child id. Refused, with nothing written: an unlinked child (`forbidden`), an unverified guardian (`guardian_not_verified`), a child now 18+ (`child_is_adult`).
3. **Teen defaults** (S1 + pure). A linked 15-year-old may file self access and correction. Self erasure is refused with `erasure_needs_guardian`. That teen's guardian sees the teen's requests in `listMyPrivacyRequests` (scope `children`).
4. **Cancel** (S1). The requester cancels while `submitted` → `cancelled`. Once `in_progress` the cancel is refused (`already_in_progress`). Another member gets `forbidden`.
5. **Queue with due dates and overdue flags** (S1). `as(officer).listGrievanceQueue({ status: "open" })` returns every open request, earliest due first, each with `reference`, `type`, `relation`, `dueAt`, `daysLeft`, `overdue`, `assignee`. After `h.clock.advance({ days: 31 })` open rows have `overdue: true`, and a completed or rejected row is `false`. Filters: `assignee: "me" | "unassigned" | userId`, `type`, `status: "open" | "closed" | <status>`.
6. **Work the request** (S1). `assignPrivacyRequest` to another officer moves `submitted` → `in_progress` (a reassign keeps the status). An assignee without the role is refused (`assignee_not_officer`). `startPrivacyRequest` self-assigns and moves to `in_progress`. `addPrivacyRequestNote({ id, body ≤ 2000 })` is append-only and officer-only, never shown to the requester. `rejectPrivacyRequest({ id, reason ≤ 1000 })` works from `submitted` or `in_progress`, and the reason is shown to the requester. `completeCorrection({ id, resolution })` takes an `in_progress` correction → `completed`. It's refused for access/erasure (`completed_by_export_or_erasure`, 115b).
7. **Transition table** (pure + S1). Every (status × event × type) cell, allowed and forbidden, matches §2.1 of `issues-M5.md`. Terminal statuses refuse everything (`request_closed`). `partially_completed` is erasure only. Cancelling from `in_progress` is refused.
8. **Audit, no PD** (S1). Submit, assign, start, note, reject, complete and cancel each write one `audit_log` row, entity `privacy_request`/id. `before`/`after` parse with the strict `privacyRequestAuditSchema` (status, type, relation, subject kind, assignee id, note count). Assert that no note body, correction text, reason, email or name appears in the JSON.
9. **Messages** (S1, drain). Submit → the requester gets the ack (email + in-app) and every grievance officer gets an in-app item. Reject and completion notify the requester (for a guardian filing: the guardian). The daily `privacy.flagOverdue` run gives each officer one in-app digest with the counts `{ overdue, assignedToYou }`, and nothing when none are overdue. Running it twice the same IST day sends no second digest.
10. **Authorization, every new use case** (S1). Requester use cases: the user allowed, another member `forbidden`, a visitor `forbidden`. Queue use cases: `grievance_officer` allowed; `staff_admin`, `super_admin` (not a wildcard, 59a), `finance` and a member are `forbidden`. A refusal writes nothing. Queue use cases need the staff second factor (#60 gate).
11. **Inventory + retention** (Vitest over the barrel, 114's coverage test). Entries for `privacy_request.correction_details`, `.resolution_note`, `.rejection_reason` and `privacy_request_note.body`. Ids and statuses go on `NON_PERSONAL`. Policy `privacyRequests`: delete the request and its notes 3 years after closure (G1, `toConfirm`). Open requests are never touched.
12. **Pages, axe clean light + dark** (S2, written, **Not run**): `/dashboard/privacy`, `/dashboard/privacy/new`, `/dashboard/privacy/[id]`, `/admin/privacy/requests`, `/admin/privacy/requests/[id]`, in `tests/e2e/115-privacy-requests.spec.ts`. Overdue uses an icon and a word, never colour alone.

## Files
- **Have (head start):** `src/server/privacy/requests/domain/{request-status,filing,due,reference,audit}.ts` + tests.
- **New:** `src/server/db/schema/privacy-requests.ts`; custom migration `115_pre_enum_role_grievance_officer` (`ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'grievance_officer';`, nothing else, and no DDL in the PR names it); generated `115_privacy_requests` (enums `privacy_request_type`, `privacy_request_status`, `privacy_request_relation`, `privacy_subject_kind`, both tables, indexes `(status, due_at)`, `(requested_by_user_id, created_at desc)`, `(subject_kind, subject_id)`, unique `reference`); `src/server/privacy/requests/{submit,cancel,my-requests,queue,work,overdue,policy,use-cases,index}.ts` + Seam 1 tests; `src/app/dashboard/privacy/**`, `src/app/(staff)/admin/privacy/requests/**` (follow 59b's/114's group); `messages/en-IN/{privacyRequests,adminGrievance}.json`; `tests/e2e/115-privacy-requests.spec.ts`.
- **Touch (append-only):**
  - 59a `roles.ts` (`grievance_officer` in `ROLES`, `ROLE_SCOPE_TYPES` global, `STAFF_ROLES`) and the policy table (11 actions);
  - `app.ts` (`privacyRequestUseCases`), the schema barrel, 61a `SCHEDULES`, 62 catalogue (1 key), 69 templates and event map (5), 114 `INVENTORY` / `NON_PERSONAL` / policies (+1);
  - `src/i18n/messages.ts`, `src/lib/app-routes.ts`, the admin and dashboard nav (H19).
- **Hotspots:** X7 (serialize with 92, 95b, 116a: one enum value per migration); H41/H5 (114's coverage test arbitrates); H8, H9, H10, H3, H19; `drizzle/meta/*` (merge queue).

## Design (codebase-design; PAPER round, compared in context)
- **(a) One `privacy_request` aggregate + pure domain core (chosen).** One table holds the subject as `(subject_kind, subject_id)` plus `relation`. Depth sits in four pure modules: `decideFiling` (who may file what for whom, refusal precedence), `decideRequestTransition` (the table), `queueFlags` (due, overdue, days left in IST), and `privacyRequestAuditSnapshot` (the only way into audit JSON). Use cases are thin: `authorize` → load facts → decide → write row + audit + outbox in one transaction. 115b plugs in with two transitions (`complete`, `complete_with_retained`) and reads `subject_kind/subject_id`.
- **(b) One table per request type** (access/correction/erasure). Each would have its own lifecycle columns. Three copies of the machine and the queue would need a UNION; it fails locality.
- **(c) A generic "case" module shared with #113 contact and #116 safeguarding.** It would be shallow (each has different states, privacy rules and audiences), and it couples three M5 tickets' merge order. Rejected.

Reversible defaults (write them in the PR):
- **Who may file.** A teen files self access/correction but not erasure (HR-30). The guardian sees the teen's requests. An under-13 has no login.
- **Who works the queue.** Only `grievance_officer` (super admin not a wildcard). Assign on `submitted` starts it.
- **Notes and tracking.** Notes are append-only in the app (no edit/delete use case, **no DB trigger**, so retention can delete closed requests). `due_at` = created + `privacy.requestDueDays` (30, HR-51; the DPDP maximum is G1/HR-30). Reference `PR-{YY}-{6 Crockford}` (IST year) via 73's `withUniqueCode`.
- **Completion.** Corrections are applied by the officer through the owning module's own screens. `completeCorrection` records the outcome (no generic field editor across modules' invariants).
- **Overdue digest.** Once per IST date, keyed by date.

## Interface needs (code against these; rename to what landed)
```ts
// 57a/57b: createHarness(), h.as, h.clock, h.drain(), uuidv7(at), UseCaseContext; h.signIn(user): Promise<Actor & { kind: "user" }>; class DomainError(code)
// 59a
type Role = (typeof ROLES)[number];                    // + "grievance_officer"
authorize(ctx: UseCaseContext, action: PrivacyRequestAction, resource?: { ownerId?: string }): Promise<{ role: Role | null }>; // throws forbidden
recordAudit(tx: AppDb, ctx: UseCaseContext, e: { action: `privacy_request.${string}`; entity: { type: "privacy_request"; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
userIdsWithRole(db: AppDb, role: Role): Promise<string[]>;   // fallback: select user_id from user_role where role = … and scope_type = 'global'
h.seed.grant(user, { role: "grievance_officer", scope: { type: "global" } }); h.seed.superAdmin(); h.seed.staffAdmin()
// 60: POLICY entries take secondFactor: "staff"; harness gives staff a fresh second factor (h.stepUp(actor))
// 61a
emit(tx: AppDb, clock: Clock, e: { type: `privacy_request.${"submitted" | "rejected" | "completed" | "overdue_digest"}`; aggregate: { type: "privacy_request" | "privacy_overdue_digest"; id: string }; payload: { requestId?: string; date?: string } }): Promise<void>;
SCHEDULES.push({ name: "privacy.flagOverdue", cron: "0 9 * * *", tz: "Asia/Kolkata", run: (deps) => as({ kind: "system", process: "worker" }).flagOverduePrivacyRequests() })
// 62: integerSetting({ default: 30, min: 1, max: 90, unit: "days" }) as "privacy.requestDueDays"; readSetting(db, "privacy.requestDueDays"): Promise<number>
// 69: templates privacy_request_received | privacy_request_new | privacy_request_rejected | privacy_request_completed | privacy_request_overdue; audiences { kind: "user"; userId } and role "grievance_officer"
// 73: withUniqueCode({ format: requestReferenceFormat(now), constraint: "privacy_request_reference_unique" }, (code) => tx.transaction(...))
// 78/81a/81b
activeGuardianLink(db: AppDb, guardianUserId: string, profileId: string): Promise<{ guardianId: string; verified: boolean } | null>;
guardianUserIdsOf(db: AppDb, profileId: string): Promise<string[]>;          // active, verified: for visibility and messages
ownParticipantProfile(db: AppDb, userId: string): Promise<{ id: string; dateOfBirth: CalendarDate } | null>; // teen login; decrypts (F22: 106a's isMinor if landed)
ageAt(dateOfBirth: CalendarDate, at: Date): number;
// 114: INVENTORY entries { table, column, category, purpose, subject: { kind, via }, retention: { policy, period, basis, toConfirm: true }, onExpiry }; NON_PERSONAL; RetentionPolicy { key, action, defaultDays, candidates, apply }
```
Use cases: `submitPrivacyRequest`, `cancelPrivacyRequest`, `listMyPrivacyRequests`, `getMyPrivacyRequest`, `listGrievanceQueue`, `getGrievanceRequest`, `assignPrivacyRequest`, `startPrivacyRequest`, `addPrivacyRequestNote`, `rejectPrivacyRequest`, `completeCorrection`, `flagOverduePrivacyRequests` (system worker only). Results are `{ ok: true, … } | { ok: false, reason }`, and each one's first line is `authorize`.

## Residue
- **HR-17:** FOA appoints the grievance officer (2FA, production role).
- **HR-21:** grievance officer name and email on the site (CMS facts).
- **HR-30:** counsel: teen filing alone, erasure via guardian, 30-day due vs DPDP maximum.
- **HR-31:** request retention 3 years after closure.
- **HR-50:** request and status templates.
- **HR-51:** `privacy.requestDueDays` default.
- **HR-10:** redeploy the worker so `privacy.flagOverdue` runs.
- **Follow-up (orchestrator):** the 18th-birthday handover of guardian-managed data (#81/#82 point here; #115's ACs don't cover it).
- **Not run:** Seam 2 (no Postgres server).

## Test plan
- **Pure (done in phase A):** `request-status.test.ts` (full table), `filing.test.ts` (age × target × type, precedence), `due.test.ts` (due date, overdue boundary at ±1 ms, IST days left, digest counts), `reference.test.ts`, `audit.test.ts` (strict schema rejects extra keys and PD).
- **Seam 1** on `createHarness()`: real migrations, `FakeClock`, `FakeEmail`, drain, 81a's `h.seed.guardian({ children })`, `h.seed.grant`.
- **Seam 2 (Not run):** `tests/e2e/115-privacy-requests.spec.ts`.

## Slices
1. **Adult and guardian file and track** (ACs 1–3, 10 requester part, 11): role migration, schema + migration, setting, `submit`/`listMy`/`getMy`, inventory. Test `src/server/privacy/requests/submit.test.ts`.
2. **Queue with due dates, overdue, assign/start/note** (5, 6, 8, 10 queue part). Test `src/server/privacy/requests/queue.test.ts`.
3. **Reject, complete correction, cancel; transition table end to end** (4, 6, 7, 8). Test `src/server/privacy/requests/work.test.ts`.
4. **Messages and the daily overdue digest** (9). Test `src/server/privacy/requests/messages.test.ts`.
5. **Pages + Seam 2** (12). Test `tests/e2e/115-privacy-requests.spec.ts` (written, Not run) + build gate.

## Head start (phase A, on `ticket/115-requests`, cut from `foa/M0`, no PR)
`src/server/privacy/requests/domain/` (pure, 64 Vitest cases):
- `request-status.ts`: `PRIVACY_REQUEST_TYPES`, `PRIVACY_REQUEST_STATUSES`, `INITIAL_REQUEST_STATUS`, `REQUEST_EVENTS` (`start | assign | cancel | reject | complete | complete_with_retained`), `isOpenRequest`, `decideRequestTransition({ from, event, type })` → `{ ok, to } | { ok: false, reason: request_closed | already_started | already_in_progress | not_started | not_erasure }`. Build the pg enums from the lists.
- `filing.ts`: `decideFiling({ type, requesterAgeYears: number | null, target: { kind: "self" } | { kind: "child", childAgeYears, guardian: "verified" | "unverified" | "not_linked" } })` → `{ ok, relation, subjectKind }` or `not_your_child | guardian_not_verified | child_is_adult | erasure_needs_guardian | under_13_needs_guardian`. Local 13/18 constants: import 81a's `MINOR_LOGIN_MIN_AGE`/`ADULT_AGE` once on trunk.
- `due.ts`: `requestDueAt(filedAt, dueDays)`, `queueFlags({ status, dueAt, now })` → `{ open, overdue, daysLeft (IST calendar days) }`, `overdueDigests({ now, officerIds, requests })` → `{ userId, overdue, assignedToYou }[]`.
- `reference.ts`: `requestReferenceFormat(filedAt)` → `{ prefix: "PR-YY-", length: 6 }` (73's `CodeFormat`), `isRequestReference(text)`.
- `audit.ts`: `privacyRequestAuditSchema` (strict), `privacyRequestAuditSnapshot(row, { notes? })`.
