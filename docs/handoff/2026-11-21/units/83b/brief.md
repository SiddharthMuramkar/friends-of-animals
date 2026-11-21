# Unit 83b: guardian consent by signed form, reviewed by FOA (#83, M1)

Branch `ticket/83-signed-form`, worktree `/root/foa-wt/83b`, base `foa/M0` today (rebase onto `foa/M1` at build). L,
risk `A K` (staff review, minors' signed forms as private files). Blockers 63a, 82 (and through 82: 81b, 81a, 78,
77a, 75b, 74, 72, 69, 64; 60 for staff screens). Sibling **83a** (code link) runs in parallel.
Phase A on the branch: `07fdd9e M1 #83: Add signed-form review and public-use domain core` (pure, 26 tests).

## Scope
**In (83b):** the coordinator uploads a scan of a signed paper form per student per competition as a private file
(63a, purpose `consent_form`), records which public uses the guardian ticked and submits it; it counts for nothing
until an FOA admin accepts it. Coordinator may withdraw a pending form and submit a new one after a rejection.
FOA queue `/admin/consent-forms` and detail `/admin/consent-forms/[id]` (scan through 63a's signed delivery):
accept → one consent event per ticked use, method `paper_form` ("signed form"), reviewer named; reject with a reason
→ no consent, the coordinator sees why. **The public-use gate (AC3)**: the institution's declaration covers
participation and judging; each public use needs a code link, an accepted form or the guardian's own account
(`decideSchoolRouteUse`, wired into #82's `canUse` for school-route subjects). The participation declaration if #75
didn't record one. Form state on the coordinator dashboard; inventory; seed; `adminConsentForms` namespace.
**Out (83a owns):** links, the public token page, one-time codes, the dashboard page itself and `listStudentConsents`.
**Out (others):** printable form generation (HR-33; Gotenberg is M4), magic-byte sniff and scan (63b), consumers
that publish work (#103, #104, #131 call `canUse`).

## Acceptance checks (seam)
1. **Upload and submit.** `as(coordinatorOfX).requestConsentFormUpload({ registrationId, studentId, contentType:
   "application/pdf", sizeBytes })` → 63a upload URL (purpose `consent_form`); `h.storage.put`; `completeUpload`;
   `submitConsentForm({ registrationId, studentId, fileId, uses: ["public_display", "auction"] })` → form
   `pending_review`, documents pinned (current version per ticked use), audit `consent_form.submitted`. Refusals,
   nothing written: `file_not_uploaded`, `file_unavailable` (quarantined), `not_offered`, `no_uses`,
   `review_pending` (one pending per student and competition), a file the coordinator doesn't own → `forbidden`, a
   file already on a form → `file_in_use`. **S1**
2. **Pending counts for nothing.** While pending: no consent event rows; `canUse` false for every public use. **S1**
3. **Accept.** `as(staffAdmin).reviewConsentForm({ formId, decision: "accept" })` with a clean scan → one `given`
   event per ticked use: method `paper_form`, `reviewer_user_id` = the admin, `consent_form_id`, subject, competition,
   pinned document; form `accepted` with `reviewed_by/at`; audit `consent_form.accepted`; `canUse` true for ticked
   uses, still false for unticked. Scan not `clean` → `file_not_clean`; reviewed twice → `not_pending`. **S1**
4. **Reject.** `reviewConsentForm({ formId, decision: "reject", reason: "not_signed" })` → `rejected`, no event,
   audit; `other` without a note → `note_required`; one outbox `consent.form_reviewed` → after drain the uploading
   coordinator has an inbox item (#69 map row). A new form may then be submitted. **S1**
5. **Withdraw.** `withdrawConsentForm({ formId })` pending → `withdrawn`; reviewed → `not_pending`. **S1**
6. **Queue.** `listConsentFormsForReview({ status: "pending_review" })` → oldest first, with institution, competition,
   student first name + initial, uses, scan status; `getConsentFormForReview({ formId })` adds the pinned documents
   and a download URL via 63a `getFileDownloadUrl` (a staff read writes 63a's `file.read` audit row). **S1**
7. **Public-use gate (AC3).** School-route student, declaration recorded: participation and judging allowed with no
   guardian consent; each public use refused (`no_guardian_consent`), allowed after an accepted form (and after 83a's
   link, once landed); `staff_recorded` never counts; a withdrawal refuses again. Pure table (**done**) + **S1** via `canUse`.
8. **Authorization, every new use case.** upload/submit/withdraw: coordinator or authorised person of the student's
   institution passes; another institution's coordinator, a member, a visitor → `forbidden`. list/get/review:
   `staff_admin` (and `super_admin`) pass, with #60's fresh second factor if it sits in `can()`; the student's own
   coordinator → `forbidden` ("a coordinator cannot accept a form"); a staff admin who uploaded it → `own_upload`. **S1**
9. **Inventory** rows (below). **Vitest** 10. **Seed**: one accepted, one pending and one rejected form on the seeded
   school registration (file rows `clean`); idempotent. **S1**
11. **Pages, axe light + dark:** `/admin/consent-forms` (queue, empty), `/admin/consent-forms/[id]` (pending,
    accepted, rejected, reject form errors), the coordinator upload control and form column. **S2**
    `tests/e2e/83-signed-form-consent.spec.ts`, written, **Not run**.

## Files
- **New:** `src/server/modules/consent-forms/domain/review.ts` + `src/server/modules/consent/domain/public-use.ts`
  (**done**); `consent-forms/{index,submit,review,queue,repository}.ts` + tests; `src/server/db/schema/consent-forms.ts`;
  custom migration `83_pre_file_purpose_consent_form` (`ALTER TYPE "file_asset_purpose" ADD VALUE IF NOT EXISTS
  'consent_form';`) then generated `83_consent_forms`; `src/server/seed/consent-forms.ts`;
  `src/app/(staff)/admin/consent-forms/{page.tsx,[id]/page.tsx,_components/*,actions.ts}` (route group per 59b);
  `messages/en-IN/adminConsentForms.json`; `tests/e2e/83-signed-form-consent.spec.ts`.
- **Touch:** `app.ts`, schema barrel, `seed/index.ts`, `src/i18n/messages.ts`, `app-routes.ts`, `can()` table, 63a's
  purpose registry (`consent_form`: pdf/jpeg/png, 10 MB, all environments), #69 map seed (`consent_form_reviewed`),
  inventory; #82's `canUse` (add the school-route branch calling `decideSchoolRouteUse`).
- **Hotspots:** #82's consent event table: add `consent_form_id` (FK), `reviewer_user_id` (FK), check `consent_form_id
  IS NULL OR (method = 'paper_form' AND reviewer_user_id IS NOT NULL)`, and the **same** `giver_user_id` nullable edit
  as 83a. #75's registration table only if it has no declaration (below). Dashboard page: add the "Signed form" column
  + upload control after 83a lands (or 83a adds it if this lands first); `coordinatorConsents.json` extended then.

## Design
Compared (codebase-design): **(a) a `consent_form` submission with its own review machine; consent events written
only on accept (chosen)**; (b) write consent events at upload with an `evidence_status` that review flips (old SPEC
§12.3). (b) needs mutable rows in #64's append-only log and makes every gating read remember to filter pending and
rejected evidence: a shallow interface with a trap. (a) keeps "a consent event is consent that counts", and review is
one pure decision (`decideReview`). Who ticks uses: the coordinator records them at submit; the reviewer accepts as
recorded or rejects `uses_unclear` (one responsibility each, auditable). Table `consent_form`: id,
participant_profile_id, competition_id, institution_registration_id, file_asset_id unique, uses `consent_purpose[]`,
documents jsonb (purpose → documentId), status `consent_form_status`, uploaded_by_user_id, submitted_at,
reviewed_by_user_id, reviewed_at, rejection_reason `consent_form_rejection_reason`, rejection_note, withdrawn_at,
timestamps; partial unique `(participant_profile_id, competition_id) WHERE status = 'pending_review'`.
Gate: `decideSchoolRouteUse` is the rule; #82's `canUse` loads the current consent (with method) and the
declaration and calls it when the profile's `owner_kind = 'institution'`. Declaration: read #75's; if #75 recorded
none, add `participation_declared_at` + `participation_declared_by_user_id` to the institution registration and a
`declareParticipation({ registrationId })` control on the dashboard (null = not declared; nothing gates on it in M1).
Defaults (write in the PR): reviewers `staff_admin`/`super_admin`; submit allowed while the scan runs, accept only
`clean`; a later accepted form or link supersedes earlier answers by time; rejection notes must not hold PD.

**Interface needs (code against these; rename to what landed):**
```ts
// 63a files
requestUpload(i: { purpose: "consent_form"; contentType: string; sizeBytes: number }): Promise<{ ok: true; fileId: string; uploadUrl: string; headers: Record<string, string>; expiresAt: Date } | { ok: false; reason: string }>;
completeUpload(i: { fileId: string }): Promise<{ ok: true } | { ok: false; reason: string }>;
getFileDownloadUrl(i: { fileId: string }): Promise<{ ok: true; url: string; expiresAt: Date } | { ok: false; reason: string }>;
fileAsset: { id; ownerUserId; purpose; status: FileStatus };  FILE_PURPOSES: Record<FilePurpose, { types: string[]; maxBytes: number; envs: AppEnv[] }>;
// 75a/75b
institutionRegistration: { id; ref; institutionId; competitionId; declaredAt?: Date | null }; participantProfile: { id; ownerKind: "institution" | "self" | "guardian" };
// 59a / 60
can(ctx, action: "consent_form.submit" | "consent_form.withdraw", r: { type: "institution"; id: string }): Promise<boolean>;
can(ctx, action: "consent_form.review" | "consent_form.read"): Promise<boolean>;  // global staff_admin | super_admin
writeAudit(tx, ctx, e: { action: string; entityType: "consent_form"; entityId: string; before: unknown; after: unknown }): Promise<void>;
// 82
offeredPublicUses(db, competitionId: string): Promise<{ purpose: PublicUse; documentId: string; version: number; title: string }[]>;
recordConsentEvent(tx, ctx, e: { subject: { type: "participant_profile"; id: string }; competitionId: string; purpose: string;
  documentId: string; action: "given"; method: "paper_form"; giver: { kind: "signed_form"; consentFormId: string; reviewerUserId: string } }): Promise<{ id: string }>;
canUse(db, q: { subject: { type: "participant_profile"; id: string }; competitionId: string; use: Use }): Promise<UseDecision>;
// 61a / 69
emit(tx, e: { type: "consent.form_reviewed"; aggregateType: "consent_form"; aggregateId: string; payload: { formId: string } }): Promise<void>;
```

## Residue
HR-33 (printable signed form template, and copy); HR-34 (who reviews and turnaround; default staff admins, no SLA
in code); HR-30 (a signed form as verifiable parental consent; school as joint fiduciary); HR-31 (retention below);
HR-32 (safeguarding sign-off of the signed-form flow; gates the M1 release PR only). Inventory:
`consent_form.file_asset_id` (signed scan with the guardian's name and signature; life of the consent it evidences +
3 years), `consent_form.rejection_note` (staff note, no PD by rule; with the form), `consent_event.reviewer_user_id`
(accountability; with the consent record). All `toConfirm`.

## Test plan
Pure (**done**): `review.test.ts` (submit, accept, reject, withdraw tables), `public-use.test.ts` (declaration ×
consent status × method). Seam 1 on `createHarness()` with 63a's `FakeStorage`, file status set to `clean` directly
where 63b hasn't landed, drain, fake clock, 75b/82 builders. Seam 2 written, Not run (no Postgres; seeded scans have
no stored object, so the preview detail page shows "scan unavailable").

## Slices
1. **Upload and submit** (ACs 1, 2, 8). Schema, both migrations, purpose registry, `requestConsentFormUpload`,
   `submitConsentForm`, `withdrawConsentForm`. Test `src/server/modules/consent-forms/submit.test.ts`.
2. **Review: accept and reject** (3, 4, 5, 8). `reviewConsentForm`, consent event columns, map row.
   Test `consent-forms/review.test.ts`.
3. **Public-use gate and declaration** (7). `canUse` school-route branch. Test `src/server/modules/consent/school-route-use.test.ts`.
4. **Queue, seed, inventory** (6, 9, 10). Test `consent-forms/queue.test.ts` + `src/server/seed/consent-forms.test.ts`.
5. **Admin pages, dashboard column, Seam 2** (11). Test `tests/e2e/83-signed-form-consent.spec.ts`.

## Built in phase A (07fdd9e, pushed, no PR)
`consent-forms/domain/review.ts`: `decideSubmit`, `decideReview`, `decideWithdraw`, `FORM_STATUSES`,
`REJECTION_REASONS`, `REJECTION_NOTE_MAX`. `consent/domain/public-use.ts`: `PUBLIC_USES` (mirrors #82's list; switch
to #82's export when it lands), `isPublicUse`, `decideSchoolRouteUse`.
