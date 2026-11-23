# Brief 87: Coordinator submits for students and certifies conduct

Unit 87 · issue #87 · M2 · size M · risk A K PD · blocked by 85b · branch `ticket/87-coordinator-submits-for-students-and` ·
worktree `/root/foa-wt/87` · base `442dd99` (foa/M0). No siblings. 0 owner comments on #87; #55 comments carry no #87 ruling.

## Scope
- **In:** while the competition's digital submission scope is **all participants**, a coordinator submits and replaces entries for
  confirmed students enrolled through their institution, through 85b's own submit use cases. Also: the coordinator dashboard
  roster (every student, entry status, next action), conduct certification (once per institution registration, audited),
  and `requireConductCertified` for 89b. Plus seed, three pages, axe specs.
- **Out:** file rules, scan gate, metadata stripping, Entry IDs, the deadline rule and the receipt template (all **85b**). Video
  and essay handlers (86a/86b; they work for coordinators automatically). Finalising the round and its guard call (**89b**).
  Shortlist-only scope (**91a**: coordinator submit is refused under that scope until 91a adds its path).

## Acceptance checks (all Seam 1 unless stated)
1. **Submit for own students.** `as(coordX)` `startEntryUpload` → storage-fake PUT → `completeEntryUpload` for a confirmed student
   of X: entry `processing` with code `^[A-Z]{3,6}\d{2}-E-[0-9A-HJKMNP-TV-Z]{6}$`. After drain it's `submitted`.
   `entry.created_by_user_id` and the `entry_transition` actor are the coordinator.
2. **For no one else.** Coordinator of Y on X's student gets `forbidden`, with no entry, file or audit row. An individual-route
   registration (even a student at X) gets `forbidden`. An unconfirmed enrolment gets `registration_not_confirmed`. A shortlist-only
   competition gets `forbidden_by_scope`.
3. **Same pipeline.** Through the coordinator path, a wrong type or oversize file is refused at start, and an EICAR file ends
   `rejected` with retry offered. A single test each is enough: they prove the shared path, not the rules again.
4. **Receipt to the family.** At `submitted`, drain. A minor's guardian gets `entry_received` naming the Entry ID (by email to the
   contact when there's no account, F13). An adult student gets it directly. The minor gets nothing and the coordinator gets nothing.
5. **Replace until the deadline.** The coordinator replaces a file. The entry stays `submitted`, and the old file stays live until
   the new one is. With `clock.set(submissionClosesAt)`, replace and retry are refused with `deadline_passed` (85b's rule, unchanged).
6. **Certify once, audited.** `certifyConduct({ institutionRegistrationId })` writes one row: certified_by, certified_at =
   `clock.now()`, statement_version. It writes one `audit_log` row `conduct.certified` with the actor, IP and UA. A 2nd call gets
   `already_certified` and no 2nd audit row. `getConductCertification` returns who and when. Certifying needs a confirmed
   institution registration.
7. **Finalising requires it.** `requireConductCertified(db, id)` throws `conduct_not_certified` before certification and passes
   after. The "finalise refused" test itself ships in 89b, which calls this; flag that in the PR.
8. **Dashboard lists everyone.** `listInstitutionSubmissions({ reference })` returns every enrolled student: no entry →
   `not_started`/submit; unconfirmed → no action plus a refusal; statuses, actions and counts as `buildSubmissionRoster` (done).
9. **Authz per use case** (`listInstitutionSubmissions`, `certifyConduct`, `getConductCertification`, and the coordinator branch of
   submit). The coordinator and the institution admin of X pass. Coordinator of Y, participant, guardian, member and competition
   manager get `forbidden`.
10. **Seed and axe.** `seedPreview` twice yields the same rows (Seam 1). `tests/e2e/87-coordinator-submissions.spec.ts` runs
   `expectRendersAccessibly` on the 3 pages in both themes (Seam 2, written; **Not run**: no Postgres here).

## Files
- **New:** `src/server/modules/institution-submissions/`:
  - `domain/{eligibility,roster}.ts` + tests (**built**, `08cb101`);
  - `index.ts` (facade);
  - `use-cases/{list-institution-submissions,certify-conduct,get-conduct-certification}.ts`;
  - `conduct.ts` (`isConductCertified`, `requireConductCertified`).
- **New:** `src/server/db/schema/conduct-certification.ts`, `src/server/seed/institution-submissions.ts`,
  `messages/en-IN/{institutionSubmissions,conductCertification}.json`, `tests/e2e/87-coordinator-submissions.spec.ts`.
- **New pages** under #75's coordinator dashboard: `<dash>/submissions/page.tsx`, `<dash>/submissions/[registrationNumber]/page.tsx`
  (reuses 85b's upload form component) and `<dash>/conduct/page.tsx`, with `_components/`. `<dash>` is
  `/institution/registrations/[ref]` (M1 spec) or `/institution/competitions/[ref]` (M2 spec). Adopt whatever #75 shipped.
- **Hotspots (append only):**
  - H23: entries' submitter policy gets one coordinator branch calling `coordinatorMaySubmit`. Serialize on Q2 order 85b → 87 → 86a → 86b.
  - H8: `can()` action table: `entry.submit_for_student`, `conduct.certify`, `institution_submissions.read`.
  - H31: Files access lets X's coordinator fetch derivatives of X's students' entry files.
  - H1: schema barrel line. H2: `drizzle/NNNN_87_conduct_certification.sql` + meta. H3: messages.ts, 3 lines × 2.
  - H6: seeder line. H9/H33: reuse 85b's `entry_received` map row. If its audience misses the institution route, extend the resolver
    once. H19/H27: one coordinator nav line, `app-routes.ts`. `src/server/app.ts`: one facade line.

## Design (risk-flagged; codebase-design vocabulary)
**Submit path:**
- **D1 (chosen): actor-agnostic submit.** 85b's `startEntryUpload`/`completeEntryUpload` resolve "who may act on this
  registration's entry" in one submitter policy. 87 adds one branch: `coordinatorMaySubmit(registration, scope)`. Deep: file
  rules, scan, stripping, Entry IDs, replacement, deadline and receipt are all inherited, and 86a/86b disciplines reach coordinators
  for free. Locality: the cross-institution skeptic reviews one function and its table test.
- **D2: separate `submitForStudent`/`replaceStudentFile`** wrapping entries internals. Fails the deletion test (pass-through), gives
  two interfaces to one pipeline, and wires every discipline twice.
- **D3: coordinator "acts as" the participant.** The audit shows the wrong actor. Rejected on safeguarding grounds.

Scope is checked before status, so refusals leak nothing about other institutions. Use cases map `other_institution` and
`not_school_route` to `forbidden`.

**Certification:**
- **C1 (chosen): own table** `conduct_certification`: id uuidv7, `institution_registration_id` UNIQUE FK, `certified_by_user_id` FK,
  `certified_at` timestamptz, `statement_version` text. The unique constraint enforces "once", since PGlite can't show races. Rows are
  immutable, and it touches nothing in #75's schema.
- **C2: columns on `institution_registration`.** Hits #75's hotspot and can't version the statement.
- **C3: derive from audit rows.** Gating on an append-only log is fragile and has no constraint.

**Roster** is pure (`buildSubmissionRoster`). It takes `windowOpen` from 85b's deadline rule, so there's one deadline rule, and it
throws on a foreign student or entry: a scoping bug must never render.

**Defaults** (reversible, record in PR):
- The institution admin can do whatever a coordinator can.
- Certify any time after the institution registration is confirmed, once, with no revoke in M2.
- On the school route only coordinators submit (85b's individual path refuses institution-route registrations; keep whatever
  85b chose).
- Receipt only at first `submitted`; replacement messaging follows 85b.

## Interface needs (code against these; adapt names at claim)
```ts
// 85b entries (H23)
startEntryUpload(i: { registrationId: string; title: string; description?: string; fileName: string; contentType: string; sizeBytes: number })
  : Promise<{ entryFileId: string; upload: { url: string; headers: Record<string, string>; expiresAt: Date } }>;
completeEntryUpload(i: { entryFileId: string }): Promise<{ entryId: string; code: string; status: EntryStatus; replacement: boolean }>;
type EntrySubmitterKind = "participant" | "guardian" | "coordinator";
resolveEntrySubmitter(ctx: UseCaseContext, registrationId: string): Promise<{ kind: EntrySubmitterKind; registration: RegistrationForEntry }>; // throws DomainError
listEntrySummaries(db: AppDb, registrationIds: readonly string[]): Promise<{ registrationId: string; code: string; status: EntryStatus; replacementPending: boolean }[]>;
isSubmissionWindowOpen(c: { submissionOpensAt: Date; submissionClosesAt: Date }, now: Date): boolean;
type EntryStatus = /* the 9 F2 values */; // replace domain/roster.ts's local copy with this import
// #75 registration
getInstitutionRegistration(db: AppDb, by: { reference: string } | { id: string }): Promise<{ id: string; institutionId: string; competitionId: string; reference: string; status: InstitutionRegistrationStatus } | null>;
listEnrolledStudents(db: AppDb, institutionRegistrationId: string): Promise<{ registrationId: string; studentName: string; registrationNumber: string | null; route: "institution"; status: RegistrationStatus }[]>;
// #59 / #74
can(actor: Actor, action: string, resource: { institutionId: string }): Promise<boolean>; // roles institution_coordinator | institution_admin, scope institution
AuditLog.write(tx: AppDb, e: { action: "conduct.certified"; entityType: "institution_registration"; entityId: string; before: null; after: { statementVersion: string } }): Promise<void>;
// #61 / #69 / #81
emit(tx: AppDb, e: { type: "entry.submitted"; aggregateType: "entry"; aggregateId: string; payload: { entryId: string } }): Promise<void>; // 85b emits; audience = registration's family
// #70 / #71
getCompetition(db: AppDb, id: string): Promise<{ digitalSubmissionScope: "all_participants" | "shortlist_only"; submissionOpensAt: Date; submissionClosesAt: Date }>;
```
**Exports for 89b:** `isConductCertified(db: AppDb, institutionRegistrationId: string): Promise<boolean>`,
`requireConductCertified(db: AppDb, id: string): Promise<void>` (throws `DomainError("conduct_not_certified")`).

## Residue
- **HR-36:** the conduct-certification statement wording and the entry-received copy. Ship the draft from `schools.json`.
- **HR-21:** the link to FOA's school-conduct guidelines. Use `placeholder()`.
- **HR-14:** the DLT template for the guardian SMS "entry received". SMS stays behind its flag.

## Test plan
- **Seam 1:** `src/server/modules/institution-submissions/institution-submissions.test.ts` (ACs 1–9). Fixtures: institutions X and Y; X has a minor
  with a guardian contact, an adult student, an unconfirmed student and an individual-route student at X; plus a shortlist-only
  competition. Authz is table-driven over actors × use cases.
- **Unit (done):** `domain/eligibility.test.ts` (7) and `domain/roster.test.ts` (22).
- **Seed:** `src/server/seed/seed.test.ts` gets an idempotency case. **Seam 2:** the axe spec, under Not run.

## Slices (size M → 1)
- **S1** "Coordinator submits for students, sees the roster and certifies conduct". ACs 1–10, Seam 1,
  `src/server/modules/institution-submissions/institution-submissions.test.ts`.
