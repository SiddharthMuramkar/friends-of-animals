# Unit 123: volunteer applications (age gate, guardian approval, vetted approval grants `volunteer`)

Issue #123 · M6 · L · flags `A K E F2` · no conflict key · blocked by **81b** and **114** (through them 81a, 78, 75, 69,
64, 62, 61a, 60, 59a, 57). Branch `ticket/123-volunteer-applications`, worktree `/root/foa-wt/123`, cut from `foa/M0`
442dd99: rebase onto `foa/M6` at build. No siblings: unit 123 is the whole issue. #124 (tasks, hours, certificates) builds on it.

## Scope
**In:** the first part of the **Volunteers** module. A signed-in member applies (interests from the six areas, weekly
availability + note ≤ 280, both declarations accepted as #64 consents). Age from the date of birth on the IST date of
`clock.now()`: under `volunteers.minAgeYears` (14) refused, nothing written; under `volunteers.guardianApprovalBelowAgeYears`
(18) held `awaiting_guardian` until a verified guardian approves or declines; adults go straight to `submitted`. A community
manager approves (step-up; both declarations current; grants global `volunteer` through 59a's audited grant path) or
declines with a reason. Applicant or guardian may withdraw an open application. Events + message routes, settings,
inventory rows + retention policy, preview seed, six pages, `volunteer` namespace.
**Out:** tasks, hours, certificates, volunteer milestone (#124/#119); revoking the role (59b's role screen); police
verification (HR-38, process); asking a guardian who isn't linked yet (81b's request flow is registration-bound: we refuse
`guardian_required` and the page explains how to get linked); background-check records; SMS sends (HR-14, flag off).

## Acceptance checks (seam)
1. **Under 14 refused.** DOB giving 13 y 364 d on the fake clock's IST date → `under_min_age`; no application, consent,
   outbox or audit row. Exactly 14 today → accepted. 29 Feb DOB counts from 1 Mar (78's `ageAt`). Settings bounds hold
   (min 13–18, guardian 18–21; a bad stored value only makes the rule stricter). **Pure (done) + S1**
2. **14–17 waits for the guardian.** Linked teen (81a) with a verified active guardian → `awaiting_guardian`, outbox
   `volunteer.guardian_approval_requested`; after `h.drain()` the guardian gets the message (81b's `guardian_of_participant`).
   `as(guardian).decideAsGuardian({ applicationId, decision: "approve" })` → `submitted`, `guardian_user_id` +
   `guardian_decided_at` set, audit `volunteer.guardian_decided`; `"decline"` → `guardian_declined`. Teen with no or an
   unverified guardian → `guardian_required`, nothing written. **S1**
3. **Approval needs both declarations and grants `volunteer`.** `as(cm).approveVolunteer({ applicationId })` refused,
   nothing changed, when either consent is never given / withdrawn (`*_missing`), given on a superseded version after the
   document is republished (`*_outdated`), or no version is published (`*_unpublished`). With both current: `approved`,
   `safeguarding_consent_id` + `conduct_consent_id` + `decided_by/at` stored, `user_role` (volunteer, global) exists, audit
   `volunteer.application_approved` and 59a's `role.granted` (actor = the CM, role `community_manager`), outbox
   `volunteer.application_approved`. Session second factor older than the step-up window → `step_up_required`. **S1**
4. **Decline / withdraw.** `declineVolunteer({ applicationId, reason })` (trimmed, 1–500) → `declined`, reason stored, outbox
   `volunteer.application_declined`; applicant or guardian `withdrawVolunteerApplication` → `withdrawn`. One open application
   per person (partial unique index); re-applying after a closed one works; an approved volunteer → `already_volunteer`. **S1**
5. **Transition table** for `volunteer_application_status`: every status × event (pure, **done**), and S1 shows use cases
   refuse a forbidden move (`approveVolunteer` on `awaiting_guardian` → `invalid_transition`). **Pure + S1**
6. **Authorization, every use case:** apply — member allowed, visitor refused; decideAsGuardian — the applicant's verified
   guardian allowed, another child's guardian and the teen refused; approve/decline — community_manager (and super_admin)
   allowed, member, volunteer, staff_admin refused; list/get — CM allowed, member refused, applicant reads own only;
   withdraw — applicant and their guardian allowed, another member refused. Refusals write nothing. **S1**
7. **Encrypted DOB:** raw SQL shows no plaintext `date_of_birth` on `volunteer_application` (#58's `encryptedText`). **S1**
8. **Inventory + seed + axe.** Every new column classified (114's coverage test passes); seed: an approved adult volunteer,
   a `submitted` adult, the seeded teen's `awaiting_guardian` application under 81a's guardian, placeholder documents for both
   purposes (non-production only); idempotent. `expectRendersAccessibly` light + dark on all six pages. **Vitest + S1 + S2 (Not run)**

## Files
- **Done (prep):** `src/server/modules/volunteers/domain/{application-status,eligibility,approval,application-input}.ts` + tests.
- **New:** `src/server/db/schema/volunteers.ts`; custom `123_pre_volunteer_consent_purposes` (`ALTER TYPE "consent_purpose"
  ADD VALUE IF NOT EXISTS` ×2, no DDL uses them, F2) then generated `123_volunteer_applications`;
  `src/server/modules/volunteers/{apply,guardian-decision,review,withdraw,events,policy,index}.ts` + Seam 1 tests;
  `src/server/seed/volunteers.ts`; `messages/en-IN/volunteer.json`; pages `src/app/volunteer/{page.tsx,apply/}`,
  `src/app/dashboard/volunteer/`, `src/app/guardian/children/[id]/volunteer/`, `src/app/(staff)/admin/volunteers/applications/
  {page.tsx,[applicationId]/}` (+ `_components/`, `actions.ts`); `tests/e2e/123-volunteer-applications.spec.ts`.
- **Hotspots (append only):** H1 schema barrel; H2 `drizzle/meta/*` (merge queue); H3 `src/i18n/messages.ts`; H4 `src/lib/routes.ts`
  + `nav.json` (public `/volunteer`, sitemap test); `src/lib/app-routes.ts`; `src/server/app.ts` (`volunteersUseCases`); H5 114's
  inventory + policy registry; H6 seed index; H7 #62 catalogue (2 keys); H8 59a policy (`VOLUNTEER_POLICY`); H9 61a event union +
  #69 route/template seed; H16 64's `purposes.ts` (`CONSENT_PURPOSES`, `GIVABLE_PURPOSES`); H19 dashboard/admin/guardian nav links.
- Routes differ from issues-M6 on purpose: 81a put guardian pages under `/guardian/children/[id]`, so the guardian page is
  `/guardian/children/[id]/volunteer`, not `/dashboard/children/[childId]/volunteer`.

## Design (codebase-design, compared in context; risk-flagged)
- **(a) Application-centric state machine, guardian as a sub-state (chosen).** One `volunteer_application` row; status
  carries `awaiting_guardian`/`guardian_declined`; depth sits in four pure modules (start decision, transition table, approval
  preconditions, input normalisation) behind seven thin use cases. "Can't approve before the guardian" is the table itself:
  `approved` is reachable only from `submitted` (tested).
- **(b) Separate `guardian_approval` request entity** reusable by #125/#130: a second state machine, a cross-entity event to
  move the application, and one caller today — a hypothetical seam (one adapter). Fails the deletion test now; extract it
  when #125 or #130 brings a second caller.
- **(c) Reuse 81a's `guardian_invitation` with a new kind:** that table is a contact/token invitation; an in-app decision
  needs neither, and it adds an enum value to 81a's kind (F2). Rejected.
- **Reversible defaults (write in the PR):** DOB comes from the applicant's participant profile when one exists (guardian-
  entered for teens, so a linked 13-year-old can't type an older date); otherwise typed and stored encrypted on the
  application. Declarations are accepted at apply in the same transaction (#64 `giveConsent`, method `web_form`); if a
  document is republished before approval, the applicant re-accepts from `/dashboard/volunteer` with #64's `giveConsent`.
  A 14–17 applicant accepts both declarations themselves; the guardian's approval is the parental consent. Any verified
  active guardian may decide; the deciding one is recorded. A guardian may withdraw while open; after approval the role is
  revoked only via the role screen (HR-30/HR-55 question). No cooling-off before re-applying. Production has no documents
  until FOA publishes, so approvals refuse `*_unpublished` there (fail closed); placeholders are seeded outside production only.

**Interface needs (code against these; rename to what landed):**
```ts
// 57a: UseCaseContext = Deps & { actor }; composeUseCases; createHarness(): h.as/h.clock/h.db/h.seed; uuidv7(at)
// 78:  ageAt(dob: CalendarDate, at: Date): number; parseDateOfBirth(text: string, at: Date): CalendarDate | null
// 75/78/81a: participantProfile { id; ownerKind; ownerUserId: string | null; loginUserId: string | null; dob: encryptedText }
//   profileOfLoginUser(db: AppDb, userId: string): Promise<{ id: string; dob: CalendarDate | null } | null>
// 58:  encryptedText(): PgCustomColumn<string>
// 81a: activeGuardiansOf(db: AppDb, profileId: string): Promise<{ guardianId: string; userId: string; verified: boolean }[]>
//      isActiveGuardianOf(db: AppDb, userId: string, profileId: string): Promise<boolean>; h.seed.guardian({ children })
// 81b: AudienceResolver "guardian_of_participant" (minorAudience) — messages about the teen reach the guardian
// 59a: authorize(ctx, action: VolunteerAction, resource?: Resource): Promise<{ role: Role | null }> // throws forbidden
//      applyRoleGrant(tx: AppDb, ctx: UseCaseContext, g: { userId; role: "volunteer"; scope: { type: "global" } },
//        audit: { actorRole: Role | null }): Promise<void>   // the internal step grantRole uses; extract it if only the use case exists
//      recordAudit(tx, ctx, { action; entity: { type; id }; before; after; actorRole }): Promise<void>
//      rolesOf(db: AppDb, userId: string): Promise<readonly Grant[]>
// 60:  policy rule flag secondFactor: "step-up" on "volunteer.application.approve"; can() refuses step_up_required
// 62:  integerSetting({ default, min, max, unit: "years" }); readSetting(db, "volunteers.minAgeYears" | "volunteers.guardianApprovalBelowAgeYears")
// 64:  CONSENT_PURPOSES / GIVABLE_PURPOSES += "volunteer_safeguarding_declaration", "volunteer_code_of_conduct"
//      giveConsent(tx-aware: { purpose; documentId }); currentConsentDocument({ purpose }): Promise<{ id } | null>
//      currentConsentFor(db, { subjectType: "user"; subjectId; purpose }): Promise<ConsentState>  // the fold, as domain/approval's ConsentState
// 61a: emit(tx, clock, { type: "volunteer.application_submitted" | "volunteer.guardian_approval_requested"
//        | "volunteer.application_approved" | "volunteer.application_declined"; aggregate: { type: "volunteer_application"; id }; payload: { applicationId } })
// 69:  message_route seed rows + templates (email + in_app): volunteer_guardian_approval_request, volunteer_application_received,
//      volunteer_application_approved, volunteer_application_declined; audiences volunteer_applicant, community_managers (in-app)
// 114: inventory entries { table, column, category, subject, purpose, retention: { policy, period, basis, toConfirm: true }, onExpiry };
//      RetentionPolicy "closedVolunteerApplications" (delete 365 d after decided_at; guardian_declined/declined/withdrawn)
```
Table `volunteer_application`: id uuidv7, applicant_user_id → user, participant_profile_id null, date_of_birth enc null,
interests `volunteer_interest[]`, availability jsonb (domain schema), status `volunteer_application_status`, guardian_user_id
null, guardian_decided_at null, safeguarding_consent_id / conduct_consent_id null → consent_event, decided_by_user_id null,
decided_at null, decline_reason null, created_at, updated_at; partial unique (applicant_user_id) WHERE status IN
('awaiting_guardian','submitted'); enums built from the domain arrays in the same migration (CREATE TYPE, no F2 issue).
Use cases: `applyToVolunteer`, `myVolunteerApplication`, `decideAsGuardian`, `withdrawVolunteerApplication`,
`approveVolunteer`, `declineVolunteer`, `listVolunteerApplications`, `getVolunteerApplication`.

## Residue
- **HR-55:** DSL + counsel approve the safeguarding declaration and code-of-conduct text (placeholders "To be confirmed", non-production only).
- **HR-38:** police verification of volunteers working in person (process, not code).
- **HR-57:** confirm 14+ and guardian approval under 18 (the settings defaults).
- **HR-56:** copy of the four volunteer messages. **HR-14:** DLT templates if SMS is enabled for them (off).
- **HR-31:** retention of the new PD columns (365 d after closure, approved while the role is held + 1 y), `toConfirm`.
- **HR-30:** teen accepts the declarations; guardian approval as parental consent; guardian withdrawal after approval.

## Test plan
- **Pure (done, 62 tests):** `application-status.test.ts` (full 6×5 table, nothing returns to `awaiting_guardian`, `approved` only
  from `submitted`), `eligibility.test.ts` (boundaries, refusal order, settings, bounds), `approval.test.ts` (missing / withdrawn /
  outdated / unpublished, order), `application-input.test.ts` (interests, slots, note, decline reason).
- **Seam 1** on `createHarness()` with 81a's guardian seed, 59a's role seed, 60's `h.stepUp`, `h.drain()`; Seam 2 written, Not run.

## Slices
1. **Apply: age gate, DOB, guardian hold, declarations** (ACs 1, 2-start, 4-unique, 6-apply, 7). Schema, both migrations,
   settings keys, consent purposes. Test `src/server/modules/volunteers/apply.test.ts`.
2. **Guardian decides; withdraw** (2, 4-withdraw, 5, 6). Test `src/server/modules/volunteers/guardian-decision.test.ts`.
3. **Community manager approves (step-up, role grant) or declines; list/get** (3, 4-decline, 5, 6). Test
   `src/server/modules/volunteers/review.test.ts`.
4. **Messages** (2-notify, 3/4 outcomes): events, route rows, templates. Test `src/server/modules/volunteers/volunteer-messages.test.ts`.
5. **Inventory, retention policy, seed, pages, Seam 2** (8). Test `src/server/seed/volunteers.test.ts` +
   `tests/e2e/123-volunteer-applications.spec.ts`.

## Head start landed (prep)
`b84a5d4` on `ticket/123-volunteer-applications` (from `foa/M0`, no PR): the four domain modules above.
`decideVolunteerApplication({ applicant: { ageYears, guardian, isVolunteer, hasOpenApplication }, rules })`,
`transitionVolunteerApplication(from, event)`, `decideVolunteerApproval({ status, safeguardingDeclaration, codeOfConduct })`,
`volunteerInterestsSchema`, `availabilitySchema`, `declineReasonSchema`. Feed ages from 78's `ageAt` once on trunk.
