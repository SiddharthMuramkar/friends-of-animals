# Unit 75b: Enrol students — participant profile, age category, encrypted fields, dashboard (#75, M1, L, risk K E)

Branch `ticket/75-enrolment`, worktree `/root/foa-wt/75b`, base `foa/M0` today (rebase onto `foa/M1` after 75a merges).
Blocker 75a (and through it 71, 74, 73, 69, 58, 59a). Sibling **75a** owns `institution_registration`, the reference,
the window rule (`registrationWindow`), the principal message and `/institution/competitions`. Downstream: #76 reuses
`parseStudentDetails` + `enrolStudent`; #77a adds `pending_payment`/`confirmed`; #78 adds `self` profiles; #81 guardians;
#83 consent. Prepped 2026-11-21 by pane foa-p75; the domain core is on the branch ("Head start").

## Scope
- **In:** `participant_profile` + `registration` (appended to 75a's `schema/registration.ts`, one migration);
  `enrolStudent`, `listEnrolledStudents` (dashboard read model), `withdrawStudent`; age group from DOB and the
  competition's cut-off; minors need guardian contact, adults their own phone; DOB, phones, emails, guardian name and
  address encrypted (#58 `encryptedText`); keyed identity hash for duplicates; registration status machine
  (`enrolled`, `withdrawn`); audit; authz; inventory rows; seed; pages `/institution/registrations/[ref]` and
  `/institution/registrations/[ref]/students/new`; Seam 2 spec.
- **Out:** CSV import (#76), fees/payment/confirmation and registration numbers (#77a), discipline/category choice
  (entries, #85), editing a student (later; withdraw + re-add covers typos while open), guardian accounts and consent
  (#81–#83), adult self profiles (#78 adds `owner_user_id` and its check).

## Acceptance checks (seam)
1. Coordinator of X, X registered (75a), window open: `enrolStudent({ reference, student })` → `{ ok: true,
   registrationId, ageGroup: { id, label } }`; one `participant_profile` (`owner_kind='institution'`,
   `managing_institution_id=X`) and one `registration` (`route='institution'`, `status='enrolled'`, the age group). (S1)
2. Age group = completed years on the competition's `age_cutoff_date`, inclusive bounds. Fixtures, groups 6–9 and
   10–13, cut-off 2027-06-01: born 2017-06-01 → 10 (10–13); 2017-06-02 → 9 (6–9); 2021-06-01 → 6; 2013-06-02 → 13;
   2013-06-01 → 14 → refused; 29 Feb 2016 with a 28 Feb 2027 cut-off → 10 (birthday on 1 Mar). (unit + S1)
3. Outside every group (too young, too old, or in a gap) → `{ ok: false, reason: "outside_age_groups", age, groups }`
   whose message reads "This competition is for ages 6–13 on 1 June 2027; this student is 14." Overlapping groups →
   `overlapping_age_groups` (staff config error). Nothing written. (unit + S1)
4. Validation (`parseStudentDetails`, shared with #76): name 2–100 after whitespace collapse; DOB `YYYY-MM-DD` or
   `DD/MM/YYYY`, real, not after today (IST), not before 1900; minor (under 18 on today's IST date) → guardian name,
   relationship (`parent` | `legal_guardian`) and phone required, own phone/email ignored and reported; adult → own
   phone required; phones via #58's E.164 normaliser; pin code `^[1-9]\d{5}$`; per-field error codes. (unit + S1)
5. Encrypted at rest: raw `select` on `participant_profile` shows ciphertext (not the plaintext) in `dob`, `phone`,
   `email`, `guardian_name`, `guardian_phone`, `guardian_email`, `address`; the dashboard and use cases still read them. (S1)
6. Duplicate: the same child (same identity hash = keyed HMAC of normalised name + DOB, or the same `student_ref`)
   already enrolled in this institution registration → `already_enrolled`; partial unique index on
   (participant_profile_id, competition_id) where status ≠ `withdrawn` backs it. Name variants "Aanya  Rao" / "aanyá rao"
   match. (unit + S1)
7. Window: before open / after close (75a's `registrationWindow`, fake clock + drain) → `not_open_yet` / `closed`;
   unknown reference → `not_found`. (S1)
8. Dashboard: `listEnrolledStudents({ reference })` → competition `{ code, name }`, reference, counts by status, and
   students `{ registrationId, fullName, grade, ageGroupLabel, status }` sorted by name; no DOB or contacts in it. (S1)
9. Status machine table: every ordered pair of `enrolled`, `withdrawn` with its cause (∅→enrolled and
   enrolled→withdrawn by coordinator while open; everything else forbidden). `withdrawStudent` after close →
   `closed`; twice → `not_enrolled`. (unit + S1)
10. Audit: one row per enrolment (`registration.student_enrolled`) and withdrawal (`registration.student_withdrawn`),
    ids only in before/after, actor + IP + UA. (S1)
11. Authz per use case: coordinator and authorised person of X pass; coordinator of Y, member, visitor refused. (S1)
12. Inventory: one row per new PD column (full_name, dob, grade, student_ref, phone, email, guardian_name,
    guardian_relationship, guardian_phone, guardian_email, address, pin_code, city, state, identity_hash) with purpose and
    `retention.toConfirm: true`. (unit, #73's test)
13. Seed: the seeded registration (75a) has 6 enrolled students across both age groups (fictional names, example.test
    emails, obviously fake +91 numbers) and 1 withdrawn; twice = same rows. Builder `h.seed.student()`. (S1)
14. axe clean light + dark on both pages (dashboard empty/filled; form blank/errors/outside-age).
    `tests/e2e/75-enrol-students.spec.ts`, written, **Not run**. (S2)

## Design (codebase-design, compared inline)
- **A. One `participant_profile` table with `owner_kind` (chosen).** Enum `participant_owner_kind` created now with
  `institution`, `self`, `guardian` (a new enum, so no F2 split; #78/#81 add their owner columns and checks). Check:
  `managing_institution_id` set iff `owner_kind='institution'`. `registration` (profile, competition, route enum
  `institution`|`individual`, `institution_registration_id` set iff route = institution, `age_group_id`, status,
  `registration_number` null for #77a). Small interface for #76–#83: one profile, one registration list across routes;
  matches the shape #78's brief already codes against (`fullName`, `ownerKind`, `registration.route/status`).
- **B. Profile core + per-route ownership link tables.** Lets one person carry several owners, but merging a school's
  record with a guardian's is the cross-controller linking HR-30 has not ruled on, and every read gains a join.
  Fails the deletion test: nothing reads the links that a nullable owner column cannot serve. Rejected.
- **C. Separate student and individual tables.** #77/#80/#85 would union two shapes forever. Rejected.
- Pure core (head start) holds the rules: `ageGroupFor(dob, cutoff, groups)`, `parseStudentDetails(raw, { today,
  normalisePhone })` (phone normaliser injected: #58 owns it), `identityKeyInput(name, dob)` (HMAC by #58's keyed
  helper with a `student-identity:` purpose prefix: no new secret), `REGISTRATION_STATUSES` + `canTransition`.
  `enrolStudent` = load → parse → classify → duplicate check → insert profile + registration + audit in one transaction.
- Stored: DOB (encrypted) and the age group; never an age. Student name stays plain (sorting, dashboard); guardian name
  encrypted. Pin code/city/state plain, defaulted from the institution.

## Interface needs (code against these; rename to what lands)
```ts
// 75a (same module)
registrationWindow(c: { status: string; registrationClosesAt: Date | null }, now: Date): "open" | "not_open_yet" | "closed" | "unpublished";
institutionRegistration: { id; institutionId; competitionId; reference; status: "active" };
// #58 encryption + phone
encryptedText(): PgCustomColumn<string>; blindIndex(normalised: string): string; normalisePhoneNumber(raw: string): string | null;
// #70a competitions
competition.ageCutoffDate: string /* YYYY-MM-DD */; competitionAgeGroup: { id; competitionId; label; minAge; maxAge; position };
// #59a: can(ctx, "registration.students.manage" | "registration.students.read", { type: "institution"; id }); writeAudit(...)
// #73: institution { pinCode, city, state }; inventory entry { table, column, purpose, retention: { period, basis, toConfirm: true } }
// Seed: h.seed.institutionRegistration() (75a), h.seed.competition({ ageGroups, ageCutoffDate })
```

## Files
- New: `src/server/modules/registration/{enrol-student, list-enrolled-students, withdraw-student}.ts` + tests,
  `src/app/institution/registrations/[ref]/{page.tsx, students/new/page.tsx, actions.ts, _components/*}`,
  `messages/en-IN/registration.json` (status labels shared with #77/#78/#81), `tests/e2e/75-enrol-students.spec.ts`.
- Touch: `src/server/db/schema/registration.ts` (append), `drizzle/NNNN_75_enrol_students.sql`, `src/server/seed/
  registration.ts`, `coordinator.json` (append `students`, `dashboard`), registration module `index.ts`.
- Head start (done, 8722468): `src/server/modules/registration/domain/{calendar-date, age-group, student-details, identity-key,
  registration-status}.ts` + tests.
- Hotspots: as 75a plus `src/server/privacy/inventory.ts` (15 rows) and `messages.ts` (new namespace). Q1 schema
  queue: `registration.ts` is shared with #76–#83.

## Residue
- HR-05: field-encryption and blind-index keys per environment (DOB, phones, addresses).
- HR-30: minors' data held for the school (joint fiduciary), guardian contact without guardian verification until #81–#83.
- HR-31: retention of the 15 new PD columns (`toConfirm: true`).

## Test plan
- Unit (done): calendar/age boundary table (cut-off day, ±1 day, 29 Feb), age-group classification incl. gaps and
  overlaps, `parseStudentDetails` table (minor/adult, both date spellings, every error code), name normalisation,
  status-machine pair table.
- Seam 1: one file per slice; raw SQL for ciphertext; audit rows by action; authz tables.
- Seam 2: one spec, two pages, `expectRendersAccessibly` light + dark; Not run.

## Slices
1. Enrol one student: schema + migration + `enrolStudent` (validation, age group, encryption, duplicates, window,
   audit, authz). `src/server/modules/registration/enrol-student.test.ts` (ACs 1–7, 10, 11)
2. Dashboard + withdraw: `listEnrolledStudents`, `withdrawStudent`, status table at the seam.
   `src/server/modules/registration/enrolled-students.test.ts` (8, 9, 10, 11)
3. Seed + inventory: seeder, builder, 15 inventory rows. `src/server/seed/registration.test.ts` (12, 13)
4. Pages, messages, Seam 2 spec. `tests/e2e/75-enrol-students.spec.ts` (14)
