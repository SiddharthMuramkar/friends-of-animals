## 6. Competitions, Registration, Submission & Physical Artwork

This section covers source Phases 1–5, 7, 8 and 14, plus end-to-end steps 1–4, 6, 10 and 11. It uses the §3.4 core entities and the §3.5 enums `CompetitionStatus`, `Discipline`, `ParticipationRoute`, `DigitalSubmissionScope`, `EntryStatus` and `PhysicalArtworkStatus` verbatim. Every status change follows §0 inside one transaction: policy check, then transition check, then `AuditLog`, then an `Outbox` event. Code lives in `src/server/domain/{competitions,institutions,registrations,entries,artwork}`.

**Terms.** **CM** = `COMPETITION_MANAGER`, global or scoped to one competition. **SA** = `STAFF_ADMIN`. SUPER_ADMIN includes SA. **Owner** of a registration and its entries and artwork: INDIVIDUAL route: `Registration.accountHolderUserId`, which is the adult participant or the guardian of a minor. INSTITUTION route: any `INSTITUTION_ADMIN` or `INSTITUTION_COORDINATOR` of `Registration.institutionId`.

**Deviations from the source.**
- **D6-1 Login.** The source says "Login — FOA Participant ID + Competition Registration Number". Registration numbers appear on receipts, emails and school lists, so they can't be secrets. This spec uses Participant ID, email or phone as the identifier, plus an OTP sent to the account holder's verified channel (6.5.4). A registration number is never a credential.
- **D6-2 Age category.** The source treats "age category" as user input. Here it is computed from DOB and the cutoff date (§3.2) and shown read-only.
- **D6-3 Physical collection.** Following the source note "MOVE THIS HERE", Phase 5 collection happens after FOA verifies the digital entry. Phases 5, 8 and 14 form one track (6.10).

### 6.1 Hand-offs

| Concern | Owner | Contract |
|---|---|---|
| School-level judging and shortlisting | §7 | Calls `EntryService.applySchoolShortlist()` once per category when it finalizes a school round. In SHORTLIST_ONLY it MAY call `EntryService.createShortlistedEntry()` (6.9). On a school-round reopen it calls `EntryService.revertSchoolShortlist()` (6.9 row 16). §7 `finalizeSchoolRound` is the sole emitter of `schoolShortlist.finalized` |
| FOA judging | §7 | Moves FOA_VERIFIED → IN_JUDGING. A round with `requiresPhysicalVerified` filters on `ArtworkService.physicalReady(entryId)` |
| RESULTS_PENDING_APPROVAL, RESULTS_PUBLISHED | §7 | Calls `CompetitionService.transition()` and sets `Competition.resultsPublishedAt` |
| Fees and refunds | §8 | §6 calls `PaymentService.createOrder` and `PaymentService.recordOfflinePayment`, and consumes `payment.captured` / `payment.failed` with `refType = 'RegistrationPaymentBatch'`. Refunds are requested from §8 by CM/SA and approved by FINANCE |
| LISTED_FOR_AUCTION, SOLD | §8 | `ArtworkService.setAuctionState(artworkId, status)` |
| Consents, guardian verification, `PendingRegistration` | §12 | `ConsentService.has/require`. §6 re-evaluates registrations on `consent.granted`, `consent.withdrawn` and `guardian.verified` |
| Messages, reminders, bulk announcements | §10 | Events in 6.13. The `reminder.*` jobs and the `Announcement` builder (§10.6) belong to §10 |
| Participation certificates | §7 | Issued from CONFIRMED `Registration`s, not from entries. In SHORTLIST_ONLY most school students have no Entry |

### 6.2 Data Model

Every model also has `id String @id` (UUIDv7), `createdAt` and `updatedAt`. Money follows §3.2. The §3.4 entities (`Institution`, `InstitutionMember`, `ParticipantProfile`, `Guardian`, `FileAsset`) are not changed. Fields are joined with `;` here only to save space; the Drizzle schema (§3) puts one column per line.

```prisma
enum ConductMode { PHYSICAL_AT_INSTITUTION ONLINE INDEPENDENT }
enum RegistrationStatus { PENDING_CONSENT PENDING_PAYMENT CONFIRMED WITHDRAWN CANCELLED }
enum InstitutionRegistrationStatus { PENDING_INSTITUTION_VERIFICATION ACTIVE WITHDRAWN CANCELLED }
enum RegistrationPaymentBatchStatus { OPEN PAID EXPIRED FAILED NEEDS_REVIEW CANCELLED }
enum StudentImportStatus { VALIDATING PREVIEW COMMITTING COMPLETED FAILED DISCARDED }
enum EntryFileRole { PRIMARY ADDITIONAL_VIEW HIRES_SCAN ESSAY_DOCUMENT VIDEO }
enum EntryRejectionReason { AGE_INELIGIBLE WRONG_CATEGORY OFF_THEME FILE_UNUSABLE CONSENT_MISSING DUPLICATE NOT_ORIGINAL PHYSICAL_NOT_RECEIVED PHYSICAL_MISMATCH OTHER }
enum DeclarationKind { CONDUCT_CERTIFICATION ENTRY_ORIGINALITY_SELF ENTRY_ORIGINALITY_INSTITUTION ARTWORK_DISPATCH SCHOOL_JUDGING /* §7 */ }
enum PhysicalRequestReason { JUDGING EXHIBITION AUCTION ARCHIVE }
enum ArtworkDiscrepancyType { NOT_MATCHING_DIGITAL LABEL_MISSING_OR_WRONG CREATOR_MISMATCH DAMAGED CONSENT_DOCS_MISSING OTHER }
enum ArtworkCondition { EXCELLENT GOOD FAIR DAMAGED }
enum ArtworkReturnPolicy { RETURN_AFTER_RESULTS RETAIN_UNLESS_REQUESTED RETAIN }
enum PrizeType { CERTIFICATE_ONLY TROPHY MEDAL CASH VOUCHER OTHER }

model Competition {
  code String @unique /* §3.1, immutable after publish */; slug String @unique; name String; theme String
  welfareMessageHtml String; descriptionHtml String; rulesHtml String; conductGuidelinesHtml String; judgingCriteriaSummary String
  packagingInstructionsHtml String?; permittedMaterials String?; durationMinutes Int?; helpContact String; coverAssetId String?
  status CompetitionStatus @default(DRAFT); autoAdvance Boolean @default(true)
  eligibleCountries String[] @default(["IN"]); eligibleInstitutionTypes String[] /* Institution.type; empty = all */
  ageCutoffDate DateTime @db.Date   // default for new AgeGroups (§3.2)
  registrationOpensAt DateTime; registrationClosesAt DateTime; confirmationDeadline DateTime /* default conductStartsAt */
  conductStartsAt DateTime; conductEndsAt DateTime; submissionOpensAt DateTime; submissionClosesAt DateTime
  shortlistSubmissionClosesAt DateTime? /* required iff INSTITUTION route */; lateGraceMinutes Int @default(0); instructionsPublishedAt DateTime?
  digitalSubmissionScope DigitalSubmissionScope @default(ALL) /* institution route only */; schoolShortlistSize Int @default(5) /* per inst. reg × category */
  maxCategoriesPerParticipant Int @default(1)
  physicalTopN Int?                  // school route: schoolRank ≤ N → physical request on FOA_VERIFIED; null = none
  individualPhysicalRequired Boolean @default(true); physicalFacilityId String?; physicalDispatchDays Int @default(14)
  artworkReturnPolicy ArtworkReturnPolicy @default(RETAIN_UNLESS_REQUESTED); returnRequestWindowDays Int @default(30)
  allowPublicDisplay Boolean @default(true); allowAuction Boolean @default(false)
  collectsGender Boolean @default(false) /* §12.2 */; awardScheme AwardScheme /* default for the final round; §7 rounds may override it */
  extraRequiredConsentTypes ConsentType[] @default([])   // on top of the §12.4 registration set
  archiveAfterDays Int @default(180); publishedAt DateTime?; resultsPublishedAt DateTime?; cancelledAt DateTime?; cancelReason String?; createdByUserId String
}
model CompetitionRoute {   // row present = route allowed. Payer: INSTITUTION → institution in bulk; INDIVIDUAL → Owner
  competitionId String; route ParticipationRoute; conductMode ConductMode; currency String @default("INR")
  feeBaseMinor Int @default(0); feeAdditionalCategoryMinor Int @default(0); @@id([competitionId, route])
}
model AgeGroup { competitionId String; label String; minAge Int; maxAge Int; ageCutoffDate DateTime @db.Date; sortOrder Int }
model CompetitionCategory {
  competitionId String; discipline Discipline; ageGroupId String; code String; name String; enabled Boolean @default(true)
  maxEntriesPerParticipant Int @default(1); physicalEligible Boolean /* default true: DRAWING, PAINTING, ART, CRAFT */; fileRules Json? /* 6.8.3 */
  @@unique([competitionId, discipline, ageGroupId]) @@unique([competitionId, code])
}
model CompetitionPrize { competitionId String; categoryId String?; level JudgingLevel; prizeType PrizeType; awardLabel String; description String; quantity Int @default(1); cashAmountMinor Int?; currency String?; sortOrder Int }
model FoaFacility { code String @unique; name String; addressLine1 String; addressLine2 String?; city String; state String; pinCode String; country String; contactName String; contactPhone String; active Boolean }
model InstitutionApplication {   // one per verification cycle; §3.4 Institution unchanged
  institutionId String; kind String /* INITIAL | CHANGE */; proposedChanges Json?; expectedParticipants Int?; affiliationCode String?
  principalConfirmTokenHash String?; principalConfirmedAt DateTime?; duplicateCandidateIds String[]
  decision String? /* VERIFIED | REJECTED */; decisionReason String?; decidedByUserId String?; decidedAt DateTime?
}
model InstitutionRegistration { reference String @unique; competitionId String; institutionId String; status InstitutionRegistrationStatus; expectedParticipants Int; primaryCoordinatorUserId String; createdByUserId String; @@unique([competitionId, institutionId]) }
model Registration {
  registrationNumber String @unique; competitionId String; participantId String; route ParticipationRoute
  institutionRegistrationId String?; institutionId String? /* snapshot */; accountHolderUserId String? /* INDIVIDUAL */
  ageGroupId String /* computed, D6-2 */; gradeText String?; identityHash String /* 6.5.2 */
  status RegistrationStatus; statusBeforeEnd RegistrationStatus?; feeAmountMinor Int; feePaidMinor Int @default(0); currency String; paidAt DateTime?
  feeWaived Boolean @default(false); feeWaiverReason String?; feeWaivedByUserId String?; openBatchId String?
  possibleDuplicateOfId String?; eligibilityReviewRequired Boolean @default(false); confirmedAt DateTime?; endedAt DateTime?; endReason String?; createdByUserId String
  @@unique([competitionId, participantId]) @@index([competitionId, identityHash])
}
model RegistrationCategory { registrationId String; categoryId String; @@id([registrationId, categoryId]) }
model RegistrationPaymentBatch { competitionId String; payerUserId String; institutionRegistrationId String?; amountMinor Int; currency String; status RegistrationPaymentBatchStatus; paymentId String? /* §8 */; expiresAt DateTime; paidAt DateTime?; offlineReference String?; reviewNote String? }
model RegistrationPaymentBatchItem { batchId String; registrationId String; amountMinor Int; @@id([batchId, registrationId]) }
model StudentImport { institutionRegistrationId String; uploadedByUserId String; sourceAssetId String; status StudentImportStatus; totalRows Int; validRows Int; warningRows Int; errorRows Int; errorReportAssetId String?; previewJson Json? /* purged after 7 d */ }
model SubmissionExtension { competitionId String; targetType String /* REGISTRATION | INSTITUTION_REGISTRATION */; targetId String; stage String /* SUBMISSION | SHORTLIST | DISPATCH */; newDeadline DateTime; reason String; grantedByUserId String }
model DeclarationTemplate { kind DeclarationKind; version Int; bodyMarkdown String; effectiveFrom DateTime; retiredAt DateTime?; @@unique([kind, version]) }
model DeclarationAcceptance { templateId String; subjectType String; subjectId String; acceptedByUserId String; acceptedAt DateTime; textSha256 String; ip String?; userAgent String? }
model ConductCertification {
  institutionRegistrationId String @unique; certifiedByUserId String; declarationAcceptanceId String; conductMode ConductMode
  conductedFrom DateTime @db.Date; conductedTo DateTime @db.Date; participantsPresent Int; supervisorName String
  deviationNote String?; needsReview Boolean @default(false); evidenceAssetIds String[] /* documents only, never photos of children */
}
model Entry {
  entryCode String? @unique /* set on first exit from DRAFT */; competitionId String; registrationId String; participantId String; categoryId String
  route ParticipationRoute; institutionRegistrationId String?; status EntryStatus @default(DRAFT); statusBeforeRejection EntryStatus?
  title String /* ≤120 */; description String /* ≤500 */; statement String? /* ≤1500 */; essayHtml String?; essayWordCount Int?; startedAt DateTime? /* timed ONLINE */
  submitRequestedAt DateTime?; submittedAt DateTime?; submittedByUserId String?; submittedToFoaAt DateTime?; isLate Boolean @default(false); revision Int @default(1)
  schoolRank Int?; schoolAwardLabel String?; finalOutcome EntryOutcome?; finalAwardLabel String?; galleryCandidate Boolean @default(false); auctionCandidate Boolean @default(false) // §3.5 shared
  verifiedAt DateTime?; verifiedByUserId String?; verificationChecklist Json?; correctionNote String?; correctionDueAt DateTime?
  rejectionReason EntryRejectionReason?; rejectionNote String?; endedAt DateTime?; endedByUserId String?; endReason String?
  possibleDuplicateOfId String?; createdByUserId String; deletedAt DateTime?
  @@index([competitionId, status]) @@index([institutionRegistrationId, categoryId, status])
}
model EntryFile { entryId String; role EntryFileRole; sortOrder Int; originalAssetId String; webAssetId String?; thumbAssetId String?; mediaCheck String /* PENDING | PASSED | FAILED */; mediaErrors Json?; perceptualHash String?; supersededAt DateTime? }
model PhysicalArtwork {
  artworkCode String @unique; entryId String @unique; competitionId String; participantId String; institutionId String?
  status PhysicalArtworkStatus; statusBeforeListing PhysicalArtworkStatus? /* set when §8 lists it; 6.10.2 */; reason PhysicalRequestReason; requiredForJudging Boolean; requestedAt DateTime; requestedByUserId String
  dispatchDeadline DateTime; facilityId String; facilitySnapshot Json; shipmentId String?; isLateDispatch Boolean @default(false)
  receivedAt DateTime?; receivedByUserId String?; packageIntact Boolean?; verifiedAt DateTime?; verifiedByUserId String?; checklist Json?
  condition ArtworkCondition?; conditionNotes String?; widthMm Int?; heightMm Int?; depthMm Int?; medium String?
  discrepancyType ArtworkDiscrepancyType?; discrepancyNotes String?; discrepancyResponseDueAt DateTime?; discrepancyResolution String?
  storageLocation String?; returnRequestedAt DateTime?; returnMethod String?; returnTracking String?; returnedAt DateTime?; retainedReason String?
}
model ArtworkShipment { senderType String /* INSTITUTION | INDIVIDUAL */; institutionId String?; senderUserId String; courierName String; trackingNumber String; trackingUrl String?; dispatchedOn DateTime @db.Date; proofAssetId String?; declarationAcceptanceId String }
model ArtworkPhoto { artworkId String; fileAssetId String; stage String /* RECEIPT | VERIFICATION | EXHIBITION | RETURN */ }
model ArtworkCustodyEvent { artworkId String; action String /* RECEIVED | STORED | MOVED | EXHIBITED | HANDED_TO_AUCTION | RETURNED | RETAINED */; fromLocation String?; toLocation String?; actorUserId String; at DateTime; note String? } // append-only
```

### 6.3 Competition Configuration & Lifecycle

**6.3.1 Configuration.** Phase 1 items map to fields as follows. Name, theme and message → `name`, `theme`, `welfareMessageHtml`. Competition type → `CompetitionCategory.discipline` (one competition may span several disciplines). Eligibility and age groups → `AgeGroup`, `eligibleCountries`, `eligibleInstitutionTypes`. Individual or institutional participation → `CompetitionRoute` rows. Rules → `rulesHtml`, `conductGuidelinesHtml`. Judging criteria → `judgingCriteriaSummary` plus the §7 PUBLISHED rubrics (one must resolve for every enabled discipline). Prizes → `CompetitionPrize` plus `awardScheme` (§7). Physical submission → `physicalTopN`, `individualPhysicalRequired`. Public display → `allowPublicDisplay`. Auction → `allowAuction`. Terms and consents → the §12.4 set plus `extraRequiredConsentTypes`.

Categories are Discipline × AgeGroup. A group admits birth dates in `(cutoff − (maxAge+1) y, cutoff − minAge y]`. Age is completed years on the cutoff date, so someone born exactly N years before the cutoff is N. A 29 Feb birthday counts on 1 Mar in non-leap years.

**6.3.2 Publish validation.** `publishCompetition` fails with field errors unless all of these hold:
1. At least one category is enabled. Every group has `minAge ≤ maxAge`. The groups' birth-date intervals don't overlap, so each DOB maps to at most one group.
2. At least one route is enabled. If the INSTITUTION route is enabled, `shortlistSubmissionClosesAt` is set, `schoolShortlistSize ≥ 1`, and `physicalTopN` is null or in `1..schoolShortlistSize`.
3. Dates are ordered: `registrationOpensAt < registrationClosesAt ≤ confirmationDeadline ≤ submissionClosesAt`; `registrationClosesAt ≤ conductStartsAt ≤ conductEndsAt ≤ submissionClosesAt`; `conductStartsAt ≤ submissionOpensAt < submissionClosesAt < shortlistSubmissionClosesAt` (the last only when set).
4. Any physical requirement needs an active facility and non-empty `packagingInstructionsHtml`.
5. §12 has a current `ConsentDocument` for every consent type the competition asks for.

**6.3.3 Edit locks.**

| Fields | DRAFT, PUBLISHED | REGISTRATION_OPEN onward |
|---|---|---|
| Text (rules, theme, guidelines, instructions, help) | edit | edit (audited) |
| Categories, age groups, routes, fees, scope, shortlist size, consent types | edit | Locked. SA may add a category, but never remove one that has registrations |
| Dates | edit | A future date may move later (emits `competition.scheduleChanged`). Earlier only via a manual transition |
| `physicalTopN`, `individualPhysicalRequired`, facility | edit | Editable until the first entry is FOA_VERIFIED |

**6.3.4 Status machine.** Job `competition.advance` runs every minute. For each competition with `autoAdvance`, it applies the time-driven rows repeatedly, so a missed run catches up in order. Each step is a conditional update (`WHERE status = from`) in its own transaction, with actor SYSTEM, so it is idempotent. The same job emits `competition.submissionOpened` once at `submissionOpensAt`. It also cancels unconfirmed registrations at `confirmationDeadline` (6.6). A manual transition (`transitionCompetition`) sets the matching date to `now()`. For example, an early close sets `registrationClosesAt = now`. If a guard fails, for example no §7 PUBLISHED rubric resolves for an enabled discipline, the job stops for that competition and emits `competition.advanceBlocked`.

| From → To | Trigger | Guard | Side effects |
|---|---|---|---|
| DRAFT → PUBLISHED | `publishCompetition` (CM, SA) | 6.3.2 | `publishedAt`; `competition.published` |
| PUBLISHED → REGISTRATION_OPEN | at `registrationOpensAt`; manual | — | `competition.registrationOpened` |
| REGISTRATION_OPEN → REGISTRATION_CLOSED | at `registrationClosesAt`; manual | — | `competition.registrationClosed` |
| REGISTRATION_CLOSED → REGISTRATION_OPEN | manual, with a new `registrationClosesAt > now` | `now < conductStartsAt` | `competition.registrationOpened` |
| REGISTRATION_CLOSED → IN_PROGRESS | at `conductStartsAt`; manual | — | `competition.statusChanged` |
| IN_PROGRESS → SCHOOL_JUDGING | at `submissionClosesAt + lateGraceMinutes`; manual | INSTITUTION route enabled; a §7 PUBLISHED rubric resolves for every enabled discipline | §7 opens the school rounds, in both scopes |
| IN_PROGRESS → FOA_JUDGING | same | No INSTITUTION route; a §7 PUBLISHED rubric resolves for every enabled discipline | §7 may open rounds |
| SCHOOL_JUDGING → FOA_JUDGING | at `shortlistSubmissionClosesAt`; manual | Every §7 school round is FINALIZED or CLOSED_BY_FOA; a §7 PUBLISHED rubric resolves for every enabled discipline | No auto-finalise or auto-forfeit. At `shortlistSubmissionClosesAt` an unfinished school round becomes OVERDUE (§7.15 E5) |
| FOA_JUDGING ⇄ RESULTS_PENDING_APPROVAL → RESULTS_PUBLISHED | §7 only | §7 | §7 |
| RESULTS_PUBLISHED → ARCHIVED | at `resultsPublishedAt + archiveAfterDays`; manual | — | Read-only |
| any status before RESULTS_PUBLISHED → CANCELLED | `cancelCompetition` (SA, reason) | — | Registrations → CANCELLED (6.6); refunds of captured fees requested from §8; artworks in custody → returns queue; `competition.cancelled` |

| Status | Public | What it allows |
|---|---|---|
| DRAFT | No (CM/SA preview only) | All configuration |
| PUBLISHED | Yes | Config edits per 6.3.3. Institutions may sign up (6.4.1) but not yet register for this competition |
| REGISTRATION_OPEN | Yes | Individual registration, institution competition registration, adding or importing students, consents, payment |
| REGISTRATION_CLOSED | Yes | No new registrations, except `addLateRegistration` (CM/SA). Pending registrations can finish consent, payment and institution verification until `confirmationDeadline`. `publishInstructions` |
| IN_PROGRESS | Yes | Conduct. From `submissionOpensAt`: drafts, uploads and submissions. Conduct certification. FOA verification of individual entries. Physical requests |
| SCHOOL_JUDGING | Yes | §7 school judging. SHORTLIST_ONLY shortlist creation. Shortlisted entries → SUBMITTED_TO_FOA until the shortlist deadline. FOA verification. Physical dispatch and receipt |
| FOA_JUDGING, RESULTS_PENDING_APPROVAL | Yes | §7 judging. Physical receipt and verification. Only staff can withdraw entries |
| RESULTS_PUBLISHED | Yes, with results (§7) | Return requests, exhibition, retention, auction (§8) |
| ARCHIVED | Yes, read-only | Artwork custody actions only |
| CANCELLED | Listed with a label for 30 days | Refunds and artwork returns only |

Deadlines, not statuses, gate submission. An extension (6.8.5) allows a submission after the competition has moved on, but never once it reaches FOA_JUDGING.

### 6.4 Institutions (Route A, Steps 1–2)

**6.4.1 Sign-up at `/schools/register`.** Five steps, with save-and-resume:
1. The authorised person signs in or up by OTP. Both email and phone must be verified.
2. Institution details: name, type, address, city, state, pin code (6 digits for IN), country, contact phone and email. Optional affiliation code (UDISE, AISHE or board).
3. Principal: name, email and phone. A checkbox copies these from the authorised person.
4. The authorised person's designation. Optionally, a competition to join plus the expected number of participants; this also runs 6.4.4.
5. Institution terms and data-processing consent (§12), then submit.

Submitting creates: the `Institution` in PENDING_VERIFICATION, with an `institutionCode`; `InstitutionMember(AUTHORISED_PERSON)` and `UserRole(INSTITUTION_ADMIN, scope INSTITUTION)`; an `InstitutionApplication(INITIAL)` holding the expected participants and `duplicateCandidateIds`. A candidate is an institution with the same pin code and pg_trgm name similarity ≥ 0.6, or one sharing the contact or principal email. If the principal is a different person, they get a confirmation email linking to `/schools/confirm/[token]`, valid for 14 days. The step emits `institution.registered`.

**6.4.2 Verification** (`Institution.status`, §3.4).

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| PENDING_VERIFICATION → VERIFIED | SA, CM | The authorised person's email and phone are verified. The principal confirmed, or staff logged a phone confirmation in `decisionReason`. All duplicate candidates are dismissed | InstitutionRegistrations → ACTIVE; their registrations are re-evaluated (6.6); `institution.verified` |
| PENDING_VERIFICATION → REJECTED | SA, CM | Reason | InstitutionRegistrations and their registrations → CANCELLED; `institution.rejected` |
| REJECTED → PENDING_VERIFICATION | INSTITUTION_ADMIN re-applies | A new application | `institution.registered` |
| VERIFIED ⇄ SUSPENDED | SA | Reason | While suspended: read-only dashboard; no new registrations, payments, submissions or dispatches. `institution.suspended` / `institution.reinstated` |

The queue is ordered by soonest competition `registrationClosesAt`, then by age. After verification, changes to name, address or pin code create a CHANGE application that needs SA approval. Contact fields can be edited directly, with an audit record.

**6.4.3 Team.** The INSTITUTION_ADMIN invites coordinators by email or phone. The token is valid for 7 days and the invite emits `institutionMember.invited`. Accepting via OTP creates `InstitutionMember(COORDINATOR)` and `UserRole(INSTITUTION_COORDINATOR, scope INSTITUTION)`. Removing a coordinator revokes the role; their data stays with the institution. Admins and coordinators can do everything in 6.4.4–6.10 for their own institution. Only the admin can manage members or withdraw an InstitutionRegistration.

**6.4.4 Competition registration** (`registerInstitutionForCompetition`). **Guard:** the competition is REGISTRATION_OPEN, the INSTITUTION route is enabled, the institution's type is in `eligibleInstitutionTypes` if that is set, the institution is neither REJECTED nor SUSPENDED, and it has no other registration for this competition. **Effect:** creates an InstitutionRegistration with a `reference` (§3.1), `expectedParticipants` and a primary coordinator. Its status is ACTIVE if the institution is VERIFIED, otherwise PENDING_INSTITUTION_VERIFICATION. Emits `institutionRegistration.created`. **What the institution sees:** the Institution ID, the reference and the coordinator workspace (Phase 2 output). **Unverified institutions** can still add students. Payment, confirmation and submission wait for verification (6.6, E4).

### 6.5 Participants

**6.5.1 Students under an institution** are managed `ParticipantProfile`s: `userId` is null, `institutionId` is set, and `createdByUserId` is the coordinator. For a minor, the guardian's name, relationship and phone are required. This creates an unverified `Guardian` (§12.5, school route). Each student gets one Registration on the INSTITUTION route, with a null `accountHolderUserId`. Consent capture follows §12.5: signed-form upload, institution declaration, or guardian confirmation link. The printable form lives under `/institution/competitions/[code]/`. §6 shows each student's consent state and offers "record consent" and "resend" actions, which call §12. A verified guardian may claim the profile (§12). They then get read access and consent control, and the coordinator remains the submitter. Students can be added while the competition is REGISTRATION_OPEN and the InstitutionRegistration hasn't ended. After that, only `addLateRegistration` (CM/SA) works, until `confirmationDeadline`. The single-student form uses the same fields and rules as a CSV row.

**6.5.2 CSV import** (`/institution/competitions/[code]/students/import`). The file must be UTF-8 (a BOM is tolerated), comma-separated, with a header row, at most 1,000 rows and at most 2 MB. The downloadable template lists the competition's disciplines.

| Column | Rule |
|---|---|
| `student_ref` | Optional roll number, ≤ 40 chars, unique within the institution. Used as the first match key |
| `full_name`* | 2–100 chars |
| `display_name` | 2–30 chars (§12.7). Generated if blank |
| `date_of_birth`* | `YYYY-MM-DD` or `DD/MM/YYYY`. Dates with slashes are always day-first |
| `gender` | Only if `collectsGender`: `F`, `M`, `X` or blank |
| `grade` | Class or year, ≤ 20 chars. Stored in `Registration.gradeText` |
| `disciplines`* | `;`-separated `Discipline` values, e.g. `DRAWING;PAINTING`. At most `maxCategoriesPerParticipant`, and each must have an enabled category for the student's age group |
| `guardian_name`*, `guardian_relationship`*, `guardian_phone`* | Required for minors. Relationship is `PARENT` or `LEGAL_GUARDIAN`. Phone is normalised to E.164, defaulting to +91 |
| `guardian_email` | Optional |
| `participant_phone`, `participant_email` | Adults only, and phone is required for adults (§12.2). For minors these are ignored with a warning |
| `pin_code`, `city`, `state` | Default to the institution's values |

**Import pipeline.** (1) The upload is stored as a private FileAsset. (2) A `VALIDATING` job checks every row. (3) `PREVIEW` shows each row as VALID, WARNING or ERROR, with counts. (4) `commitStudentImport` imports VALID and WARNING rows in transactions of 100, then marks the import `COMPLETED`. ERROR rows are never imported. Previews are purged after 7 days.

**Error report.** A CSV with the original columns plus `row_number, column, error_code, message`. Errors: `REQUIRED_MISSING`, `INVALID_FORMAT`, `INVALID_DATE`, `AGE_NOT_ELIGIBLE`, `UNKNOWN_DISCIPLINE`, `CATEGORY_NOT_OFFERED`, `TOO_MANY_CATEGORIES`, `GUARDIAN_REQUIRED`, `INVALID_PHONE`, `INVALID_EMAIL`, and `DUPLICATE_IN_FILE` (raised on the second and later occurrences). Warnings: `ALREADY_REGISTERED` (row skipped), `PROFILE_MATCHED` (existing profile reused and updated), and `POSSIBLE_CROSS_REGISTRATION` (E6).

**Duplicate detection.** The match key is `student_ref` when present. Otherwise it is `identityHash = HMAC(PII_HASH_KEY, normalize(full_name) + '|' + dob)`, where `normalize` applies NFKD, strips diacritics, lowercases and collapses whitespace. DOB is encrypted (§13), so matching never uses SQL on DOB. Each row is checked against the rest of the file, the institution's existing profiles, and every registration in the same competition on either route.

**6.5.3 Individual registration (Route B)** at `/competitions/[slug]/register`. When both routes are enabled, step 0 is a route chooser. The school card comes first, marked **Recommended**, with the text: "We encourage you to participate through your school. Ask your teacher to register your school, or share this link: {origin}/schools/register?competition={slug}." The second card is "Participate as an Individual".

Steps:
1. Who is participating: "Myself" or "My child / ward". A signed-in guardian also sees their existing children.
2. Date of birth comes first (§12.5). If a self-registrant is under 18, the flow switches to "Ask your parent or guardian", and the minor may only enter the guardian's phone or email. §12's `PendingRegistration` holds the draft, and the guardian completes steps 3–7 after verifying.
3. Sign in or sign up by OTP, as the adult participant or the guardian. A guardian completes §12.5 verification here.
4. Participant details: full name, display name, gender (only if `collectsGender`), phone (adults), pin code, city, state, country (from `eligibleCountries`), and optional school or college name (`schoolNameText`).
5. Categories. The age group is computed and shown read-only (D6-2). Ineligible disciplines are greyed out with the reason. At most `maxCategoriesPerParticipant` can be chosen.
6. Consents, using §12 components. Required: the §12.4 set. Optional: COMMUNICATION; PUBLIC_DISPLAY and SOCIAL_MEDIA if `allowPublicDisplay`; AUCTION_OF_ARTWORK if `allowAuction`.
7. Review and pay. The fee is `feeBaseMinor + feeAdditionalCategoryMinor × (n − 1)`, or "Free". Paying creates a one-registration batch (6.6).

The final screen, `registration.created` and `registration.confirmed` all show the Participant ID and Registration Number.

**6.5.4 Login (D6-1).** `/login` accepts an email, phone or Participant ID (`FOA-P-…`). A Participant ID resolves to `ParticipantProfile.userId`, or failing that to its guardian's `userId`. The OTP goes to that user's verified email or phone, shown masked (`••••••4321`). If the profile has neither, the response is `MANAGED_PROFILE` ("Your school manages this profile") and nothing is sent. Registration numbers are rejected as identifiers. Unknown identifiers get the same response as known ones. OTP rules and rate limits are §13's. After login, the dashboard deep-links registrations by number.

### 6.6 Registration Lifecycle & Fees

`evaluateRegistration(reg)` is a pure function with exhaustive tests. It runs in the transaction of every consent, payment, waiver, verification and category change.
- `consentsOk`: `ConsentService.has` is true for §12.4's "Register for a competition" set (TERMS, DATA_PROCESSING, PARTICIPATION, and GUARDIAN_VERIFIED for minors), plus `extraRequiredConsentTypes`.
- `paidOk`: `feeWaived`, or `feeAmountMinor = 0`, or `feePaidMinor ≥ feeAmountMinor`.
- `instOk`: the route is INDIVIDUAL, or the institution is VERIFIED.
- Target status: not `consentsOk` → PENDING_CONSENT. Otherwise, not (`paidOk` and `instOk`) → PENDING_PAYMENT. Otherwise → CONFIRMED.

A school may pay in bulk while signed forms are still coming in. Those registrations stay PENDING_CONSENT with `paidAt` set. The fee is copied from `CompetitionRoute` when the registration is created, and recomputed only while it is unpaid. Categories can change only before CONFIRMED; after that, only CM/SA can change them.

| From → To | Trigger / actor | Guard | Side effects |
|---|---|---|---|
| ∅ → PENDING_CONSENT | `registerIndividual`, `addStudent`, CSV commit, `addLateRegistration` | The competition is REGISTRATION_OPEN (late add: CM/SA, until `confirmationDeadline`). The route is enabled. Every category matches the age group. The participant has no other registration in this competition | `registrationNumber`, fee snapshot, `identityHash`; duplicate check (E6); §12 consent requests; `registration.created`; then `evaluateRegistration` in the same transaction |
| PENDING_CONSENT → PENDING_PAYMENT | system | `consentsOk`, but not (`paidOk` and `instOk`) | §10 reminds the payer |
| PENDING_CONSENT, PENDING_PAYMENT → CONFIRMED | system, after a consent, capture, offline payment, waiver or institution verification | The target status is CONFIRMED, and `now ≤ confirmationDeadline` unless CM/SA acted | `confirmedAt`; `registration.confirmed` |
| PENDING_PAYMENT → PENDING_CONSENT | system on `consent.withdrawn` | — | — |
| PENDING_* → CANCELLED | job at `confirmationDeadline`; CM/SA; institution rejected; competition cancelled; duplicate resolution | — | Open batch cancelled; draft entries soft-deleted; `registration.cancelled` |
| PENDING_*, CONFIRMED → WITHDRAWN | `withdrawRegistration` by the Owner or a claimed guardian (before FOA_JUDGING), or by SA (any time). Also the system, on `consent.withdrawn` of PARTICIPATION or DATA_PROCESSING before RESULTS_PUBLISHED (§12.6) | Reason | Live entries in every status, including IN_JUDGING, ELIMINATED and FINALIZED, → WITHDRAWN (6.9 rows 13–14); artworks per 6.10; refund only if §8 policy allows (CM/SA request, FINANCE approves); `registration.withdrawn` |
| CONFIRMED → CANCELLED | CM/SA (ineligible, fraud, duplicate); competition cancelled | Reason | Entries → WITHDRAWN; §8 refund on cancellation or duplicate; `registration.cancelled` |
| WITHDRAWN, CANCELLED → `statusBeforeEnd` | `reinstateRegistration` (SA) | Competition is at or before IN_PROGRESS | `evaluateRegistration` |

**Payment batches.**
- **Create.** `createRegistrationPaymentBatch({ registrationIds })` requires: all registrations are in one competition and share one Owner; each is PENDING_CONSENT or PENDING_PAYMENT, unpaid, not waived, and not in an open batch; `now ≤ confirmationDeadline`; on route A, the institution is VERIFIED. It creates the batch (OPEN, `expiresAt = now + 30 min`) and its items, sets `openBatchId` on each registration, and calls `PaymentService.createOrder({ purpose: REGISTRATION_FEE, amountMinor: Σ items, currency, payerUserId, refType: 'RegistrationPaymentBatch', refId: batchId })`, one order per batch. An institution batch covers N students; an individual registration pays through a batch of one.
- **Capture.** `payment.captured` is idempotent on `paymentId`. If the amount differs from the batch total → NEEDS_REVIEW. Otherwise, each live, unpaid registration gets `feePaidMinor += amount` and `paidAt`, and is re-evaluated. If any item can't be applied (the registration is no longer payable) → NEEDS_REVIEW and `registration.paymentNeedsReview`, so staff can reinstate, or CM/SA can request a refund via §8, which FINANCE approves. There is no automatic refund. Otherwise → PAID. `openBatchId` is always cleared.
- **Failure and expiry.** `payment.failed` → FAILED, and the expiry job → EXPIRED. Both clear `openBatchId`. A capture that arrives after expiry is still processed as above.
- **Offline payment** (cheque or NEFT). FINANCE or SA calls `markBatchPaidOffline({ batchId, reference, amountMinor })`, which calls `PaymentService.recordOfflinePayment({ refType: 'RegistrationPaymentBatch', refId: batchId, … })` and then works like a capture. §8 records the ledger entry.
- **Waivers.** CM/SA call `waiveRegistrationFees({ registrationIds | institutionRegistrationId, reason })`. Zero-fee routes need no waiver and create no Payment.
- **Refunds** are never automatic, except on competition cancellation and duplicate resolution. Otherwise CM/SA request them via §8 and FINANCE approves (§8's dual approval above the threshold still applies). A partial refund lists the `RegistrationPaymentBatchItem` ids it covers; the amount is the sum of their `amountMinor`.

### 6.7 Preparation & Conduct (Phase 3)

**Instructions.** `publishInstructions` (CM/SA, from REGISTRATION_OPEN onward) builds the briefing from competition fields: conduct window; theme or topic confirmation; `permittedMaterials` and `durationMinutes`; the submission procedure for the route and scope; physical artwork requirements; all deadlines in IST; `helpContact`. It sets `instructionsPublishedAt` and emits `competition.instructionsPublished`, which §10 delivers to individual Owners and coordinators. Re-publishing after edits re-emits the event with a new `revision`. For ad-hoc bulk messages to registrants, use a §10.6 `Announcement` with segment `{ competitionIds, registrationStatuses, route }`; the competition admin page opens that builder pre-filled.

**Conduct modes** (`CompetitionRoute.conductMode`).

| Mode | Meaning | Platform rule |
|---|---|---|
| PHYSICAL_AT_INSTITUTION | Held at the school within `[conductStartsAt, conductEndsAt]`, supervised | A ConductCertification must exist before any entry of the InstitutionRegistration reaches SUBMITTED_TO_FOA |
| ONLINE | Produced on the platform, e.g. in the essay editor | If `durationMinutes` is set, `startTimedEntry` stamps `startedAt`, and the deadline becomes `min(effective deadline, startedAt + durationMinutes)` |
| INDEPENDENT | Made alone by an individual | The Owner accepts ENTRY_ORIGINALITY_SELF at submit |

**Conduct certification** (`certifyConduct`). **Who and when:** a coordinator or INSTITUTION_ADMIN, from `conductStartsAt` until `shortlistSubmissionClosesAt`. **Declaration:** the current `DeclarationTemplate(CONDUCT_CERTIFICATION)` is shown in full. Acceptance stores the version, the SHA-256 of the rendered text, the IP and the user agent. **Out-of-window dates:** need a `deviationNote` and set `needsReview` for CM. This does not block the certification. **Limits:** one certification per InstitutionRegistration. SA can reset it to allow an amendment. **Evidence:** documents only (e.g. an attendance sheet), never photos of children. **Event:** `institutionRegistration.certified`.

**Declaration templates** are versioned. Each edit creates version n+1 with its own `effectiveFrom`, and each acceptance keeps the version it was shown. Declarations are an adult's statements, separate from §12 consents.

### 6.8 Submission (Phases 4 and 7)

**6.8.1 Who submits.** `digitalSubmissionScope` applies to the institution route only. Individuals always submit.

| Route | Scope | Submitter | Path |
|---|---|---|---|
| INDIVIDUAL | any | Owner | DRAFT → SUBMITTED → FOA_VERIFIED |
| INSTITUTION | ALL | Coordinator (claimed guardians can only view) | DRAFT → SUBMITTED → (§7) SCHOOL_SHORTLISTED → SUBMITTED_TO_FOA → FOA_VERIFIED |
| INSTITUTION | SHORTLIST_ONLY | Coordinator, for shortlisted students only | Created in SCHOOL_SHORTLISTED → SUBMITTED_TO_FOA → FOA_VERIFIED |

**6.8.2 Fields.** **Phase 4:** the registration (picked from a list, not typed; the number is derived), the category, `title`* (≤ 120 chars), `description`* (≤ 500), an optional `statement` (≤ 1,500), and files per 6.8.3. **Phase 7 adds:** `schoolRank`* and `schoolAwardLabel` (set by §7 or at shortlisted creation), a HIRES_SCAN for visual disciplines, and the ENTRY_ORIGINALITY_INSTITUTION declaration. **From records:** Participant ID, Entry ID, institution and category. **Recorded by the system:** participant, route, institution, competition, category, timestamps, files and status.

**Bulk entries (scope ALL).** (1) `bulkCreateEntries` takes up to 200 images for one category. (2) Files named `{student_ref}.{ext}` or `{registrationNumber}.{ext}` are matched to CONFIRMED registrations. Unmatched files are listed. (3) Matched files become DRAFT entries, which the coordinator completes in a grid editor. (4) `submitEntries(entryIds[])` runs the 6.8.4 gate on each entry.

**6.8.3 File rules.** These are defaults. `CompetitionCategory.fileRules` may tighten them, never beyond §13's upload limits.

| Discipline | Types | Files | Max per file | Minimum at submit | Minimum HIRES_SCAN |
|---|---|---|---|---|---|
| DRAWING, PAINTING, ART | JPEG, PNG, WebP, HEIC | 1 PRIMARY + ≤ 2 ADDITIONAL_VIEW | 20 MB | Long edge ≥ 1,200 px | Long edge ≥ 3,000 px |
| CRAFT | JPEG, PNG, WebP, HEIC | 2–6 (PRIMARY + front, side and detail views) | 20 MB | 1,200 px | 3,000 px (PRIMARY) |
| PHOTOGRAPHY | JPEG, PNG, WebP, HEIC | 1 | 20 MB | 2,000 px | 3,000 px |
| ESSAY | Rich text in the editor, or PDF/DOCX (ESSAY_DOCUMENT). With PHYSICAL_AT_INSTITUTION, also a scanned PDF/JPEG of handwriting | 1 | 10 MB | `minWords`–`maxWords` (default 0–1,000); not checked for scans | — |
| VIDEOGRAPHY | MP4 (H.264/AAC), MOV, WebM | 1 VIDEO | 500 MB (multipart above 100 MB) | Short edge ≥ 720 px; duration 10 s to `maxDurationSec` (default 180, cap 300) | — |

- **`FileRules` (zod):** `{ types, minFiles, maxFiles, maxBytes, minLongEdgePx?, hiResMinLongEdgePx?, minShortEdgePx?, minDurationSec?, maxDurationSec?, essay?: { modes: ('RICH_TEXT'|'DOCUMENT'|'SCAN')[], minWords, maxWords } }`.
- **Word counts** use `Intl.Segmenter` on sanitised text, which handles Indic scripts. The worker extracts text from DOCX and PDF. If extraction fails, the file passes with a `WORD_COUNT_UNVERIFIED` warning for the verifier.

**6.8.4 Upload pipeline & submit gate.**
1. **Request.** `requestEntryUpload({ entryId, role, fileName, mime, sizeBytes })` checks the file rule, that the entry is editable, and that `now ≤ effective deadline`. It creates `FileAsset(ORIGINAL, scanStatus PENDING)` and `EntryFile(mediaCheck PENDING)`. It returns a 15-minute presigned PUT, with Content-Type and Content-Length signed, to `quarantine/entries/{competitionId}/{entryId}/{fileAssetId}`. Above 100 MB, the upload is multipart, with parts presigned on demand.
2. **Complete.** The client calls `completeEntryUpload({ fileAssetId, sha256 })`. The server HEADs the object (the size must match) and enqueues `media.process`.
3. **Process** (`media.process`, per §13): Checks: magic bytes, ≤ 50 MP, ClamAV. Sets `scanStatus`; CLEAN files are promoted out of `quarantine/`. Probe: sharp or ffprobe reads dimensions and duration, the file rule is checked, and `mediaCheck` is set. Images: auto-orient; HEIC → JPEG; WEB (2,048 px long edge) and THUMB (400 px) derivatives with all EXIF, XMP and IPTC metadata (including GPS) stripped; a dHash stored as `perceptualHash`. Video: a poster THUMB. DOCX: a PDF derivative (Gotenberg, §2).
4. **Infected files.** An INFECTED file is detached, the Owner is notified (`file.quarantined`), and the object is deleted after 7 days.

Originals stay private (signed URLs, §13). Judges and the public only ever see derivatives.

**Submit gate** (`submitEntry`). All of these must hold: the registration is CONFIRMED; required fields are filled, and file count and roles match the rules; every active file has `mediaCheck = PASSED` and `scanStatus = CLEAN`; `ConsentService.has(PARTICIPATION)`; the declaration is accepted: ENTRY_ORIGINALITY_SELF for individuals, or ENTRY_ORIGINALITY_INSTITUTION by the coordinator, once per `submitEntries` batch; `now ≤ effective deadline`.

If the Owner submits before the deadline while files are still processing, the system stores `submitRequestedAt`. Job `entry.autoSubmit` then completes the submission once processing passes (actor SYSTEM, `submittedAt = submitRequestedAt`). If processing fails, the entry stays DRAFT and the Owner is notified, even if the deadline has passed by then.

**6.8.5 Deadlines, late entries, edits, withdrawal.**
- **Effective deadline.** For SUBMITTED: `submissionClosesAt + lateGraceMinutes`, or a later `SubmissionExtension(SUBMISSION)` for the registration or its InstitutionRegistration. For SUBMITTED_TO_FOA: `shortlistSubmissionClosesAt`, or a SHORTLIST extension. After a change request: `correctionDueAt`.
- **Late entries.** Server time decides. `isLate` is set when an entry is submitted after the base deadline. No upload URL is issued after the effective deadline, but a URL issued before it stays usable for its full 15 minutes.
- **Edits.** DRAFT entries can be edited freely. In SUBMITTED and SUBMITTED_TO_FOA, the title, description, statement and files can be edited until that stage's deadline, with no status change. Each save increments `revision` and is audited. A replacement file becomes active only once it passes processing. The old file then gets `supersededAt`. The category can't change after DRAFT. To change it, withdraw the entry and create a new one. Entries are read-only after the deadline and from FOA_VERIFIED onward.
- **Withdrawal.** DRAFT entries are soft-deleted. Other entries are withdrawn with `withdrawEntry` (6.9 rows 13–14). Withdrawal never triggers a refund.

**6.8.6 Entry ID & confirmation.** `entryCode` (§3.1) is generated when an entry first leaves DRAFT, or when it is created in SCHOOL_SHORTLISTED. It never changes. The Owner sees a receipt and gets `entry.submitted` with the entry code, title, category and IST timestamp.

### 6.9 EntryStatus Transitions (§6-owned)

| # | From → To | Trigger / actor | Guard | Side effects |
|---|---|---|---|---|
| 1 | ∅ → DRAFT | `createEntry`: Owner (INDIVIDUAL) or coordinator (INSTITUTION, scope ALL) | Competition IN_PROGRESS or SCHOOL_JUDGING; `submissionOpensAt ≤ now ≤` effective deadline (6.8.5). Registration has not ended. Category is one of the registration's. Live entries for that registration and category < `maxEntriesPerParticipant` | — |
| 2 | DRAFT → SUBMITTED | `submitEntry` / `submitEntries`; SYSTEM auto-submit | Submit gate (6.8.4) | `entryCode`, `submittedAt`; `entry.submitted` |
| 3 | SUBMITTED → DRAFT | `requestEntryChanges` (CM, SA) | INDIVIDUAL route; `correctionDueAt > now` | `entry.changesRequested`; may resubmit until `correctionDueAt` |
| 4 | SUBMITTED → SCHOOL_SHORTLISTED | §7 calls `applySchoolShortlist` | INSTITUTION route, scope ALL; size guard; `schoolRank` set | `entry.shortlisted` |
| 5 | SUBMITTED → NOT_SHORTLISTED | Same call | Same | `entry.notShortlisted` |
| 6 | NOT_SHORTLISTED → SCHOOL_SHORTLISTED | §7 amends the shortlist, e.g. to replace a withdrawn entry | `now ≤` shortlist deadline; size guard | `entry.shortlisted` |
| 7 | ∅ → SCHOOL_SHORTLISTED | `createShortlistedEntry`: coordinator, or §7's school round | Scope SHORTLIST_ONLY. Registration CONFIRMED. `competition.status = SCHOOL_JUDGING` and `now ≤ shortlistSubmissionClosesAt` (or a SHORTLIST extension). Size guard | `entryCode`; `entry.shortlisted` with `silent: true` (analytics only; §10 sends the shortlist messages from `schoolShortlist.finalized`, which §7 `finalizeSchoolRound` emits, see §7.3) |
| 8 | SCHOOL_SHORTLISTED → SUBMITTED_TO_FOA | `submitShortlistedEntryToFoa`: coordinator | Within the shortlist deadline. ConductCertification exists (PHYSICAL_AT_INSTITUTION). Visual disciplines have a HIRES_SCAN ≥ `hiResMinLongEdgePx`, or a qualifying PRIMARY marked via `markFileAsHiRes`. Title and description present. PARTICIPATION consent. ENTRY_ORIGINALITY_INSTITUTION accepted | `submittedToFoaAt`; `entry.submittedToFoa` |
| 9 | SUBMITTED_TO_FOA → SCHOOL_SHORTLISTED | `requestEntryChanges` (CM, SA) | `correctionDueAt > now` | `entry.changesRequested` |
| 10 | SUBMITTED (INDIVIDUAL) or SUBMITTED_TO_FOA → FOA_VERIFIED | `verifyEntry` (CM, SA) | Checklist all true: category and age group correct; files legible and within rules; on theme; consents present; declaration present; no open duplicate flag | `verifiedAt`; physical request per 6.10.1; `entry.verified` |
| 11 | SUBMITTED, SCHOOL_SHORTLISTED, SUBMITTED_TO_FOA or FOA_VERIFIED → REJECTED_INELIGIBLE | `rejectEntry` (CM, SA) | `rejectionReason`. From FOA_VERIFIED only before IN_JUDGING (e.g. PHYSICAL_NOT_RECEIVED, PHYSICAL_MISMATCH) | `statusBeforeRejection` stored; REQUESTED artwork → NOT_REQUIRED; `entry.rejected` |
| 12 | REJECTED_INELIGIBLE → `statusBeforeRejection` | `reinstateEntry` (SA) | Competition at or before FOA_JUDGING | `entry.reinstated` |
| 13 | SUBMITTED, SCHOOL_SHORTLISTED, SUBMITTED_TO_FOA or FOA_VERIFIED → WITHDRAWN | `withdrawEntry` (Owner, CM, SA); cascade from a WITHDRAWN or CANCELLED registration | Non-staff only before FOA_JUDGING | Artwork per 6.10 (REQUESTED → NOT_REQUIRED; in custody → returns queue); `entry.withdrawn` |
| 14 | IN_JUDGING, ELIMINATED or FINALIZED → WITHDRAWN | `withdrawEntry` (SA); cascade from a registration becoming WITHDRAWN, including the system acting on `consent.withdrawn` for PARTICIPATION (§12.6) | Reason | §7 removes the entry from its rounds. If results are already published, a §7.15 E3 correction follows (certificate revoked, results corrected) |
| 15 | Any status except DRAFT, WITHDRAWN or DISQUALIFIED (including §7 statuses) → DISQUALIFIED | `disqualifyEntry` (CM, SA; from FINALIZED, SA only) | Reason, e.g. plagiarism or a conduct breach | §7 recomputes rankings and revokes certificates; `entry.disqualified` |
| 16 | SCHOOL_SHORTLISTED, SUBMITTED_TO_FOA or NOT_SHORTLISTED → SUBMITTED | `EntryService.revertSchoolShortlist({ institutionRegistrationId, categoryId })`, called only by §7 when a school round is reopened | Scope ALL. No entry of that InstitutionRegistration × category is FOA_VERIFIED or later | Clears `schoolRank`, `schoolAwardLabel` and `submittedToFoaAt`; `entry.shortlistReverted` (silent). Under SHORTLIST_ONLY, entries created by row 7 are soft-deleted on reopen instead (same guard) |

**Size guard.** Live shortlist entries per InstitutionRegistration and category must not exceed `schoolShortlistSize`. Live means SCHOOL_SHORTLISTED, SUBMITTED_TO_FOA, FOA_VERIFIED or any later §7 status. `schoolRank` is unique within that pair. Withdrawn and rejected entries free their slot. **Ended states for §6.** NOT_SHORTLISTED (except rows 6 and 16), REJECTED_INELIGIBLE (except row 12), WITHDRAWN and DISQUALIFIED. **Leftovers.** An entry still SCHOOL_SHORTLISTED after the shortlist deadline stays there. It keeps its rank for §7 merit certificates but goes no further. DRAFTs left after the deadline are hidden and purged under §12 retention. **Anything else.** Any other transition throws `IllegalTransitionError`.

```ts
EntryService.applySchoolShortlist({ institutionRegistrationId, categoryId, actorUserId,
  shortlisted: { entryId: string; schoolRank: number; schoolAwardLabel?: string }[], notShortlistedEntryIds: string[] }) // §7 finalizeSchoolRound, once per category; ALL; atomic; rows 4–6
EntryService.createShortlistedEntry({ registrationId, categoryId, schoolRank, schoolAwardLabel?, title, description, actorUserId }) // row 7
EntryService.revertSchoolShortlist({ institutionRegistrationId, categoryId }) // §7 reopenSchoolRound only; row 16
ArtworkService.physicalReady(entryId): boolean // = !artwork.requiredForJudging || artwork.status ∈ {VERIFIED, IN_EXHIBITION, RETAINED}
  // true when the entry has no PhysicalArtwork (6.10.1); waivePhysicalForJudging sets requiredForJudging = false
```

### 6.10 Physical Artwork Track (Phases 5, 8, 14)

**6.10.1 Requests.**
- **Automatic** on `entry.verified`, when the category is `physicalEligible` and either the route is INDIVIDUAL with `individualPhysicalRequired`, or the route is INSTITUTION with `schoolRank ≤ physicalTopN`. These requests have reason JUDGING and `requiredForJudging = true`. This follows the source note that individuals are judged on the physical copy.
- **Manual.** CM/SA can call `requestPhysicalArtwork` for any entry at FOA_VERIFIED or later that hasn't ended. This covers end-to-end step 10 (selection for exhibition or auction). The reason is EXHIBITION, AUCTION or ARCHIVE, and `requiredForJudging = false`.
- **Deadline.** `dispatchDeadline = requestedAt + physicalDispatchDays`. CM/SA can extend it. If an entry has no PhysicalArtwork row, no physical copy is needed.
- **What the request contains** (shown on the dashboard and sent as `artwork.requested`): the artwork code and entry code; packaging instructions; the facility address snapshot; the dispatch deadline; a label PDF from `downloadArtworkLabel`, showing the artwork code, entry code, category and a QR code to `/admin/artwork/[artworkCode]`, with no participant name; the ARTWORK_DISPATCH declaration; links to any missing optional consents (§12).
- **Responsible party.** On the institution route, the coordinators, since the artwork is still at the school (Phase 7). On the individual route, the Owner.

**6.10.2 PhysicalArtworkStatus transitions.**

| From → To | Trigger / actor | Guard | Side effects |
|---|---|---|---|
| ∅ → REQUESTED | 6.10.1 | Entry is FOA_VERIFIED or later and not WITHDRAWN, DISQUALIFIED or REJECTED_INELIGIBLE. Category is `physicalEligible` | `artworkCode`; `artwork.requested` |
| REQUESTED → NOT_REQUIRED | `cancelPhysicalRequest` (CM/SA); entry withdrawn, rejected or disqualified | Not yet received | `artwork.requestCancelled` |
| REQUESTED → DISPATCHED | `recordArtworkDispatch` by the responsible party. One ArtworkShipment may group several artworks from the same institution or Owner | Courier, tracking number, dispatch date no later than today, ARTWORK_DISPATCH declaration | `isLateDispatch` if after the deadline; `artwork.dispatched` |
| REQUESTED or DISPATCHED → RECEIVED | `recordArtworkReceipt` (SA, CM) | Identified by label, code or tracking number. At least 1 RECEIPT photo. `packageIntact` recorded | Custody RECEIVED; `artwork.received` (Phase 5 acknowledgement) |
| RECEIVED → VERIFIED | `verifyArtwork` (SA, CM) | Every checklist item passes. At least 2 VERIFICATION photos (front, and back with the label). Width and height recorded (plus depth for CRAFT), with medium, `condition` and `storageLocation` | Custody STORED; `artwork.verified`; `physicalReady` becomes true |
| RECEIVED → DISCREPANCY | `verifyArtwork` with a failed item, or `raiseArtworkDiscrepancy` | `discrepancyType` and notes | `discrepancyResponseDueAt = now + 7 d`; `artwork.discrepancyRecorded` |
| DISCREPANCY → VERIFIED | `resolveArtworkDiscrepancy` (CM, SA) | Resolution note; the failed items now pass | `artwork.discrepancyResolved` |
| VERIFIED ⇄ IN_EXHIBITION; RETAINED → IN_EXHIBITION | `moveArtwork` (SA, CM) | Location | Custody EXHIBITED or STORED |
| VERIFIED, IN_EXHIBITION or RETAINED → LISTED_FOR_AUCTION → SOLD; LISTED_FOR_AUCTION or SOLD → `statusBeforeListing` | §8 only (`setAuctionState`) | §8, with consent per §12.4 | Listing stores `statusBeforeListing`; custody HANDED_TO_AUCTION |
| RECEIVED, VERIFIED, IN_EXHIBITION or DISCREPANCY → RETURNED | `recordArtworkReturn` (SA, CM) | COURIER with tracking, or HAND_OVER with the recipient's name. Not allowed while LISTED_FOR_AUCTION or SOLD | Custody RETURNED; `artwork.returned` |
| VERIFIED or IN_EXHIBITION → RETAINED | `retainArtwork` (SA) | The return policy allows it, and no return request is open | Custody RETAINED; `artwork.retained` |

**Verification checklist (Phase 14).** Each item is marked pass or fail, with a note: (1) The artwork code matches the label. (2) The creator is the entry's participant. (3) The artwork matches the digital submission, compared side by side with the WEB derivative. (4) The physical condition is graded. (5) Dimensions and medium are recorded. (6) Required consents and declarations are present: the dispatch declaration, plus §12 consents for any planned public use.

**Discrepancies.** The responsible party can reply with an explanation and documents until `discrepancyResponseDueAt`. CM then either resolves the discrepancy (→ VERIFIED), or rejects or disqualifies the entry (6.9 rows 11 and 15, with PHYSICAL_MISMATCH) and returns the artwork.

**Overdue.** §10 sends `reminder.artworkDispatch`. Seven days after the deadline, any artwork still REQUESTED with `requiredForJudging` goes to the CM queue. CM can extend the deadline, waive the requirement (`waivePhysicalForJudging`, which sets `requiredForJudging = false`), or reject the entry (PHYSICAL_NOT_RECEIVED).

**Custody & storage.** Every receipt, move, auction hand-off, return and retention writes an append-only ArtworkCustodyEvent. `storageLocation` has the form `FACILITY/ROOM/RACK/SHELF`, and its first segment must equal `FoaFacility.code`. The staff UI shows the current location and the full custody chain.

**Return or retain** (`artworkReturnPolicy`):
- **RETURN_AFTER_RESULTS.** At `resultsPublishedAt`, every VERIFIED or IN_EXHIBITION artwork not held by §8 goes into the returns queue.
- **RETAIN_UNLESS_REQUESTED** (default). The responsible party can use `requestArtworkReturn` until `resultsPublishedAt + returnRequestWindowDays`. After that, artworks with no request become eligible for `retainArtwork`.
- **RETAIN.** Returns are not offered, and the competition TERMS (§12) must say so.

The packaging instructions state who pays return shipping. The platform never charges for it. If an entry is withdrawn while its artwork is in transit or in custody, the artwork joins the returns queue once it is received.

### 6.11 Pages & UI

**Public**
- **`/competitions`**: one card per competition showing cover, name, theme, disciplines, age range, next key date, routes, fee or "Free", and a status chip (Upcoming / Registration open / In progress / Results). Filters: status, discipline, age. DRAFT competitions are never listed.
- **`/competitions/[slug]`**: a status-aware call to action (Register / Register your school / Go to dashboard / View results §7), then these sections: theme and welfare message; categories table (discipline × age group, with ages and cutoff); timeline of all dates; rules; how to participate, with the school route marked "Recommended"; judging criteria summary and award scheme; prizes; fees by route; submission formats (the 6.8.3 rules per category); physical artwork requirements; public display and auction notices; consent documents (§12); help contact.
- **`/competitions/[slug]/register`**: the 6.5.3 wizard. Coordinators are redirected to `/institution/competitions/[code]`.
- **`/schools`**: how school participation works, in five steps (Route A plus Phase 3); coordinator responsibilities; open competitions that accept institutions; call to action.
- **`/schools/register`**: the 6.4.1 form. It ends on a "pending verification" page that lists the next steps.

**Institution** (`/institution`, for INSTITUTION_ADMIN and INSTITUTION_COORDINATOR, scoped to their own institution)
- **Overview**: verification banner; per-competition cards with counts by RegistrationStatus and EntryStatus, and a countdown to the next deadline; task list: missing consents, unpaid fees, conduct certification due, shortlisted entries to upload, artworks to dispatch, open discrepancies.
- **`/institution/competitions/[code]`**, with these tabs: **Students**: table, add, edit, CSV import, bulk select to pay or remove, consent state with "resend". **Payments**: batches and receipts (§8). **Conduct**: the certification. **Entries** (scope ALL): bulk upload, grid editor, submit. **Shortlist**: link to §7 school judging, or a create form in SHORTLIST_ONLY; hi-res upload, declaration, submit to FOA, FOA feedback. **Physical artwork**: requests, labels, a dispatch form that groups artworks into one shipment, tracking, receipt and verification state.
- **`/institution/team`** (admin only): members, invitations and removals.
- **`/institution/profile`**: institution details and change requests.

**Participant** (`/dashboard`, for the Owner; guardians get a child switcher)
- **`/dashboard/registrations/[registrationNumber]`**: status with blockers in plain words ("Waiting for guardian consent", "Payment due by …"), plus pay, withdraw, categories, instructions and announcements.
- **`/dashboard/entries/new?registration=…&category=…`** and **`/dashboard/entries/[entryCode]`**: the entry editor. It has an upload widget (progress, scan state, rule violations), an essay editor with live word count, a timer in ONLINE mode, the declaration, submit, receipt, change requests and withdraw. Claimed profiles on the institution route see it read-only.
- **Physical artwork**: request details, label, dispatch form, tracking, state, discrepancy response, return request.

**Admin**
- **`/admin/competitions`**: a list with status, dates and counts. The create/edit wizard has these tabs: Basics; Categories & Age groups; Routes & Fees; Dates; Submission rules; Physical & Returns; Display & Auction; Judging (award scheme, §7 rubric); Prizes; Consents; Review & Publish (runs the 6.3.2 validator). The competition detail page has: a status timeline showing the next scheduled transition, an `autoAdvance` toggle and manual transitions (a reason is required); registrations (filters and CSV export) and institutions; a verification queue: files side by side with the checklist; verify, request changes or reject; duplicate-hash hints; the duplicates queue, extensions, and payments needing review; Instructions and "Message registrants" (§10).
- **`/admin/institutions`**: a queue with pending first, sorted by nearest deadline. The detail page shows the application, principal confirmation, duplicate candidates and checklist; verify, reject or suspend; members, registrations and change requests.
- **`/admin/artwork`**: a board by PhysicalArtworkStatus, and an overdue list; a Receive screen: scan the QR, or type the artwork code or tracking number, then mark the items in the shipment received; a verification form: WEB image side by side, checklist, measurements, condition, camera upload of photos, storage location; discrepancy queue, custody log, returns queue and CSV export.

### 6.12 Server Actions

All of these are Next.js Server Actions that call domain services. Inputs are validated with zod. Each action checks `can()`, writes AuditLog, and returns typed errors: `DEADLINE_PASSED`, `ILLEGAL_TRANSITION`, `INSTITUTION_NOT_VERIFIED`, `SCOPE_SHORTLIST_ONLY`, `SHORTLIST_FULL`, `NOT_FOUND`. An ID outside the caller's scope returns `NOT_FOUND` (§13).

| Action | Input | Authorization | Effect |
|---|---|---|---|
| `createCompetition`, `updateCompetition` | Basics / partial config (routes, age groups, categories, prizes) | CM, SA | Creates DRAFT; enforces 6.3.3 locks; audits the diff |
| `publishCompetition`, `transitionCompetition`, `setCompetitionAutoAdvance`, `cancelCompetition` | id, `to`, reason, optional new date | CM, SA (cancel: SA only) | 6.3.4 |
| `publishInstructions`, `grantSubmissionExtension` | competitionId / targetType, targetId, stage, newDeadline, reason | CM, SA | 6.7 / creates a SubmissionExtension and notifies the Owner |
| `registerInstitution`, `confirmPrincipal` | 6.4.1 fields / token | Signed-in user with verified email and phone / public, via token | 6.4.1 |
| `reviewInstitution` | institutionId, VERIFY, REJECT, SUSPEND or REINSTATE, reason | SA; CM for VERIFY and REJECT | 6.4.2 |
| `requestInstitutionChange`, `reviewInstitutionChange` | Fields / decision | INSTITUTION_ADMIN / SA | CHANGE application |
| `inviteCoordinator`, `removeCoordinator` | Name, email or phone / userId | INSTITUTION_ADMIN (own institution) | 6.4.3 |
| `registerInstitutionForCompetition`, `withdrawInstitutionRegistration` | competitionId, expectedParticipants, coordinator / id, reason | Institution roles (own); withdraw: INSTITUTION_ADMIN | 6.4.4; withdrawal cascades to its registrations |
| `addStudent`, `updateStudent` | institutionRegistrationId, student fields, disciplines | Owner (institution) | 6.5.1; a DOB change re-runs the age group (E3) |
| `uploadStudentImport`, `commitStudentImport`, `discardStudentImport` | File / importId | Owner (institution) | 6.5.2 |
| `resendConsentRequest` | registrationIds[] | Owner | Resends via §12, at most once per 24 h per registration |
| `registerIndividual`, `updateRegistrationCategories` | 6.5.3 fields / registrationId, disciplines | Signed-in adult or guardian / Owner before CONFIRMED, or CM/SA | 6.5.3 / recomputes the fee |
| `createRegistrationPaymentBatch`, `markBatchPaidOffline` | registrationIds[] / batchId, reference, amountMinor | Owner, single scope / FINANCE, SA | 6.6 |
| `waiveRegistrationFees` | registrationIds[] or institutionRegistrationId, reason | CM, SA | Sets `feeWaived`, then re-evaluates |
| `withdrawRegistration` | registrationId, reason | Owner, claimed guardian, SA | 6.6 |
| `cancelRegistration`, `reinstateRegistration`, `addLateRegistration` | registrationId or student fields, reason | CM, SA (reinstate: SA only) | 6.6 |
| `transferRegistration`, `resolveDuplicateRegistration` | registrationId, target / keepId, dropId, mergeProfiles | CM, SA / SA | E1 / E6 |
| `certifyConduct` | institutionRegistrationId, conduct fields, templateId, accepted | Owner (institution) | 6.7 |
| `createEntry`, `updateEntryDraft`, `deleteDraftEntry`, `startTimedEntry` | registrationId, categoryId / entryId, fields | Owner | Row 1; 6.8.5; 6.7 |
| `requestEntryUpload`, `completeEntryUpload`, `removeEntryFile`, `markFileAsHiRes` | 6.8.4 inputs / entryFileId | Owner | 6.8.4 |
| `submitEntry`, `bulkCreateEntries`, `submitEntries` | entryId(s), templateId / categoryId, file ids | Owner (bulk: coordinator, scope ALL) | Row 2; 6.8.2 bulk |
| `createShortlistedEntry`, `submitShortlistedEntryToFoa` | 6.9 service inputs / entryId, templateId | Coordinator (own institution) | Rows 7–8. Coordinators finalize through §7's school-round UI (`finalizeSchoolRound`) |
| `revertSchoolShortlist` | institutionRegistrationId, categoryId | §7 only, from `reopenSchoolRound` (CM/SA); no client action | Row 16 |
| `verifyEntry`, `requestEntryChanges`, `rejectEntry`, `reinstateEntry` | entryId, checklist / note, correctionDueAt / reason | CM, SA (reinstate: SA only) | Rows 3, 9–12 |
| `withdrawEntry`, `disqualifyEntry` | entryId, reason | Owner, CM, SA (row 14: SA only) / CM, SA (from FINALIZED: SA only) | Rows 13–15 |
| `waivePhysicalForJudging`, `requestPhysicalArtwork`, `cancelPhysicalRequest` | entryId, reason / entryIds[], reason, deadline? / artworkId | CM, SA | 6.10.1; waive sets `requiredForJudging = false` |
| `downloadArtworkLabel`, `recordArtworkDispatch` | artworkId / artworkIds[], courierName, trackingNumber, trackingUrl?, dispatchedOn, proofFileId?, templateId | Responsible party (label: CM/SA too) | Label PDF / ArtworkShipment, then DISPATCHED |
| `recordArtworkReceipt`, `verifyArtwork` | shipmentId or artworkCodes[], receivedAt, packageIntact, photos / checklist, dimensions, medium, condition, photos, storageLocation | CM, SA | RECEIVED / VERIFIED, or DISCREPANCY |
| `raiseArtworkDiscrepancy`, `respondToDiscrepancy`, `resolveArtworkDiscrepancy` | artworkId, type, notes / text, files / resolution, outcome | CM, SA / responsible party / CM, SA | 6.10 |
| `moveArtwork`, `recordArtworkReturn`, `retainArtwork`, `requestArtworkReturn` | artworkId, location / method, tracking / reason / — | CM, SA (retain: SA only) / responsible party (request) | Custody event and status change; return request only within the window |

**Jobs:** `competition.advance`: every minute. `paymentBatch.expire`: every 5 minutes. `media.process`: per upload. `entry.autoSubmit`: after media processing. `studentImport.validate`: per import. `artwork.overdueScan`: daily. `studentImport.purge`: daily.

### 6.13 Domain Events

Every payload carries `competitionId`, the subject's `id` and human code, `route`, and `institutionId` / `participantId` where applicable. Payloads never include DOB, address or guardian contact. §10 resolves the recipients (§10.4).

| Events | Emitted in |
|---|---|
| `user.registered` (includes the Participant ID if a profile was created) | First OTP sign-up (6.5.3) |
| `competition.published`, `.registrationOpened`, `.registrationClosed`, `.statusChanged`, `.submissionOpened`, `.scheduleChanged`, `.instructionsPublished`, `.advanceBlocked`, `.cancelled` | 6.3, 6.7 |
| `institution.registered`, `.verified`, `.rejected`, `.suspended`, `.reinstated`; `institutionMember.invited`, `institutionMember.removed` | 6.4 |
| `institutionRegistration.created`, `.certified`, `.withdrawn`; `studentImport.completed` | 6.4.4, 6.7, 6.5.2 |
| `registration.created`, `.confirmed`, `.withdrawn`, `.cancelled`, `.transferred`, `.paymentNeedsReview`, `.duplicateFlagged` | 6.6, 6.14 |
| `entry.submitted`, `.changesRequested`, `.shortlisted`, `.notShortlisted`, `.submittedToFoa`, `.verified`, `.rejected`, `.reinstated`, `.withdrawn`, `.disqualified`, `.shortlistReverted` (silent); `file.quarantined` | 6.8, 6.9 |
| `artwork.requested`, `.requestCancelled`, `.dispatched`, `.received`, `.verified`, `.discrepancyRecorded`, `.discrepancyResolved`, `.returned`, `.retained` | 6.10 |

### 6.14 Edge Cases

- **E1 Student switches school.** Allowed while none of the student's entries is past SUBMITTED and the competition is at or before IN_PROGRESS. CM/SA call `transferRegistration` to move the registration to the new school's InstitutionRegistration, or to INDIVIDUAL (the guardian becomes Owner after §12 verification). The registration number, payment and consents carry over. No fee difference is charged or refunded. Entries move with the registration, and the old school loses access. `ParticipantProfile.institutionId` changes only for future competitions. Later than that, the student stays with the original school for this competition. Importing the student at the new school raises POSSIBLE_CROSS_REGISTRATION, which points staff to the transfer.
- **E2 One participant in two categories.** Allowed when `maxCategoriesPerParticipant ≥ 2`. One Registration with two RegistrationCategory rows. The fee is the base fee plus one additional-category fee. One entry per category, and one PhysicalArtwork per entry. Shortlist size is counted per category. Both categories share the age group, which depends only on DOB.
- **E3 Age-group boundary and DOB correction.** Membership uses the inclusive birth-date interval from 6.3.1. Tests cover a DOB exactly N years before the cutoff, ±1 day, and 29 Feb. A corrected DOB recomputes the age group. If a chosen category no longer fits, the registration gets `eligibilityReviewRequired`. Its entries then can't pass SUBMITTED until CM either fixes the category or rejects the entry (AGE_INELIGIBLE). The Owner can edit the DOB until the first submission. After that, only CM/SA can.
- **E4 Institution not verified when registration closes.** Registrations created before the close stay valid. Verification, consent and payment can finish until `confirmationDeadline`, and these institutions sort first in the verification queue. Registrations still unconfirmed at the deadline are CANCELLED.
- **E5 Payment captured after registration closes.** A registration that is still PENDING_* when `now ≤ confirmationDeadline` is confirmed normally. Otherwise the batch goes to NEEDS_REVIEW (`registration.paymentNeedsReview`), and staff either reinstate the registration (if the competition is at or before IN_PROGRESS), or CM/SA request a refund via §8, which FINANCE approves. There is no automatic refund.
- **E6 Same child registered both individually and through a school.** The unique key on (competition, participant) stops the same profile registering twice. Different profiles are matched on `identityHash`, plus the guardian `phoneHash` when available. The newer registration gets `possibleDuplicateOfId`, emits `registration.duplicateFlagged`, and goes to the duplicates queue. The guardian sees a generic notice: "This child may already be registered for this competition, for example through a school. Please contact us before paying." It never names the school. Default resolution: keep the school registration, cancel the other with a §8 refund, and merge the profiles (entries, consents per §12, guardian link).
- **E7 Consent withdrawn mid-competition.** Handled per §12.6. Withdrawing PARTICIPATION or DATA_PROCESSING before RESULTS_PUBLISHED moves the registration to WITHDRAWN. Withdrawing PUBLIC_DISPLAY or AUCTION_OF_ARTWORK changes no §6 status; §7 and §8 act on it.
- **E8 Upload race at the deadline.** Covered by 6.8.4 (`submitRequestedAt`) and 6.8.5 (no new upload URLs after the deadline). Tests pin the clock.
- **E9 Same image submitted twice.** If another entry in the competition has a `perceptualHash` within Hamming distance 6, the later entry gets `possibleDuplicateOfId`. It is shown in the verification queue and never auto-rejected.
- **E10 Institution suspended mid-competition.** The institution's dashboard becomes read-only. CM can move affected students to INDIVIDUAL (E1) so their artwork can still be dispatched.
- **E11 Participant turns 18 mid-competition.** §12's majority-claim rules apply. Until the participant claims the profile, Owner actions on the INDIVIDUAL route are blocked, and CM/SA can act at the participant's request.
- **E12 Fees or config changed after payments.** Structural fields lock at REGISTRATION_OPEN (6.3.3). Each Registration keeps its own fee snapshot.

### 6.15 Acceptance Criteria

1. **Publish validation.** `publishCompetition` returns a field error for each 6.3.2 rule: no categories; overlapping age groups; misordered dates; INSTITUTION route without `shortlistSubmissionClosesAt`; `physicalTopN > schoolShortlistSize`; physical requirement without a facility.
2. **Scheduler.** One minute after `registrationOpensAt`, `competition.advance` moves PUBLISHED → REGISTRATION_OPEN exactly once, even if it runs twice. With `autoAdvance = false`, nothing changes. After a 3-day outage, it catches up in order, writing one AuditLog row per step.
3. **Early close.** A manual early close sets `registrationClosesAt = now` and emits `competition.registrationClosed` once.
4. **Unverified institution.** A new institution is PENDING_VERIFICATION and can add students. `createRegistrationPaymentBatch` fails with `INSTITUTION_NOT_VERIFIED` until SA verifies it.
5. **CSV import.** A 1,000-row file reaches PREVIEW within 30 s. The error report has `row_number, column, error_code, message` for every bad row. Commit imports only VALID and WARNING rows. Re-importing the same file creates no profiles or registrations, and reports every row as ALREADY_REGISTERED.
6. **Age boundaries.** A DOB exactly `maxAge + 1` years before the cutoff is outside the group. A DOB exactly `minAge` years before the cutoff is inside the group. The server rejects categories outside the computed age group, whatever the client sends.
7. **Login.** `/login` never accepts a registration number. A Participant ID login sends the OTP only to a verified channel of the profile's user or guardian. A managed-only profile gets `MANAGED_PROFILE`, and nothing is sent.
8. **State machine tests.** Table-driven unit tests cover every allowed and disallowed transition of RegistrationStatus, EntryStatus (6.9), PhysicalArtworkStatus and CompetitionStatus.
9. **Bulk payment.** A 30-student batch makes exactly one `PaymentService.createOrder` call, for the summed amount. `payment.captured` marks all 30 paid, and replaying the webhook changes nothing. With consents present, all 30 become CONFIRMED.
10. **Zero fee and minors.** In a zero-fee competition, PENDING_CONSENT → CONFIRMED creates no Payment row. A minor's individual registration never reaches CONFIRMED without GUARDIAN_VERIFIED.
11. **Capture on a cancelled registration.** The registration stays unchanged, the batch goes to NEEDS_REVIEW, and `registration.paymentNeedsReview` is emitted.
12. **Upload rules.** Oversized or wrong-type uploads are rejected both client-side and by the signed URL or server. A PENDING or INFECTED file blocks submit. WEB and THUMB derivatives of a GPS-tagged fixture contain no EXIF, XMP or GPS data.
13. **Deadline race.** A submit requested at T−1 s whose processing finishes at T+30 s ends SUBMITTED with `submittedAt = submitRequestedAt`. `requestEntryUpload` at T+1 s returns `DEADLINE_PASSED`.
14. **Entry code.** `entryCode` matches `^[A-Z]{3,6}\d{2}-E-[0-9A-HJKMNP-TV-Z]{6}$`, is set exactly once, and survives edits and change requests.
15. **SHORTLIST_ONLY.** Institution-route `createEntry` fails with `SCOPE_SHORTLIST_ONLY`. The (N+1)th shortlisted entry in a category fails with `SHORTLIST_FULL`. A duplicate `schoolRank` fails. `createShortlistedEntry` fails unless the competition is SCHOOL_JUDGING and `now ≤ shortlistSubmissionClosesAt` (or a SHORTLIST extension). §6 never emits `schoolShortlist.finalized`; §7 `finalizeSchoolRound` does.
16. **Submit to FOA.** `submitShortlistedEntryToFoa` fails without a ConductCertification (PHYSICAL_AT_INSTITUTION), without a HIRES_SCAN of at least 3,000 px, or after the shortlist deadline with no extension.
17. **Automatic physical request.** Verifying an individual DRAWING entry creates one REQUESTED PhysicalArtwork with a valid `artworkCode`, `dispatchDeadline = now + physicalDispatchDays` and `requiredForJudging = true`, and emits `artwork.requested`. A school entry with `schoolRank > physicalTopN` gets no PhysicalArtwork.
18. **Physical readiness.** For a `requiredForJudging` artwork, `physicalReady` stays false until the artwork is VERIFIED. After `waivePhysicalForJudging` it is true.
19. **Artwork handling.** Dispatch requires courier, tracking number and the declaration. Receipt works from both REQUESTED and DISPATCHED. `verifyArtwork` fails with fewer than 2 photos or without dimensions. A failed checklist item results in DISCREPANCY. Every receipt, move and return writes an ArtworkCustodyEvent.
20. **Withdrawal cascade.** Withdrawing a CONFIRMED registration withdraws its live entries and moves its REQUESTED artworks to NOT_REQUIRED, in one transaction.
21. **Duplicate detection.** An individual registration whose `identityHash` matches a school registration is flagged and appears in the duplicates queue. The guardian's notice contains no institution name.
22. **Authorization.** A coordinator of institution X gets `NOT_FOUND` for any student, registration, entry, import or artwork of institution Y. Every action has an allowed-role test and at least one denied-role test.
23. **Atomic transitions.** A failure forced after the status write rolls back the transition, the AuditLog row and the Outbox row together.

### 6.16 Open Questions (this section)

- **Default digital submission scope** (the source debates "top five or all"). Default: `ALL`. `SHORTLIST_ONLY` can be chosen per competition.
- **Are school-shortlisted entries judged digitally or physically by FOA?** Phase 9 says digitally; end-to-end step 7 says physically. Default: the admin UI pre-fills `physicalTopN = schoolShortlistSize`, and §7 rounds use `requiresPhysicalVerified`. Setting `physicalTopN` to null makes judging digital-only.
- **Login credential (D6-1).** Default: Participant ID, email or phone, plus OTP. The registration number is never a credential.
- **Shortlist size per school.** Default: 5 per institution per category (the source says "Top 5 or Top 10").
- **Can institutions start before they're verified?** Default: yes, they can register and add students. Payment, confirmation and submission wait for verification, up to `confirmationDeadline` (default `conductStartsAt`).
- **Institution verification evidence.** Default: a staff check plus principal email confirmation or a logged phone call. No documents are mandatory; the affiliation code is optional.
- **Who pays on the school route?** Default: the institution, in bulk, online or offline (FINANCE records offline payments). Per-parent pay links come after the MVP.
- **Refund on withdrawal.** Default: none after CONFIRMED, except for competition cancellation and duplicate resolution. CM/SA may request discretionary refunds via §8, which FINANCE approves.
- **Categories per participant.** Default: 1. When `maxCategoriesPerParticipant` is raised, `feeAdditionalCategoryMinor` applies.
- **Artwork return vs. retention, and shipping cost.** Default: `RETAIN_UNLESS_REQUESTED`, with a 30-day request window after results. The instructions state who pays shipping, and the platform never charges for it.
- **Late submissions.** Default: no grace period (`lateGraceMinutes = 0`). Staff can grant extensions per registration or per institution.
- **Image resolution thresholds.** Default: long edge ≥ 1,200 px at submit (2,000 px for photography) and ≥ 3,000 px for the shortlist HIRES_SCAN.
- **School judging under SHORTLIST_ONLY.** Default: it happens offline using §7's framework. The coordinator, or §7's school-round UI, records the outcome through `EntryService.createShortlistedEntry`.
- **Same child registered individually and through a school.** Default: keep the school registration, refund the individual fee, and merge the profiles.
- **Handwritten essays from school conduct.** Default: a scanned PDF or JPEG is accepted under PHYSICAL_AT_INSTITUTION, without a word-count check.
