# Integration Fixes (decisions are final; apply them to your own file only)

Each fix is tagged with the part files it touches: [06] = 06-competitions.md, [07] = 07-judging-results.md, [08] = 08-money.md, [09] = 09-community.md, [10] = 10-11-comms-analytics.md (§10 and §11), [12] = 12-13-privacy-nfr.md (§12 and §13). The integrator handles 00-foundations.md and 14-milestones.md.

General rule for every edit: make the **minimal** change that applies the decision. Keep the existing style. Don't restructure or shorten unrelated text. If a decision adds a row to a table, match the table's columns.

---

### F1. School shortlist reversal [06][07]
- [06] Add a §6.9 EntryStatus row: `SCHOOL_SHORTLISTED | SUBMITTED_TO_FOA | NOT_SHORTLISTED → SUBMITTED`.
  - Trigger: `EntryService.revertSchoolShortlist({ institutionRegistrationId, categoryId })`, called only by §7 when a school round is reopened.
  - Guard: scope ALL, and no entry of that institution × category is FOA_VERIFIED or later.
  - Effects: clears `schoolRank`, `schoolAwardLabel` and `submittedToFoaAt`; emits `entry.shortlistReverted` (silent).
  - Under SHORTLIST_ONLY, entries created by row 7 are soft-deleted on reopen instead (same guard).
  - Add `revertSchoolShortlist` to §6.12.
- [07] Make `reopenSchoolRound` call `EntryService.revertSchoolShortlist` and reference the guard above. Don't describe the reversal as §6-owned without naming the function.

### F2. Withdrawal of judged entries [06][07]
- [06] Extend the §6.9 withdrawal row(s) so that `IN_JUDGING | ELIMINATED | FINALIZED → WITHDRAWN` is allowed.
  - Triggers: SA `withdrawEntry`, or the cascade from a Registration becoming WITHDRAWN (including the system acting on `consent.withdrawn` for PARTICIPATION per §12.6).
  - If results are already published, a §7.15 E3 correction follows (certificate revoked, results corrected).
  - The registration cascade in §6.6 must cover every live entry status, not just those up to FOA_VERIFIED.
- [07] Mirror these in the §7.5 table: ELIMINATED → WITHDRAWN and FINALIZED → WITHDRAWN, plus the existing IN_JUDGING → WITHDRAWN, with the same triggers. Executing them goes through §6's service.

### F3. Registration-fee payment contract [06][08]
- Canonical contract: one order per `RegistrationPaymentBatch`. `PaymentService.createOrder({ purpose: REGISTRATION_FEE, refType: 'RegistrationPaymentBatch', refId: batchId, amountMinor: batch total = sum of RegistrationPaymentBatchItem.amountMinor, … })`. An individual registration pays through a batch of one.
- Partial refunds are expressed as a list of `RegistrationPaymentBatchItem` ids; the amount is the sum of those items. Drop `perSeatFee × seatCount`.
- Offline payment: §6 `markBatchPaidOffline` calls `PaymentService.recordOfflinePayment({ refType: 'RegistrationPaymentBatch', refId, … })`. Authorization: FINANCE or STAFF_ADMIN.
- [08] Update §8.2.1 (allowed refTypes), §8.3, the §8.9 `recordOfflinePayment` authorization (FINANCE, STAFF_ADMIN) and any refund text accordingly.
- [06] Make sure §6 matches: `markBatchPaidOffline` calls `recordOfflinePayment`, with FINANCE or STAFF_ADMIN.

### F4. School shortlist service contract [06][07]
- §7's school round calls `EntryService.applySchoolShortlist({ institutionRegistrationId, categoryId, shortlisted: [{ entryId, schoolRank, schoolAwardLabel }], notShortlistedEntryIds })` once per category on finalize (scope ALL). Under SHORTLIST_ONLY it uses `createShortlistedEntry`.
- **§7 `finalizeSchoolRound` is the sole emitter of `schoolShortlist.finalized`**, exactly once per school round. Payload as §7.3 defines it, with lists per category.
- [06] Remove `finalizeSchoolShortlist` as a coordinator action and as an emitter, and remove the auto-finalise emit. Coordinators finalize through §7's school-round UI. Update §6.9 text, §6.12, §6.13 and the related acceptance criterion.
- [07] Replace any `applySchoolDecision` reference with `applySchoolShortlist` as above.

### F5. School-judging window: one source of truth [06][07]
- Settings live on Competition (§6): `schoolShortlistSize` and `shortlistSubmissionClosesAt`. [07] Remove `shortlistPerCategory` and `deadline` from `SchoolJudgingPolicy`; §7 reads the §6 fields. A per-school extension is §6's `SubmissionExtension(kind SHORTLIST)`. Keep `deadlineOverride` only if it maps to that, otherwise remove it.
- **School rounds open when the competition enters SCHOOL_JUDGING** (at `submissionClosesAt`), in both scopes. [06] Under SHORTLIST_ONLY, the row-7 guard becomes `competition.status = SCHOOL_JUDGING and now ≤ shortlistSubmissionClosesAt (or extension)`. [07] Remove opening at conduct certification.
- **End of window:** no auto-finalise and no auto-forfeit. At `shortlistSubmissionClosesAt` an unfinished school round becomes OVERDUE (§7.15 E5 handling: staff close it PARTICIPATION_ONLY or enter results from the school's evidence). [06] Remove the §6.3.4 auto-finalise. The **SCHOOL_JUDGING → FOA_JUDGING** guard is "every school round is FINALIZED or CLOSED_BY_FOA, and a §7 rubric resolves for every enabled discipline". Because FOA rounds only open in FOA_JUDGING, no SUBMITTED_TO_FOA happens during FOA_JUDGING; keep §6's rule.

### F6. Multi-category uniqueness [07]
- `SchoolResult @@unique([roundId, registrationId, categoryId])`.
- Certificate gets `categoryId String?`. The partial unique becomes `(registrationId, categoryId, type, roundId)`, while PARTICIPATION stays one per registration (categoryId null).

### F7. Stale captures and refund requesters [06][08]
- §6 owns it: a capture for a registration that is no longer payable puts the batch in NEEDS_REVIEW and emits `registration.paymentNeedsReview`. There is no automatic refund.
- System refunds that skip approval: only competition cancellation and duplicate resolution.
- Registration-fee refunds may be **requested** by COMPETITION_MANAGER or STAFF_ADMIN and are **approved** by FINANCE (dual approval above the threshold still applies).
- [08] Update §8.2.4, §8.2.5, §8.3, §8.9 (`requestRefund` adds CM and SA for REGISTRATION_FEE only) and §8.12.
- [06] Make line-level text consistent: CM/SA request via §8, FINANCE approves.

### F8. Event keys: casing and reminders [08][09][10]
All keys use lowerCamelCase on both sides of the dot. Reminders are `reminder.<name>` keys owned by §10 and are not emitted by sections.
- [08] Renames: `recurring.*` → `recurringDonation.*` (activated, chargeFailed, halted, paused, resumed, cancelled, charged; §8.4.5 MUST emit `recurringDonation.charged` per successful charge). Also `donation.receipt_issued` → `donation.receiptIssued`, `reconciliation.issue_found` → `reconciliation.issueFound`, `lot.payment_overdue` → `lot.paymentOverdue`, `lot.second_chance_offered` → `lot.secondChanceOffered`, `finance.period_locked` → `financialPeriod.locked`, `finance.period_published` → `financialPeriod.published`, `finance.report_published` → `financialReport.published`, `budget.threshold_exceeded` → `budget.thresholdExceeded`. Remove `lot.closing_soon` and `lot.payment_reminder` as emitted events and say §10 handles them as `reminder.lotClosing` (T−1 h before close, to watchers and bidders) and `reminder.auctionPayment` (T−24 h and T−2 h before the payment deadline). Keep `lot.scheduled`.
- [09] Remove `event.reminderDue` (use §10's `reminder.eventStarting`). Turn `animal.staleReminder`, `adoption.followUpDue`, `organization.reverificationDue` and `ambassador.expiring` into references to §10 reminders: `reminder.animalStale`, `reminder.adoptionFollowUp`, `reminder.orgReverification`, `reminder.ambassadorExpiring`. Rename any snake_case keys to camelCase.
- [10] Rename `lot.listed` → `lot.scheduled`. Add the reminder rows above, with the stated timings, plus `reminder.auctionPayment` timing T−24 h and T−2 h, after which `lot.paymentOverdue` fires. Use the §8 renamed keys.

### F9. Event keys: §12 [12][10]
- [12] Use these names: `safeguardingReport.submitted` (not `.filed`), `dataExport.ready` and `dataErasure.completed` (not `dataRequest.completed`). §12 emits `consent.requested` (when a §12.5 guardian link/OTP request is sent) and `user.contactChanged`.
- [10] Add §10.3 rows:
  - `dataRequest.received` (requester; acknowledgement + SLA)
  - `participant.reachedMajority` (the participant at 18, plus the guardian; claim-account invite)
  - `guardian.verified` (silent; consumed by §6)
  - `consent.refused` (silent)
  - `safeguardingReport.escalated` (DSL designation holders + SUPER_ADMIN; staff-only)
  - `content.reported` (moderators; staff-only)
  - `incident.declared` (SUPER_ADMIN + DSL; staff-only)

### F10. Missing §10.3 rows for message-carrying events [10][07]
- [10] Add §10.3 rows for these events, which imply a message. Everything else a section emits that isn't in §10.3 is analytics-only: add one sentence to §10.3 saying "Events not listed here are recorded for analytics only and send nothing; a section that wants a message must add a row".
  - **§6:** `institution.suspended`, `institution.reinstated` (IA/IC); `institutionMember.removed` (removed member); `institutionRegistration.withdrawn` (IA, CM); `studentImport.completed` (uploader, in-app); `registration.withdrawn`, `registration.transferred`, `registration.paymentNeedsReview` (FINANCE/CM, staff), `registration.duplicateFlagged` (guardian + CM); `entry.reinstated` (PC); `schoolShortlist.finalized` (row exists in text, give it a proper row; owner §7); `file.quarantined` (uploader); `artwork.requestCancelled` (sender); `artwork.discrepancyResolved` (sender); `artwork.retained` (PC).
  - **§7:** `schoolRound.opened` (IA/IC), `schoolRound.overdue` (IA/IC/CM), `schoolRound.reopened` (IA/IC); `judgingRound.reopened` (assigned judges); `results.corrected` (affected PC + C); `results.approvalRequested` if missing; `certificateBundle.generated` (requester, in-app); `prizeFulfilment.created` (PC/guardian: request delivery address; NEW, §7 emits it); `prize.dispatched`, `prize.delivered` (PC); `galleryItem.unpublished` (PC/guardian); `socialPost.takedownRequired`, `socialPost.takedownOverdue` (CONTENT_MANAGER, staff).
  - **§8:** `refund.failed` (FINANCE); `donation.refunded` (donor); `recurringDonation.activated|halted|paused|resumed|cancelled|charged` (donor); `lot.secondChanceOffered` (offered bidder); `lot.acknowledged` (creator/guardian + institution: artist thank-you letter); `lot.cancelled` (winner, if any); `lot.sold`/`lot.delivered` (buyer); `lot.extended` (silent unless a watcher feature exists).
  - **§9:** `event.updated` (registrants); `community.joinRequested` (guardian, for approval); `community.invited` (the post-competition invitation; recipient per §10.4); `volunteerApplication.guardianApprovalRequested` (guardian); `volunteerAssignment.assigned` (volunteer); `organization.verificationExpired`, `organization.suspended` (ORG_REP); `adoptionApplication.infoRequested` (applicant); `contactMessage.replied` (sender).
- [07] Emit `prizeFulfilment.created` when a PrizeFulfilment is created; that is where the §7.8 "Address request (§10)" comes from.

### F11. Artwork auction states [06][08][12]
- [08] Lot creation guard 1 accepts PhysicalArtworkStatus ∈ {VERIFIED, IN_EXHIBITION, RETAINED}. Store `PhysicalArtwork.statusBeforeListing` (or on the lot). On a lot that is cancelled, unsold or unscheduled, revert to `statusBeforeListing` via `setAuctionState`. On cancellation of a **paid/shipped** lot, §8 calls `setAuctionState` to revert SOLD → `statusBeforeListing`, or calls §6 `recordArtworkReturn` if the work goes back to the creator.
- [06] Allow in §6.10.2: `LISTED_FOR_AUCTION → statusBeforeListing` and `SOLD → statusBeforeListing` (via §8 `setAuctionState` only). Add the `statusBeforeListing` field to PhysicalArtwork.
- [12] §12.6 AUCTION_OF_ARTWORK withdrawal: the lot is cancelled if not yet closed, and the artwork reverts to its pre-listing status via §8 → `setAuctionState`. Remove "RETAINED or RETURNED according to §8".

### F12. Physical readiness [06][07]
- [06] Define `ArtworkService.physicalReady(entryId)` = `!artwork.requiredForJudging || artwork.status ∈ {VERIFIED, IN_EXHIBITION, RETAINED}`. `waivePhysicalForJudging` sets `requiredForJudging = false`.
- [07] §7.2: a round with `requiresPhysicalVerified` admits an entry iff `ArtworkService.physicalReady(entryId)`. Delete the inline rule.

### F13. Volunteer certificates [07]
- Certificate: `competitionId`, `registrationId` and `participantId` become optional. Add `subjectUserId String?` with CHECK: exactly one of `participantId` / `subjectUserId` is set; `competitionId` and `registrationId` are required unless type = VOLUNTEER_SERVICE.
- Add a §7.7 trigger row: VOLUNTEER_SERVICE, issued by §9.8 `issueVolunteerCertificate`, with data (hours, period, skills).
- `/verify` rendering for VOLUNTEER_SERVICE shows display name, "Volunteer service", period, hours and status. No competition.

### F14. Disqualification authority [07]
- §7.5 and §7.13: DISQUALIFIED from IN_JUDGING or ELIMINATED by CM/SA; **from FINALIZED by SA only** (matches §6).

### F15. Minors and money [08][12]
- Decision: **minors cannot donate or bid online.** A guardian donates on their behalf.
- [12] Remove the `MINOR_DONATION_MAX_INR` allowance from §12.7 and replace it with "Minors cannot donate or bid (§8)". Remove the ₹1,000 donation-cap open question, or mark it resolved.
- [08] Define adulthood: `isAdult(userId)` is false iff the user has their **own** ParticipantProfile (`ParticipantProfile.userId = userId`) with age < 18. Users without one self-declare 18+ when they accept the donation/auction terms. Guardians who manage a minor's profile are not minors. Fix every "owning a ParticipantProfile aged under 18" wording.

### F16. Prize ledger posting [07][08]
- [07] §7.8 posts with `category: 'PRIZES_AWARDS'` and `sourceType: 'PRIZE_FULFILMENT'`.
- [08] Add `PRIZE_FULFILMENT` to `LedgerSourceType`, and a §8.6.2 posting row: "Prize dispatched with a recorded cost → EXPENSE PRIZES_AWARDS".

### F17. Rubric reference [06]
- Drop `Competition.rubricId`. Wherever §6 guards on it, use "a §7 PUBLISHED rubric resolves for every enabled discipline". This applies to both IN_PROGRESS → SCHOOL_JUDGING and SCHOOL_JUDGING → FOA_JUDGING.

### F18. Engagement wiring [09]
- Delete the sentence saying owning sections MAY call EngagementService directly.
- Grant FOA_FINALIST only when an entry reaches status FINALIZED with `finalOutcome ∈ {WINNER, RUNNER_UP, FINALIST, SPECIAL_MENTION}`, not for SPECIAL_MENTION on ELIMINATED entries.
- Keep the subscription list you already have (`registration.confirmed`, `certificate.issued`/`.revoked`, `results.published`, …). The integrator updates §3.6 to match it.

### F19. Donation receipt delivery [08][10]
- `donation.captured` → a thank-you message only (no attachment).
- `donation.receiptIssued` (emitted by §8 after the PDF renders) → the message carries a **signed download link valid 7 days**.
- [10] Add or fix the §10.3 row. Update §10.7: there are no attachments at all, links only.
- [08] Make the text consistent with this.

### F20. Safeguarding lead recipients [10]
- Add `SAFEGUARDING_DESIGNATION` (active DSL and DEPUTY_DSL holders) as a `RecipientRef` kind in §10.1/§10.4.
- Replace "safeguarding lead" with it in §10.3.
- §11.8: the safeguarding queue is visible to DSL/deputy designation holders and SUPER_ADMIN only (not STAFF_ADMIN). Use the severity-based SLA from §12.9: CRITICAL acknowledged ≤ 1 h and triaged ≤ 4 h; HIGH ≤ 24 h; MEDIUM/LOW ≤ 72 h.

### F21. Numbers aligned to §12 [10]
- Small-cell suppression threshold **k = 10** everywhere in §11 (and public counters rounded down to the nearest 10, as already stated).
- Gallery/content moderation queue SLA: **24 h** (§11.8).
- Data-export download link: **72 h** (§10.3 `dataExport.ready`).
- `Notification` rows retained **365 days**; in-app items 180 days (§10.2).

### F22. §14 alignment (integrator does this; nothing for the section agents)

### F23. Prizes & award schemes [06][07]
- [06] `CompetitionPrize` gets `prizeType: CERTIFICATE_ONLY | TROPHY | MEDAL | CASH | VOUCHER | OTHER`. Note that `Competition.awardScheme` is the **default** award scheme for the final round; §7 rounds may override it.
- [07] `AwardBand.prizeId String?` → CompetitionPrize. PrizeFulfilment is driven from the band's linked CompetitionPrize. Remove any free-text prize field it replaces.

### F24. Auction consent text vs creator payouts [12]
- §12.3 AUCTION_OF_ARTWORK document text: "the creator receives no payment unless the competition's proceeds policy sets a creator share, which this form states".

### F25. fundsRaisedMinor [09][10]
- Single definition: the sum of ledger INCOME in the donation categories over PUBLISHED months, read from §8's `TransparencySnapshot`.
- [10] Update §11.7 and its acceptance criterion: it must equal the transparency page's donations total for the same period.
- [09] Update §9.4.5 to reference this.

### F26. §13 values [12][10]
- [12] §13.2: WEB derivative = **2,048 px long edge** (AVIF/WebP is fine). §13.1: the 10 MB PDF limit applies to user uploads; staff-uploaded AwarenessResource PDFs may be up to 25 MB.
- [12] §13.9 SMS env vars: `SMS_PROVIDER_API_KEY`, `SMS_DLT_SENDER_ID`, `SMS_DLT_ENTITY_ID`. Remove `SMS_DLT_TEMPLATE_IDS` (template IDs live on `NotificationTemplate.dltTemplateId`).
- [12] §13.8 flags: add `SMS_CHANNEL` and `WHATSAPP_CHANNEL`, and describe `SOCIAL_PUBLISHING` as "API posting to social networks (post-MVP, §7.11); MVP is manual export".
- [10] Use `SMS_CHANNEL` / `WHATSAPP_CHANNEL` instead of `channel.sms` / `channel.whatsapp`, and the §13.9 env var names instead of `MSG91_SENDER_ID` / `DLT_PE_ID`.

### F27. Undefined models [08][12]
- [08] Define in §8.4: `DonationQuery.totalForFund(fundId, since?: Date) => { amountMinor, currency, donorCount }`, computed from CAPTURED donations net of refunds.
- [12] Define `PendingRegistration` in §12.5: `{ id, competitionId, participantDraft Json, guardianId, accountHolderUserId?, consentRequestId, expiresAt, status: AWAITING_GUARDIAN | COMPLETED | EXPIRED, createdAt }`. It holds an individual minor's registration until guardian verification. §6 converts it to a Registration on `guardian.verified`.
- [12] Define in §13: `Setting { key String @id, value Json, updatedBy String, updatedAt DateTime }`, the runtime configuration table that SUPER_ADMIN edits. Each section's config keys live here, and changes are audit-logged.

### F28. Enum/status misuse [07][10]
- [10] §10.3: replace "DRAFT registrations" with "registrations in PENDING_CONSENT or PENDING_PAYMENT".
- [10] §11.8: the "awaiting FOA verification" queue = `status = SUBMITTED_TO_FOA` OR (`route = INDIVIDUAL` AND `status = SUBMITTED`).
- [10] §10.6 and §11.4: define a distinct analytics enum `AnalyticsAgeBand` in §11.4, and have the §10.6 segment builder use the competition's AgeGroup ids instead of §9's `AgeBand`.
- [07] §7.3: InstitutionRegistration status is ACTIVE (not "confirmed").
