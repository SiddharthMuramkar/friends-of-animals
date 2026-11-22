# Brief 124: volunteer tasks, hours and certificates (issue #124, M6)

| | |
|---|---|
| Blocked by | 100b (verify), 100c (template, downloads), 119 (timeline + milestone write seam), 123 (volunteer role, `volunteer_interest`). Through them: 100a, 59a, 60, 61a, 69, 82, 114 |
| Size, flags | L · risk (personal data; 14–17 volunteers' hours and certificates on a public verify page) |
| Keys | none listed, but **H13** (certificate schema, document, template, verify): serialize with any open certificate ticket (#101, #102) |
| Branch | `ticket/124-volunteer-tasks-hours-and-certificates` → PR into `M6`, title `M6 #124: Volunteer tasks, hours and certificates` |
| Head start | `209d638` (pure, plain Vitest): `src/server/modules/volunteers/domain/{task-status,hours,volunteer-certificate}.ts` + tests. Rebase onto `foa/M6` at build start; new files only |

## Scope
In: tables `volunteer_task`, `volunteer_task_assignment`, `volunteer_hours_entry`; enums `volunteer_task_status`, `volunteer_hours_status`
(full sets now, F2); task and hours use cases; volunteer certificates in 100a's `certificate` table; volunteer branches in the PDF
document, template and `/verify` view; milestone + timeline writes through #119's seam; seven pages; `volunteerWork` namespace; seed.
- **#123 owns:** applications, the `volunteer` role grant, `volunteer_interest`, `/dashboard/volunteer` and `/admin/volunteers/applications`.
- **#119 owns:** milestone/timeline tables and the write seam. #124 appends kinds to `TIMELINE_ENTRY_KINDS` (H20) and records `volunteer`.
- **100a/b/c own:** numbering, the validity and render machines, the render job, `/verify`, downloads. #124 adds one branch to each.
- **Out:** revoking volunteer certificates (#101's revoke works on any row once landed), guardian notifications for 14–17 volunteers.
No siblings: this unit is the whole ticket.

## Acceptance criteria (numbered, with seam)
1. **Task machine** (unit ✔ + S1). `TASK_TRANSITIONS` lists every allowed `(action, from → to)`; anything else throws `TaskTransitionError`,
   mapped to `DomainError("invalid_transition")`. Each task use case refuses a forbidden move and writes nothing.
2. **Create, publish, assign** (S1). `createVolunteerTask` → `draft`; `publishVolunteerTask` → `open`; `assignVolunteerTask` to a holder of
   global `volunteer` → `assigned`, one assignment row, `volunteer.task_assigned` emitted; a non-volunteer → `invalid_input`; same
   volunteer twice → no second row; `unassignVolunteerTask` of the last assignee → `open`; `cancelVolunteerTask` from any live status.
3. **Start, complete** (S1). The assigned volunteer (or a community manager) moves `assigned → in_progress → done`.
4. **Log hours** (unit ✔ + S1). `logVolunteerHours({ taskId, minutes, workedOn, note? })` by an assignee → `submitted`. Refused: not assigned
   (`forbidden`); task `draft|open|cancelled`; minutes not a whole number in 1–1440; `workedOn` after today in IST (fake clock at
   18:29Z vs 18:31Z), before the assignment's IST date or after unassignment; the day's non-rejected total over 1440; note over 500.
5. **Decide hours** (unit ✔ + S1). `approveVolunteerHours` / `rejectVolunteerHours({ reason })` by a community manager → `approved|rejected`,
   `decided_by/at` from the clock. Deciding twice → `invalid_transition`; reject without reason → `invalid_input`; a manager deciding
   their own hours → `forbidden`.
6. **Only approved count** (S1). With submitted, approved and rejected entries, `getMyVolunteerRecord().approvedMinutes` and the
   certificate's `approved_minutes_snapshot` equal the approved sum only.
7. **Milestone + timeline** (S1). First approval → one `volunteer` milestone (+ its `milestone.volunteer` entry); later approvals add no
   milestone. Each approval adds one `volunteer.hours_approved` entry (`source_key` per entry), written in the approval's transaction.
8. **Certificate** (unit ✔ + S1). `requestVolunteerCertificate()` with approved > 0 → one `certificate` row, type `volunteer_service`,
   number matches `CERTIFICATE_NUMBER_PATTERN`, `recipient_user_id`, snapshot = approved sum, render queued. Again with the same total
   → same row, no new render. After more approvals → a new row; the old one stays `issued`. Zero approved → `nothing_to_certify`.
9. **QR verify** (S1). Take the path from `h.pdf.rendered[i].data.verifyUrl`, run 100b's param handling, then `verifyCertificate` →
   `{ outcome: "valid", type: "volunteer_service", number, issuedOn, approvedMinutes, credit: "Asha R." }`. The serialised result has
   no email, phone, DOB, user id, full name, task title or note.
10. **Registration certificates unchanged** (S1). 100a/100b/100c test files pass untouched after #124's migrations.
11. **Authorization** (S1), every use case: manage tasks (create/publish/assign/unassign/cancel/list) community_manager ✓, volunteer ✗,
    member ✗; start/complete assignee ✓, other volunteer ✗; log hours assignee ✓, unassigned volunteer ✗; decide community_manager ✓,
    volunteer ✗, manager on own hours ✗; own record + certificate volunteer ✓, member ✗, visitor ✗.
12. **Audit** (S1). Every manager action and every certificate issue writes one `audit_log` row with ids and changed fields, never a note.
13. **Seed** (S1 `seed.test.ts`). Preview seed adds tasks in every status, a volunteer with approved/submitted/rejected hours and one
    issued volunteer certificate with a fixed number; running it twice changes nothing.
14. **Pages** (S2, written, Not run). The seven pages and `/verify/<seeded volunteer number>` pass `expectRendersAccessibly` + one `.dark`
    run; signed-in pages are noindex; no horizontal scroll at 320 px.

## Files
New: `src/server/modules/volunteers/{tasks,hours,record,certificate,work-use-cases}.ts` + tests, `src/server/db/schema/volunteer-work.ts`,
`src/server/seed/volunteer-work.ts`, `drizzle/NNNN_124_volunteer_work.sql` (generated) + `NNNN_124_certificate_subject.sql` (custom),
`src/app/dashboard/volunteer/{tasks,hours,certificate}/page.tsx`, `src/app/admin/volunteers/{tasks,tasks/new,tasks/[taskId],hours}/page.tsx`
(+ `_components`, `_lib`), `messages/en-IN/volunteerWork.json`, `tests/e2e/124-volunteer-work.spec.ts`.
Touch (hotspots): H13 `schema/certificates.ts`, `certificates/document.ts`, 100c `template/certificate-html.ts` + `certificatePdf.json`,
100b `verify.ts` + `verify.json`, 100c `downloads.ts` owner rule; H20 `community/domain/timeline.ts` + `community.json` labels; H8 policies;
H9 event union + #69 routes/templates seed; H5 inventory; H1, H6, H3, H19 (dashboard + `/admin/volunteers` menu); `src/server/app.ts`.

## Design (risk-flagged: certificate subject compared three ways)
- **A. Volunteer subject in 100a's `certificate` table ← chosen.** Add `recipient_user_id` and `approved_minutes_snapshot` (null), drop NOT NULL
  on `participant_profile_id`, CHECK exactly one subject, CHECK `(type = 'volunteer_service') = (recipient_user_id IS NOT NULL AND
  approved_minutes_snapshot IS NOT NULL AND registration_id IS NULL)`. The literal comes from 100a's CREATE TYPE, so F2 is safe.
  Number uniqueness, validity, render, storage, `/verify` and revoke all come with it; each reader gets one branch on `type`.
- **B. Separate `volunteer_certificate` table + verify union.** It duplicates the render, storage and status columns, and numbers must stay
  unique across two tables (a trigger or a third registry table). Rejected.
- **C. 1:1 side table `volunteer_certificate_detail`.** Keeps the core table narrow, but every read joins and the core row still needs a
  nullable profile. Fallback if review objects to A's columns.
- **Must fix (100a's index):** 100a plans unique `(registration_id, type, round_id) NULLS NOT DISTINCT WHERE status <> 'superseded'`. With null
  registration and round, it allows **one volunteer certificate in total**. If 100a's index doesn't already skip null registrations, #124's
  custom migration drops it and recreates it with `AND registration_id IS NOT NULL`, and adds unique `(recipient_user_id,
  approved_minutes_snapshot) WHERE type = 'volunteer_service' AND status = 'issued'` as the request's race backstop. A revoked one
  (#101) then doesn't block reissuing the same total; `decideVolunteerCertificate` is given the newest *issued* row.
- **Growing totals:** snapshot certificates. Each states "N hours as of date" and stays valid. A new one is issued only when the approved
  total grew (`decideVolunteerCertificate`). Superseding belongs to #101. Default recorded under HR-57.
- **Issue synchronously, render async.** `requestVolunteerCertificate`: can → total → decision → insert row and number → 100a's render job,
  all in one transaction. The volunteer sees the number at once. Rejected: the proposed `volunteer.certificate_requested` event plus an
  issuing handler. It adds an event and a pending state for no gain (deviation, stated in the PR).
- **Milestone + timeline in the approval's transaction** through #119's idempotent seam, not through a consumer. `volunteer.hours_*` events
  still go out for #69's notifications only.
- **Rules live in the pure core** (task machine, hours entry and decision checks, totals, certificate decision). Use cases load facts,
  call the core and map problems to `DomainError` codes. Names carry `Volunteer` because `composeUseCases` is one flat namespace.
- Verify credit: short name for every volunteer certificate (no DOB lookup, so 14–17s are safe by default); HR-55.

## Interface needs (code against these; adopt real names at claim)
```ts
// 57a: UseCaseContext, composeUseCases, uuidv7(at), createHarness, FakeClock.set/advance
// 59a: authorize(ctx, a: "volunteerTask.manage" | "volunteerTask.work" | "volunteerHours.log" | "volunteerHours.decide"
//   | "volunteerRecord.readOwn" | "volunteerCertificate.request", r?: Resource): Promise<{ role: Role | null }> // throws forbidden
//   holdsRole(db: AppDb, userId: string, role: Role, scope?: Scope): Promise<boolean>   // assignee check; else query user_role
//   recordAudit(tx, ctx, { action; entity: { type; id }; before; after; actorRole }); DomainError(code)
// 61a: emit(tx: AppDb, clock: Clock, e: { type: "volunteer.task_assigned"; payload: { taskId: string; volunteerUserId: string } }
//   | { type: "volunteer.hours_approved" | "volunteer.hours_rejected"; payload: { entryId: string; volunteerUserId: string } }); h.drain()
// 123: VOLUNTEER_INTERESTS tuple + pgEnum `volunteerInterest` (schema/volunteers.ts); seed builder h.seed.volunteer(): Promise<User>
// 119 (write seam, idempotent by source_key / unique milestone):
recordMilestone(tx: AppDb, clock: Clock, m: { subject: Subject; kind: MilestoneKind; competitionId: string | null;
  achievedAt: Date }): Promise<{ recorded: boolean }>;
recordTimelineEntry(tx: AppDb, clock: Clock, e: { subject: Subject; kind: TimelineEntryKind; occurredAt: Date; refType: string;
  refId: string; labelParams: Record<string, string | number>; sourceKey: string }): Promise<{ recorded: boolean }>;
// 100a: CERTIFICATE_TYPES has "volunteer_service" ✔, CERTIFICATE_NUMBER_PATTERN ✔, certificateNumberFormat ✔, and
insertIssuedCertificate(tx: AppDb, clock: Clock, row: { type: CertificateType; nameSnapshot: string; templateVersion: number;
  participantProfileId: string | null; recipientUserId: string | null; approvedMinutesSnapshot: number | null;
  registrationId: null; competitionId: null }): Promise<{ id: string; number: string }>; // number retry + render job
//   if absent: build it from 73's withUniqueCode + certificateNumberFormat + emit("certificate.render")
type CertificateDocument = RegistrationCertificateDocument | { type: "volunteer_service"; number: string; recipientName: string;
  approvedMinutes: number; issuedOn: { year: number; month: number; day: number }; verifyUrl: string; signatories: Signatory[] };
// 100b: VerifyResult valid branch: | { outcome: "valid"; type: "volunteer_service"; number; issuedOn; approvedMinutes: number; credit: string }
// 100c: getCertificateDownloadUrl owner = participant profile's user OR recipient_user_id; certificateHtml(volunteer doc)
// 82: shortPublicName(fullName: string): string   // "Asha R."; else add one beside verify.ts
// 114: inventory rows for volunteer_hours_entry.note, .reject_reason (toConfirm: true)
```

## Residue
HR-42 append (volunteer certificate wording + layout; ships with default wording and the sample signatory) · HR-55 append (what `/verify`
shows for volunteer certificates, incl. 14–17s: short name, hours, issue date) · HR-56 append (copy: task assigned, hours approved or
rejected) · HR-57 append (defaults: older certificates stay valid, no minimum hours, ≤ 24 h a day, no hours before assignment or in the
future, a revoked volunteer can't log hours or request a certificate) · HR-31 append (retention: hours note, reject reason) · HR-14 append
(DLT for volunteer SMS; SMS off, email + in-app cover).

## Test plan
Unit ✔: `domain/task-status.test.ts`, `domain/hours.test.ts`, `domain/volunteer-certificate.test.ts`. Seam 1 (`createHarness`, PGlite,
fake clock, `h.drain()`, `FakePdfRenderer`, #123/#100a/#119 seed builders): `tasks.test.ts` (AC 1–3, 11, 12), `hours.test.ts` (AC 4–7,
11, 12), `certificate.test.ts` (AC 8, 9, 11, 12), the 100a/b/c files unchanged (AC 10), `seed.test.ts` (AC 13). Seam 2:
`tests/e2e/124-volunteer-work.spec.ts`, written, Not run (no Postgres here; previews fail at `db:migrate`).

## Slices (ordered)
1. **Tasks**: schema + generated migration (task tables, both enums), task use cases, policy, audit, `volunteer.task_assigned`. AC 1, 2, 3,
   11 (tasks), 12. `src/server/modules/volunteers/tasks.test.ts`.
2. **Hours**: hours table, log/approve/reject, `getMyVolunteerRecord`, milestone + timeline writes, H20 kinds. AC 4–7, 11 (hours), 12.
   `src/server/modules/volunteers/hours.test.ts`.
3. **Certificate**: certificate subject migration (columns, CHECKs, index swap), `requestVolunteerCertificate`, document, template, verify and
   download branches. AC 8, 9, 10, 11 (certificate), 12. `src/server/modules/volunteers/certificate.test.ts`.
4. **Pages + seed**: seven pages, nav, `volunteerWork` messages, seed, inventory rows, e2e spec. AC 13, 14. `src/server/seed/seed.test.ts`
   + `tests/e2e/124-volunteer-work.spec.ts`.
