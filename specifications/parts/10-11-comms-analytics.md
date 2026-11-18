## 10. Notifications & Communications

§10 owns `NotificationService` (§3.5), templates, channel adapters, preferences, suppression, announcements and the reminder scheduler. Every user-facing email, SMS or in-app message MUST go through `NotificationService`. No other module calls SES or MSG91 directly.

### 10.1 Pipeline & Service Contract

```
domain service tx ──► Outbox row (§3.3)
   `outbox.dispatch` (a loop in `worker`, not a pg-boss schedule: LISTEN on a direct connection + 5 s poll, §2.2) fans each row out to:
      ├─► queue `notify.route`      (singletonKey = outboxId)  ─► EventRoute registry ─► resolvers (§10.4) ─► NotificationService.notify()
      └─► queue `analytics.ingest`  (singletonKey = outboxId)  ─► ProductEvent (§11.4)
notify()      ─► per recipient × channel: gates (§10.5) ─► Notification row (QUEUED | SUPPRESSED) ─► queue `notify.send.<channel>.<txn|bulk>`
notify.send   ─► render template ─► ChannelAdapter.send() ─► SENT ─► provider webhook ─► DELIVERED | BOUNCED | FAILED
job `notify.reminders` (every 15 min) evaluates reminder rules (§10.3) against current state ─► notify()
```

- **Outbox payloads** carry IDs and event facts only (`{ aggregateType, aggregateId, competitionId?, participantId?, institutionId?, reasonCode?, … }`). They never carry rendered text or contact data. Resolvers load names and contacts at send time, so contact changes and erasures (§12) take effect.
- **`EventRoute` registry** (`src/server/domain/notifications/routes.ts`, code, not DB): `{ eventKey, payloadSchema: zod, audiences: [{ audience, resolver, channels, category, digest?: 'COORDINATOR_DAILY', smsFallback?: boolean, bypassQuietHours?: boolean }] }`. Template key = `<eventKey>.<audience>`. Audiences: `participant` (adult, self), `guardian`, `minor`, `coordinator`, `institution`, `judge`, `buyer`, `creator`, `donor`, `applicant`, `staff`, `address`.
- **Reminders are not domain events.** They use keys `reminder.<name>` and are computed from current state when the job runs, so nobody is reminded about something already done.
- **OTP bypasses the Outbox.** `NotificationService.sendOtp({ to, channel, code, purpose })` sends synchronously on queue `notify.send.priority`. The stored payload has the code redacted.

```ts
type RecipientRef =
  | { kind: 'USER'; userId: string }
  | { kind: 'PARTICIPANT'; participantId: string }                       // expanded per §10.4
  | { kind: 'INSTITUTION'; institutionId: string; memberRoles?: ('AUTHORISED_PERSON'|'COORDINATOR')[]; includePrincipal?: boolean }
  | { kind: 'ROLE'; role: Role; scopeId?: string }                         // staff (in-app; email only where the route says so)
  | { kind: 'SAFEGUARDING_DESIGNATION' }                                   // active DSL and DEPUTY_DSL holders (§12.9), expanded per §10.4
  | { kind: 'ADDRESS'; email?: string; phone?: string; name?: string; locale?: string } // non-users

// §3.5 signature preserved; opts is additive
NotificationService.notify(eventKey: string, recipients: RecipientRef[], payload: object,
  opts?: { dedupeKey?: string; sendAt?: Date; announcementId?: string }): Promise<{ notificationIds: string[] }>
NotificationService.sendOtp(args: { to: string; channel: 'EMAIL'|'SMS'; code: string; purpose: string }): Promise<void>

interface ChannelAdapter {
  channel: NotificationChannel
  send(m: RenderedMessage): Promise<{ providerMessageId: string }>  // throws RetryableError | PermanentError
  parseWebhook?(req: Request): Promise<DeliveryEvent[]>
}
```

Adapters: `SesEmailAdapter` (implements §2 `EmailProvider`; Amazon SES `ap-south-1`), `Msg91SmsAdapter` (implements §2 `SmsProvider`), `InAppAdapter` (writes `InAppNotification` and marks DELIVERED immediately), and `WhatsAppAdapter`, which is post-MVP behind feature flag `WHATSAPP_CHANNEL` (Meta Cloud API or a BSP, with the approved template name in `providerTemplateId`).

### 10.2 Data Model

```prisma
enum NotificationChannel  { EMAIL SMS IN_APP WHATSAPP }
enum NotificationCategory { TRANSACTIONAL OPERATIONAL ENGAGEMENT }
enum NotificationStatus   { QUEUED SENT DELIVERED FAILED BOUNCED SUPPRESSED CANCELLED }
enum SuppressionReason    { SUBJECT_ERASED NO_CONTACT CONTACT_UNVERIFIED MINOR_POLICY SUPPRESSION_LIST
                            NO_COMMUNICATION_CONSENT PREFERENCE_OFF FREQUENCY_CAP TEMPLATE_MISSING }

model NotificationTemplate {
  id String @id; key String /* "<eventKey>.<audience>" | "announcement.<slug>" */; channel NotificationChannel
  locale String @default("en-IN"); version Int; category NotificationCategory
  subject String?            // EMAIL subject / IN_APP title, ≤120 chars
  body String                // logic-less {{var}} Markdown (EMAIL, IN_APP); exact DLT-approved text (SMS)
  variables Json             // [{ name, type: STRING|INT|DATE|DATETIME|MONEY|URL|SHORT_URL|CODE|TEXT_BLOCK|LIST, required, maxLength? }]
  dltTemplateId String?      // SMS: required to activate
  providerTemplateId String? // MSG91 template id; WhatsApp template name
  active Boolean @default(false) // partial unique index: one active per (key, channel, locale)
  createdByUserId String; activatedByUserId String?; activatedAt DateTime?; createdAt DateTime @default(now())
  @@unique([key, channel, locale, version])
}

model Notification {
  id String @id; eventKey String; templateId String /* exact version rendered */; channel NotificationChannel
  category NotificationCategory; audience String; outboxId String?; announcementId String?
  recipientUserId String?; recipientGuardianId String?
  toAddress String           // lowercased email | E.164 phone | userId (IN_APP)
  subjectParticipantId String? // participant the message is about
  payload Json?              // validated merge vars; nulled after 90 days (job `notify.redact`); row kept 365 days
  dedupeKey String @unique; status NotificationStatus @default(QUEUED); suppressedReason SuppressionReason?
  scheduledFor DateTime?; attempts Int @default(0); lastError String?; providerMessageId String? @unique
  sentAt DateTime?; deliveredAt DateTime?; failedAt DateTime?; createdAt DateTime @default(now())
  @@index([status, scheduledFor]) @@index([toAddress]) @@index([announcementId, status]) @@index([subjectParticipantId])
}

model NotificationPreference { userId String; category NotificationCategory /* OPERATIONAL | ENGAGEMENT only */; channel NotificationChannel; enabled Boolean; updatedAt DateTime; @@id([userId, category, channel]) }
model SuppressionEntry { id String @id; channel NotificationChannel; address String; scope SuppressionScope /* ALL | NON_TRANSACTIONAL | ENGAGEMENT */; reason String /* HARD_BOUNCE|COMPLAINT|UNSUBSCRIBED|INVALID_NUMBER|MANUAL */; sourceNotificationId String?; createdByUserId String?; createdAt DateTime; @@unique([channel, address, scope]) }
model InAppNotification { id String @id; userId String; notificationId String @unique; title String; body String; linkUrl String?; category NotificationCategory; readAt DateTime?; createdAt DateTime; @@index([userId, readAt]) } // purged after 180 days
model ShortLink { code String @id /* 8 base32 */; targetUrl String; createdAt DateTime; expiresAt DateTime? } // served at /s/[code] on the DLT-whitelisted domain
// Announcement: §10.6
```

### 10.3 Event Catalogue

Legend. **PC** = participant contact set (§10.4): guardian for a minor, the participant if adult. **C** = coordinators + `INSTITUTION_ADMIN` of the registration's institution (institution route only). C gets in-app at once plus the 18:00 IST daily digest email, unless marked *now* (immediate email). **IA** = authorised person (+ principal where marked). **Sub** = submitter (C *now* on the institution route, PC on the individual route). **Staff(R)** = in-app to holders of role R in scope. Channels: E email, S SMS, I in-app (only if the recipient has a `User`). Category: **T** transactional, **O** operational, **G** engagement. The emitter section is in brackets. Names are proposals for the integrator to reconcile with §6–§9 and §12.

Events not listed here are recorded for analytics only and send nothing; a section that wants a message must add a row.

| Event key [emitter] | Recipients | Ch | Cat | Template summary |
|---|---|---|---|---|
| `otp.requested` [auth; sync] | address entered | E or S | T | 6-digit code, 10-min expiry, "never share". Ignores quiet hours and caps |
| `user.registered` [§6] | USER | E, I | T | Welcome, verify-email link, Participant ID if created |
| `user.contactChanged` [§12] | old + new address | E/S | T | Security notice with "wasn't you?" link |
| `institution.registered` [§6] | IA + principal; Staff(STAFF_ADMIN) | E; I | T | Received, `institutionCode`, verification pending (target 2 working days) |
| `institution.verified` [§6] | IA + principal; C *now* | E, S, I | T | Verified; dashboard link; add coordinators/students |
| `institution.rejected` [§6] | IA + principal | E | T | Reason, how to reapply |
| `institution.suspended` / `.reinstated` [§6] | IA + principal; C *now* | E, I | T | Suspended: reason, dashboard read-only, no new registrations, payments, submissions or dispatches, contact / reinstated: access restored |
| `institutionMember.invited` [§6] | invitee address | E, S | T | Invite link (7-day expiry), institution name |
| `institutionMember.removed` [§6] | removed member | E, I | T | Access to the institution removed, institution name, contact |
| `institutionRegistration.created` [§6] | IA; C *now* | E, I | T | Competition `reference`, steps to enrol students and pay fees |
| `institutionRegistration.certified` [§6] | Staff(COMPETITION_MANAGER) | I | O | Coordinator certified conduct/judging per FOA guidelines |
| `institutionRegistration.withdrawn` [§6] | IA; Staff(COMPETITION_MANAGER) | E, I; I | T | Competition `reference` withdrawn, reason, effect on student registrations and fees |
| `studentImport.completed` [§6] | uploader | I | T | Rows imported / rejected, link to the error report |
| `registration.created` [§6] | PC; C | E, I | T | `registrationNumber`, pending steps (consent, fee) with links |
| `registration.confirmed` [§6] | PC; C | E, S, I | T | Confirmed: Participant ID + Registration No., login link |
| `registration.cancelled` [§6] | PC; C | E, I | T | Reason; refund status if paid |
| `registration.withdrawn` [§6] | PC; C | E, I | T | Withdrawal confirmed: reason, effect on entries and artwork, refund status if any |
| `registration.transferred` [§6] | PC; C of the old and new institution | E, I | T | Moved to the new school or the individual route; Registration No. unchanged; who manages it now |
| `registration.paymentNeedsReview` [§6] | Staff(FINANCE, COMPETITION_MANAGER) | I | O | Batch, registration, why the capture could not be applied; review link |
| `registration.duplicateFlagged` [§6] | guardian; Staff(COMPETITION_MANAGER) | E, I; I | T | Guardian: generic "may already be registered, contact us before paying" notice that never names the school. Staff: duplicates queue link |
| `reminder.registrationPayment` (T+1 d, T+3 d after create; T-1 d before close) | payer of record (§6/§8) | E, I; S at T-1 | T | Amount, pay link, close date |
| `payment.captured` [§8] (purpose ≠ DONATION) | payer | E, I | T | Receipt: amount, purpose, reference code, PDF link |
| `payment.failed` / `payment.refunded` [§8] | payer | E, I | T | Retry link / refunded amount and settlement time |
| `refund.failed` [§8] | Staff(FINANCE) | E, I | O | Refund, amount, failure reason, retry link |
| `consent.requested` [§12] | guardian | E, S | T | Consents asked, who asked (school/self), signed approve link (7 d) |
| `reminder.consentPending` (T+2 d, T+5 d) | guardian; C | E, S | T | Same link; which steps are blocked |
| `consent.granted` [§12] | guardian / adult; C | E, I | T | Copy of consent version text, withdraw link |
| `consent.refused` [§12] | none (silent) | – | – | – |
| `guardian.verified` [§12] | none (silent; consumed by §6) | – | – | – |
| `consent.withdrawn` [§12] | guardian / adult; C; Staff(COMPETITION_MANAGER) if display/auction affected | E, I | T | Withdrawal confirmed; effects and their deadlines exactly as listed in §12.6 (e.g. gallery unpublish ≤ 24 h, social takedown ≤ 72 h) |
| `competition.published` [§6] | none directly: creates a DRAFT `Announcement` for staff review | – | G/O | Name, theme, disciplines, age groups, dates, register link |
| `reminder.registrationClosing` (T-7, T-2 d) | IA + C of verified institutions not yet registered (O); PC with registrations in PENDING_CONSENT or PENDING_PAYMENT | E, I | O | Close date, register/finish link |
| `competition.instructionsPublished` [§6] (Phase 3) | individual: PC; institution: C *now* | E, I, S (short pointer) | O | Date/time, theme confirmation, permitted materials, duration, submission procedure, physical artwork requirements, deadlines, help contact |
| `competition.scheduleChanged` [§6] | all confirmed PC; C *now* | E, S, I | T | Old → new dates, reason |
| `competition.submissionOpened` [§6] | individual: PC; institution: C *now* | E, S, I | O | Window, upload link, file rules |
| `reminder.submissionClosing` (T-7, T-2, T-1 d) | individual PC with no SUBMITTED entry; C with pending uploads (counts) | E, I; S at T-1 | O | Deadline, items pending, link |
| `competition.cancelled` [§6] | all PC; C; IA | E, S, I | T | Reason, refund policy |
| `file.quarantined` [§6] | uploader | E, I | T | File removed by the virus scan, which entry, re-upload before the deadline |
| `entry.submitted` [§6] | PC; C | E, S, I | T | "Submission received": `entryCode`, title, IST timestamp |
| `entry.changesRequested` [§6] | Sub | E, S, I | T | What to fix, fix-by deadline, link |
| `entry.rejected` [§6] (REJECTED_INELIGIBLE) | PC; C *now* | E, I | T | Reason code, contact link |
| `entry.reinstated` [§6] | PC | E, I | T | Entry reinstated after review, current status, next steps |
| `entry.withdrawn` / `entry.disqualified` [§6/§7] | PC; C | E, I | T | Confirmation / reason |
| `schoolRound.opened` [§7] | IA; C *now* | E, I | O | School judging open: deadline, shortlist size, judging framework link |
| `reminder.schoolJudgingDeadline` (T-7, T-2, T-1 d) | IA + C of institutions with unfinalised shortlist | E, I; S at T-1 | O | Deadline, judged/remaining counts, judging framework link |
| `schoolRound.overdue` [§7] | IA; C *now*; Staff(COMPETITION_MANAGER) | E, I; I | T | Deadline passed, no automatic forfeit; FOA will close the round or enter results from the school's evidence (§7.15 E5); contact |
| `schoolRound.reopened` [§7] | IA; C *now* | E, I | T | Reason, shortlist reverted, deadline, link to finalise again |
| `entry.shortlisted` [§6] (SCHOOL_SHORTLISTED) | PC | E, S, I | T | Shortlisted for FOA-level judging; next steps. Skipped when the payload has `silent: true`. For `SHORTLIST_ONLY`, sent per shortlisted registrant on `schoolShortlist.finalized` instead (§7.3) |
| `entry.notShortlisted` [§6] | PC | E, I | T | Thank-you; participation certificate to follow; future invitations. Sent only once the school finalises its shortlist. For `SHORTLIST_ONLY`, sent per registrant without a shortlisted entry on `schoolShortlist.finalized` |
| `schoolShortlist.finalized` [§7] | `SHORTLIST_ONLY` only: PC of each registrant in the payload's per-category lists | E, S, I (shortlisted); E, I (not shortlisted) | T | Shortlisted / not-shortlisted variants with the same content as `entry.shortlisted` / `entry.notShortlisted`. Under scope ALL it sends nothing (the per-entry events do) |
| `entry.submittedToFoa` / `entry.verified` [§6] | C *now*; PC (I only) | E, I | T | Forwarded to / accepted by FOA |
| `artwork.requested` [§6] | Sub; PC (if Sub = C) | E, S, I | T | `artworkCode`, packaging instructions, FOA address, dispatch deadline, tracking-entry link, declaration |
| `artwork.requestCancelled` [§6] | sender (Sub) | E, I | T | Physical artwork no longer needed; do not dispatch |
| `reminder.artworkDispatch` (T-3, T-1 d; +2 d overdue) | Sub; Staff(COMPETITION_MANAGER) when overdue | E, S, I | O | Deadline, tracking-entry link |
| `artwork.dispatched` [§6] | Sub; Staff(COMPETITION_MANAGER) | E; I | T | Tracking number recorded |
| `artwork.received` / `artwork.verified` [§6] | Sub; PC | E, I; S on received | T | FOA acknowledges receipt / verified with condition summary |
| `artwork.discrepancyRecorded` [§6] | Sub; PC; Staff(COMPETITION_MANAGER) | E, I | T | Discrepancy type, required action, contact |
| `artwork.discrepancyResolved` [§6] | sender (Sub) | E, I | T | Discrepancy resolved, artwork verified |
| `artwork.returned` [§6] | Sub; PC | E, I | T | Courier details |
| `artwork.retained` [§6] | PC | E, I | T | FOA keeps the artwork under the return policy; no return will be made |
| `judgeAssignment.created` [§7] | judge | E, I | T | Round, entry count, deadline, `/judge` link. No participant PII |
| `reminder.judgingDue` (T-3, T-1 d) | judges with unscored assignments; Staff(COMPETITION_MANAGER) | E, I | O | Remaining count, deadline |
| `judgingRound.reopened` [§7] | judges assigned to the round | E, I | T | Round reopened, reason, deadline, `/judge` link. No participant PII |
| `results.approvalRequested` [§7] | Staff(STAFF_ADMIN, COMPETITION_MANAGER) | E, I | O | Competition, approval link |
| `results.published` [§7] | PC per entry (variant by `finalOutcome`; ELIMINATED → participant variant); C *now* (institution summary); IA | E, S, I | T | Outcome, award label, results link. Staff get a public G announcement as a draft |
| `results.corrected` [§7] | PC of each affected entry; C *now* | E, I | T | What changed, new outcome and award label, old certificate revoked and new one issued, results link |
| `certificate.issued` [§7] | PC; C (bulk-download digest) | E, I | T | `certificateNumber`, verify URL, download link (§7) |
| `certificate.revoked` [§7] | PC; C | E | T | Reason |
| `certificateBundle.generated` [§7] | requester | I | T | ZIP ready, download link (7 d) |
| `prizeFulfilment.created` [§7] | PC | E, I | T | Prize won; request for the delivery address, confirm-address link |
| `prize.dispatched` / `prize.delivered` [§7] | PC | E, I | T | Courier, tracking / delivery recorded |
| `galleryItem.published` [§7] | PC | E, I | T | Gallery link, fields displayed, how to withdraw `PUBLIC_DISPLAY` |
| `galleryItem.unpublished` [§7] | PC | E, I | T | Removed from the public gallery, reason |
| `socialFeature.published` [§7] | PC | E, I | T | Platform + post link, how to withdraw `SOCIAL_MEDIA` |
| `socialPost.takedownRequired` / `.takedownOverdue` [§7] | Staff(CONTENT_MANAGER) | E, I | T | Platform, post link, `takedownDueAt` (72 h, §12.6) / takedown overdue |
| `lot.scheduled` [§8] | creator PC | E, I | T | Lot link, dates; name shown only per consent |
| `lot.extended` [§8] | none (silent unless a watcher feature exists) | – | – | – |
| `reminder.lotClosing` (T-1 h before close) | watchers and bidders on the lot | E, I | O | Current bid, closing time, bid link |
| `bid.outbid` [§8] | previous high bidder | E, I; S in final hour | T | Current bid, closing time, bid link |
| `lot.won` [§8] | winner | E, S, I | T | Amount, pay-by deadline, pay link |
| `reminder.auctionPayment` (T-24 h, T-2 h before the payment deadline; after it, §8 emits `lot.paymentOverdue`) | winner | E, S, I | T | Amount, deadline, consequence of non-payment |
| `lot.paymentOverdue` [§8] | winner; Staff(AUCTION_MANAGER) | E, S, I; I | T | Payment deadline missed, strike recorded, offer lapsed |
| `lot.secondChanceOffered` [§8] | offered bidder | E, S, I | T | Second-chance offer at the bidder's own highest bid, pay-by deadline, pay link (paying is acceptance), decline link |
| `lot.paid` [§8] | buyer; creator PC | E, I | T | Buyer: receipt. Creator: thank-you + amount raised for animals (buyer never named) |
| `lot.shipped` [§8] | buyer | E, S, I | T | Courier, tracking |
| `lot.sold` / `lot.delivered` [§8] | buyer | E, I | T | Purchase confirmation link (a purchase, not a donation: no tax receipt) / delivery recorded, how to report a delivery issue within 48 h |
| `lot.acknowledged` [§8] | creator PC; C (institution route) | E, I | T | Artist thank-you letter link, amount raised for animals (buyer named only if `shareNameWithArtist`) |
| `lot.cancelled` [§8] | winner, if any | E, I | T | Lot withdrawn, reason, refund status if paid |
| `donation.captured` [§8] | donor | E, I | T | Thank-you: amount, fund; no attachment (the receipt follows in `donation.receiptIssued`) |
| `donation.receiptIssued` [§8] | donor | E, I | T | `receiptNumber`, amount, 80G details, signed download link (valid 7 d) |
| `donation.refunded` [§8] | donor | E, I | T | Refunded amount, settlement time, receipt amended or cancelled |
| `recurringDonation.activated` / `.charged` / `.chargeFailed` / `.halted` / `.paused` / `.resumed` / `.cancelled` [§8] | donor | E; S on failed | T | Mandate active / per-charge confirmation (receipt via `donation.receiptIssued`) / update-payment link / retries exhausted, auto-cancel date / paused / resumed / confirmation |
| `volunteerApplication.submitted` / `.statusChanged` [§9] | applicant (guardian if minor); Staff(COMMUNITY_MANAGER) on submit | E, I | T | Ack / approved / rejected / more info |
| `volunteerApplication.guardianApprovalRequested` [§9] | guardian | E, I | T | Role or activity applied for, approve link |
| `volunteerAssignment.assigned` [§9] | volunteer (guardian if minor) | E, I | T | Assignment, date and time, location, contact |
| `eventRegistration.confirmed` / `.waitlisted` / `.promoted` [§9] | attendee | E, I; S on promoted | T | Event, venue or online link, `.ics` |
| `reminder.eventStarting` (T-1 d, T-2 h) | confirmed attendees | E, S | O | Time, venue, link |
| `event.updated` / `event.cancelled` [§9] | registered + waitlisted | E, S, I | T | What changed (date, time, venue) / reason |
| `adoptionApplication.submitted` / `.statusChanged` / `.infoRequested` [§9] | applicant; ORG_REP + Staff(ADOPTION_COORDINATOR) on submit | E, I | T | Ack / status / next step / information requested, reply link |
| `reminder.animalStale` (after `adoption.listingReconfirmDays` without confirmation) | handler | E, I | O | Listing, confirm-availability link, auto-hide date |
| `reminder.adoptionFollowUp` (each `adoption.followUpDays` date after handover) | adopter; handler (I) | E, I | O | Check-in form link |
| `organization.registered` / `.verified` / `.rejected` / `.verificationExpired` / `.suspended` [§9] | ORG_REP; Staff(COMMUNITY_MANAGER) on register | E, I | T | NGO directory listing status |
| `reminder.orgReverification` (T-30 d, T-7 d before `verificationExpiresAt`) | ORG_REP | E, I | O | Expiry date, re-verification link |
| `reminder.ambassadorExpiring` (T-30 d before `termEndsAt`) | ambassador | E, I | O | Term end date, next steps |
| `contactMessage.received` [§9] | sender address; Staff inbox | E; I | T | Auto-reply with ticket ref and expected response time |
| `contactMessage.replied` [§9] | sender address | E | T | FOA's reply, ticket ref |
| `engagement.milestoneReached` [§9] | PC | E, I | O | Recognition. Invitation block (community/volunteer/club) rendered only if COMMUNICATION consent and adult or via guardian |
| `community.joinRequested` [§9] | guardian | E, I | T | Child asked to join the community, approve link |
| `community.invited` [§9] | invitee, resolved per §10.4 | E, I | G | Post-competition invitation to the FOA community, join link |
| `feedbackSurvey.opened` [§11] + `reminder.feedbackSurvey` (+5 d, once) | invitees (§11.3) | E, I | O | Survey link (token) |
| `safeguardingReport.submitted` [§12] | reporter address; `SAFEGUARDING_DESIGNATION` (§10.4) | E; E, S, I (bypass quiet hours) | T | Ack with reference only / "new report, open /admin/safeguarding". Content never included |
| `safeguardingReport.escalated` [§12] | `SAFEGUARDING_DESIGNATION` (§10.4); Staff(SUPER_ADMIN). Staff only | E, S, I (bypass quiet hours) | T | Reference, severity, "open /admin/safeguarding". Content never included |
| `content.reported` [§12] | moderators: Staff(CONTENT_MANAGER, COMPETITION_MANAGER). Staff only | E, I | O | Target type, reason code, moderation queue link |
| `incident.declared` [§12] | Staff(SUPER_ADMIN); `SAFEGUARDING_DESIGNATION` (§10.4). Staff only | E, S, I (bypass quiet hours) | T | Incident reference, severity, link to the incident record. No personal data |
| `dataRequest.received` [§12] | requester (address captured at request) | E, I | T | Acknowledgement: `requestNumber`, request type, SLA (§12.10), grievance officer contact |
| `dataExport.ready` / `dataErasure.completed` [§12] | requester (address captured at request) | E, I | T | Auth-gated download link (72 h) / erasure confirmation |
| `participant.reachedMajority` [§12] | the participant (now 18); guardian | E, I | T | Claim-account invite link; guardian access is now read-only |
| `reminder.coordinatorDigest` (daily 18:00 IST) | C with ≥1 undigested item | E | O | Counts per event type + dashboard links |
| `reminder.staffDigest` (daily 09:00 IST) | each staff user with non-empty Admin Home queues (§11.8) | E | O | Queue counts, SLA breaches, links |

### 10.4 Recipient Resolution

1. **Minor** = age < 18 at send time, computed from `ParticipantProfile.dateOfBirth`.
2. **`PARTICIPANT` expansion (PC):**
   - Adult with a `User`: that user (audience `participant`).
   - Adult managed profile (no `User`): the guardian if one is linked, else C (institution route). Otherwise SUPPRESSED `NO_CONTACT`.
   - Minor: the `Guardian` (audience `guardian`) via `Guardian.email`/`phone`, plus in-app if `Guardian.userId`. The minor's own `User` is added (audience `minor`) only for T/O and only if `ConsentService.has(participantId, 'COMMUNICATION')` was granted by a verified guardian (§12). The guardian is always copied; the minor's copy is never instead of the guardian's. A minor with a login always gets T/O in-app items in their own dashboard, because no external contact is involved. G never goes to a minor's own email, phone or inbox.
   - Guardian without email: T audiences with `E` fall back to SMS where an SMS template exists.
   - T messages may go to an unverified guardian contact (the consent request is how it gets verified). O and G require a verified contact.
3. **Institution route: who gets what**

| Message | Coordinator (C) | Guardian / adult student (PC) |
|---|---|---|
| Institution & competition registration, bulk-fee payment | ✓ | – |
| Student registration created/confirmed, consent pending | digest | ✓ |
| Phase 3 instructions, submission window, submission and school-judging reminders | ✓ *now* | – (school conducts) |
| Entry submitted / shortlisted / not shortlisted | digest | ✓ |
| Entry needs fix, rejected, submitted to/verified by FOA | ✓ *now* | ✓ rejected; in-app for FOA steps |
| Physical artwork requested / reminders / dispatched / discrepancy | ✓ *now* | ✓ requested, discrepancy |
| Artwork received / verified / returned | ✓ | ✓ |
| Results, certificates | institution summary, bulk download | ✓ own outcome |
| Gallery, social feature, auction of the child's work | – | ✓ |
| Engagement / marketing | never (coordinators are not a channel for G) | per consent |

4. **Content minimisation.** SMS and anything addressed to a minor uses first name only. No message includes DOB or home address. Judge templates include no participant name, school or city (CI-enforced). Safeguarding messages never contain report content.
5. **Erased, suspended or deleted** users and guardians are SUPPRESSED `SUBJECT_ERASED`.
6. **One message per address.** Reminders and digests are computed per recipient address. A guardian with three children in one competition gets one reminder listing them (`LIST` variable in email; count in SMS).
7. **`SAFEGUARDING_DESIGNATION`** expands at send time to every user with an active `SafeguardingDesignation` (DSL or DEPUTY_DSL, not revoked; §12.9).

### 10.5 Categories, Gates & Preferences

| Category | Examples | User can disable | Consent | Minors | SMS quiet hours | `List-Unsubscribe` |
|---|---|---|---|---|---|---|
| TRANSACTIONAL | OTP, receipts, registration/entry confirmations, status changes, consent requests | No | – | via guardian (§10.4) | deferred unless `bypassQuietHours` | No (footer links to preferences) |
| OPERATIONAL | Phase 3 instructions, deadlines, reminders, digests, surveys | Yes, per channel | – | via guardian | deferred | Yes (turns off O email) |
| ENGAGEMENT | newsletters, competition announcements to the public, invitations, campaigns | Yes; default off | `COMMUNICATION` | guardian only, contextual segments only (§10.6) | n/a: never sent by SMS | Yes |

**Gates** in `notify()`, per recipient × channel. The first gate that fails marks the row SUPPRESSED with that reason:
`SUBJECT_ERASED` → `NO_CONTACT`/`CONTACT_UNVERIFIED` → `MINOR_POLICY` → `SUPPRESSION_LIST` (scope matches category) → `NO_COMMUNICATION_CONSENT` (G) → `PREFERENCE_OFF` (O/G) → `FREQUENCY_CAP` (G: max 1/day, 3/week per address) → `TEMPLATE_MISSING` (locale falls back to `en-IN`; raises a Sentry alert). Once all gates pass, the service inserts a QUEUED row. A unique violation on `dedupeKey` is ignored, which makes Outbox replay harmless.

**dedupeKey**: `sha256(eventKey|outboxId|templateKey|channel|toAddress)`. Reminders use `reminder.<name>|<entityId>|<offset>|<channel>|<toAddress>`. Announcements use `ann|<announcementId>|<channel>|<toAddress>`.

**Unsubscribe.** Every O and G email carries `List-Unsubscribe: <https://{domain}/api/unsubscribe/{token}>, <mailto:unsubscribe@{domain}?subject={token}>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). `token` is HMAC-signed `{ address, channel, category }` and does not expire. `POST /api/unsubscribe/[token]` needs no auth, is idempotent and takes effect at once. It turns the `NotificationPreference` off for users with that address and writes a `SuppressionEntry` for non-users (scope ENGAGEMENT for G, NON_TRANSACTIONAL for O). `GET /unsubscribe/[token]` only shows a confirm button and a preferences link; it never unsubscribes, because link scanners follow GETs.

**Preferences UI** `/dashboard/settings/notifications`: a matrix of OPERATIONAL/ENGAGEMENT × EMAIL/SMS/IN_APP, with the WHATSAPP column hidden until enabled. The TRANSACTIONAL row is shown locked on, with an explanation. The ENGAGEMENT row is disabled when `COMMUNICATION` consent is absent: adults can grant it inline, and guardians are linked to per-child consent at `/dashboard/privacy` (§12). The SMS column for ENGAGEMENT is always disabled. The page lists verified contacts with "verify" CTAs. Turning off OPERATIONAL email shows a warning that competition instructions will then come only via SMS/in-app. Changes write `AuditLog`.

**In-app inbox:** a header bell with unread count (refreshed on navigation and every 60 s; no websockets in MVP) and a list at `/dashboard/notifications` with mark read / mark all read. The same inbox renders inside `/institution`, `/judge` and `/admin`.

### 10.6 Bulk Sends (Announcements)

```prisma
model Announcement {
  id String @id; name String /* internal label */; senderType AnnouncementSender /* FOA | INSTITUTION */
  institutionId String?      // required when INSTITUTION
  category NotificationCategory // OPERATIONAL | ENGAGEMENT (never TRANSACTIONAL)
  templateKey String         // announcement.*; INSTITUTION → allowlist only
  channels NotificationChannel[]; segment Json /* SegmentDefinition */; variables Json /* template free variables */
  status AnnouncementStatus  // DRAFT PENDING_APPROVAL SCHEDULED SENDING SENT CANCELLED
  scheduledFor DateTime?; createdByUserId String; approvedByUserId String?; recipientCount Int? /* snapshot at send */
  createdAt DateTime @default(now()); sentAt DateTime?; cancelledAt DateTime?
}
```
```ts
type SegmentDefinition = {
  audience: 'PARTICIPANT_CONTACTS' | 'INSTITUTION_CONTACTS' | 'MEMBERS' | 'DONORS' | 'VOLUNTEERS' | 'JUDGES' | 'ORG_REPS'
  competitionIds?: string[]; registrationStatuses?: RegistrationStatus[]; entryStatuses?: EntryStatus[]
  institutionIds?: string[]; route?: ParticipationRoute; ageGroupIds?: string[] /* the competition's AgeGroup ids (§6) */
  disciplines?: Discipline[]; states?: string[]; cities?: string[]; roles?: Role[]; milestones?: EngagementMilestone[]
}
```

| Sender role | Categories | Segment limits |
|---|---|---|
| STAFF_ADMIN, SUPER_ADMIN | O, G | any |
| COMPETITION_MANAGER | O | `competitionIds` required, within scope |
| COMMUNITY_MANAGER, CONTENT_MANAGER | G; O for events | any except `JUDGES` |
| INSTITUTION_ADMIN, INSTITUTION_COORDINATOR (via `/institution/announcements`) | O | forced `institutionIds=[own]`, audience `PARTICIPANT_CONTACTS`, allowlisted templates, no free text |

- **Coordinator templates** (`announcement.institution.*`): `conductSchedule` (date, time, `venueName` ≤60 chars), `materialsReminder`, `submissionReminder`, `consentReminder`, `resultsAvailable`, `certificatesAvailable`. Variables are typed (DATE/DATETIME/short STRING). The validator rejects URLs, emails, phone numbers and profanity in STRING values. The system fills institution and competition names. Limits: ≤1 per institution per day, ≤5 per competition. These go to guardians and adult students, never to a minor's own contact.
- **Minor protection (G).** If a segment uses `milestones`, `roles`, or audience `DONORS`/`VOLUNTEERS`, everyone under 18 and their guardian-as-guardian contact is excluded automatically, and the preview shows the excluded count. G reaches guardians of minors only through contextual filters (competition, institution, route, age group, geography) and only with `COMMUNICATION` consent. No open, click or visit-based filter exists.
- **Approval** by a different STAFF_ADMIN/SUPER_ADMIN is required when category = G and either the recipient count exceeds 1,000 or the segment reaches guardians of minors.
- **Flow:** build → **preview** (count per channel after gates, exclusions by reason, 3 rendered samples) → **test send** to own contacts (`[TEST]` subject prefix, no dedupe) → schedule or send now → `SENDING`. Job `announcement.expand` snapshots recipients in pages of 500 and calls `notify()` with `announcementId`. Dedupe is per address, so a guardian reached through 3 children gets one copy.
- **Throttling:** each channel has a token bucket in the send worker. `NOTIFY_EMAIL_RPS` defaults to 2; set it at or below the SES account's maximum send rate. `NOTIFY_SMS_RPS` defaults to 20. Bulk email is throttled to the SES account's 24-hour sending quota and maximum send rate. The `.txn` queues always drain before the `.bulk` queues. On 429, back off and honour `Retry-After`.
- **Stats** (live group-by on `Notification`): targeted, suppressed by reason, queued, sent, delivered, failed, bounced. CSV export contains counts only; addresses are included for STAFF_ADMIN only. Cancelling a `SCHEDULED` announcement sets it to CANCELLED. Cancelling one in `SENDING` stops expansion and moves its QUEUED rows to CANCELLED.
- **No open-tracking pixels and no click-tracking link rewriting** on any email (SES adds none, because the configuration set publishes no Open or Click events).

### 10.7 Delivery: Quiet Hours, Retries, Bounces, DLT

- **Quiet hours:** no SMS or WhatsApp between 21:00 and 09:00 in the recipient's timezone (default `Asia/Kolkata`; `NOTIFY_QUIET_START/END`). Deferred messages get `scheduledFor` = next 09:00 plus 0–30 min jitter. Exempt: `otp.requested`, safeguarding and security-incident staff alerts, and receipts sent within 5 min of the payer's own action (`bypassQuietHours`). Email has no quiet hours, but scheduled reminders and announcements default to a 08:00–20:00 IST window. Day-based reminders run at 10:00 IST.
- **Retry:** `RetryableError` (network, 5xx, 429) uses pg-boss `retryLimit: 5, retryDelay: 30, retryBackoff: true` (about 30 s up to 8 min), then FAILED. `PermanentError` (4xx, invalid number, DLT mismatch) goes straight to FAILED. An invalid number also adds `SuppressionEntry(SMS, ALL, INVALID_NUMBER)`. A DLT mismatch raises a Sentry alert.
- **SMS fallback:** routes with `smsFallback` (`registration.confirmed`, `consent.requested`, `artwork.requested`, `lot.won`, `competition.scheduleChanged`) queue the SMS template when the email ends FAILED or BOUNCED, unless an SMS was already sent.
- **Webhooks:** `POST /api/webhooks/ses` (SES events published to an SNS topic with an HTTPS subscription; the SNS message signature and `TopicArn` are verified, and the subscription confirmation is handled) and `POST /api/webhooks/msg91` (shared secret + IP allowlist), both idempotent by provider event ID. delivered → DELIVERED. Hard bounce (SES `Permanent`) → BOUNCED + `SuppressionEntry(EMAIL, ALL, HARD_BOUNCE)`. Soft bounce (SES `Transient`) → FAILED after provider retries. Complaint → `SuppressionEntry(EMAIL, NON_TRANSACTIONAL, COMPLAINT)` + ENGAGEMENT preference off. SMS DLR failed or rejected → FAILED.
- **Lifting suppression:** re-verifying the address by OTP deletes HARD_BOUNCE and INVALID_NUMBER entries. STAFF_ADMIN can delete any entry with a reason (audited). COMPLAINT and UNSUBSCRIBED lift only when the user opts back in.
- **Email setup:** subdomain `notify.<domain>` for T/O and `news.<domain>` for G, each with SPF, DKIM and DMARC `p=quarantine`; Reply-To `support@<domain>`. No message carries an attachment. Every document, including the donation receipt, is a link behind auth or a signed, expiring URL.
- **Indian DLT:** before M2, FOA registers as Principal Entity, a 6-character header (e.g. `FOAIND`), and every SMS template as **Service-Implicit**. There is no promotional SMS, because G is never sent by SMS. Env (§13.9): `SMS_PROVIDER_API_KEY`, `SMS_DLT_SENDER_ID`, `SMS_DLT_ENTITY_ID`. An SMS template's `body` MUST be the exact DLT-approved text with `{{var}}` in place of `{#var#}`. Each variable is ≤30 chars. Links appear only as `SHORT_URL` variables resolving to `/s/[code]` on the DLT-whitelisted domain. Editing an SMS body creates a new version, which cannot be activated without a new `dltTemplateId`. Until DLT approval, flag `SMS_CHANNEL` stays off and SMS audiences fall back to EMAIL + IN_APP.

### 10.8 Admin UI `/admin/communications`

Access: STAFF_ADMIN has full access. CONTENT_MANAGER and COMMUNITY_MANAGER get G templates and announcements. COMPETITION_MANAGER gets announcements and a read-only log for competitions in scope.

- **Templates** (`/templates`): grouped event key → audience → channel → locale. Templates that are missing for a registered route are flagged red. The editor has subject/body fields, a declared-variables panel (from the route's `payloadSchema`, with fixture sample values), live preview (email in a sandboxed iframe; SMS character and segment counter with GSM-7/UCS-2 detection; in-app card), version history with diff, "Send test to me", and **Activate**. Activation atomically deactivates the previous version; SMS activation is STAFF_ADMIN only. **Blocking lint:** undeclared or missing-required variable, `TEXT_BLOCK`/`LIST` in SMS, SMS variable `maxLength` > 30, URL outside allowed domains, missing `dltTemplateId` (SMS), subject > 120 chars, malformed `{{ }}`, participant-PII variable in a `judge` template. **Warnings:** > 2 SMS segments, unused optional variable.
- **Send log** (`/log`): filters for event, channel, status, category, date range, address, and entity code (`entryCode`, `registrationNumber`, … resolved to `subjectParticipantId`). The detail drawer shows the rendered message (addresses masked unless STAFF_ADMIN), status timeline and provider ID. **Resend** is available for T only: it creates a new row with dedupeKey suffix `:resend:<n>` and is audited.
- **Failures** (`/failures`): FAILED/BOUNCED rows from the last 14 days, grouped by reason and event, with bulk retry for retryable rows and a link to fix the contact on the user or guardian record.
- **Announcements** (`/announcements`): list, builder (§10.6) with live segment count, approval queue, stats.
- **Suppressions** (`/suppressions`): search and remove (STAFF_ADMIN, reason required, audited).
- **Routes** (`/routes`): a read-only event → audience → channel → category matrix generated from the registry. This is the living version of §10.3.

### 10.9 Acceptance Criteria

1. An `entry.submitted` for a minor on the individual route creates guardian EMAIL + SMS (+ IN_APP if the guardian has a login) and nothing to the minor's own contact unless the §10.4 consent exists. The institution route also adds a coordinator in-app item and a digest line.
2. Replaying the same Outbox row (or running two workers) creates no duplicate `Notification` rows.
3. An O SMS created at 22:30 IST gets `scheduledFor` at 09:00–09:30 IST the next day. An OTP requested at 22:30 is sent immediately.
4. Templates fail activation with an undeclared variable, or (SMS) without `dltTemplateId`. Exactly one version per (key, channel, locale) is active.
5. CI test: every route audience × channel in the registry has an active `en-IN` seed template, and no `judge` template variable schema contains participant name, school, city or contact.
6. A hard-bounce webhook sets BOUNCED and suppresses the address. Later sends to it are SUPPRESSED `SUPPRESSION_LIST`. Re-verifying by OTP lifts it.
7. One-click `POST /api/unsubscribe/[token]` without a session returns 200 and suppresses that category for the address. T messages are still delivered. GET never unsubscribes.
8. The announcement preview counts per channel equal the QUEUED counts after sending (same data). G segments using `milestones` exclude all under-18s and show the excluded count.
9. Server-side policy tests show that coordinators cannot target other institutions, use non-allowlisted templates, or pass undeclared variables. Variables containing a URL or phone number are rejected.
10. Provider 5xx is retried 5 times with backoff, then FAILED and visible in `/failures`. A 4xx fails without retry.
11. A recipient who is erased (§12) between event and send is SUPPRESSED `SUBJECT_ERASED`, and no provider call is made.
12. No email contains a tracking pixel or rewritten links (snapshot test of rendered HTML).

### 10.10 Open Questions

- **WhatsApp at launch?** Default: no. The adapter ships post-MVP (M6+) with explicit per-user opt-in as a channel preference.
- **Languages?** Default: `en-IN` only at launch. `hi-IN` templates can be added later without code changes (fallback to `en-IN`).
- **Can minors receive messages on their own contact?** Default: only T/O, only with `COMMUNICATION` consent from a verified guardian, with the guardian always copied. Never G.
- **SMS for negative outcomes** (not shortlisted, rejected)? Default: no. Email + in-app only, with neutral wording.
- **Free-text coordinator messages, even to adult college students?** Default: no. Allowlisted templates only.
- **DLT registration owner and timeline?** Default: FOA registers the PE ID, header and templates before M2. The SMS flag stays off until approved.
- **Open/click tracking?** Default: off everywhere, and delivery stats come from provider webhooks only.
- **Who gets `reminder.registrationPayment` when a school pays fees in bulk?** Default: the payer of record from §6/§8. For institution bulk invoices that is IA + C.
- **Should `competition.published` auto-send?** Default: no. It creates a draft announcement for staff review.

## 11. Reports, Analytics & Admin Home

### 11.1 Principles

- **No warehouse in MVP.** Reports read an `analytics` Postgres schema of views and materialized views over the OLTP tables.
- **Aggregate-only.** Report pages and exports never list individuals. Row-level lists stay in module admin screens (§6–§9) under their own permissions.
- **PII-free analytics views.** They expose IDs, dimensions and measures. No names, contacts, DOB or free text (feedback free text is the single controlled exception, §11.3).
- **Server-side enforcement.** Role-based access and small-cell suppression (§11.5) are enforced in the report service, never only in the UI.
- **Time.** Daily buckets use IST dates. Finance uses the Indian FY (April–March).

### 11.2 KPI Catalogue

Role abbreviations: SA = STAFF_ADMIN/SUPER_ADMIN, CM = COMPETITION_MANAGER, FIN = FINANCE, COM = COMMUNITY_MANAGER, CON = CONTENT_MANAGER, AUC = AUCTION_MANAGER, ADO = ADOPTION_COORDINATOR. Standard dimensions are **D** = competition, route, institution, state, city, age band, discipline.

| ID | KPI | Definition | Dims | Obj. | Roles |
|---|---|---|---|---|---|
| K01 | Registrations | `Registration` CONFIRMED by `confirmedAt`; also created→confirmed conversion | D | 1,2,3 | SA, CM |
| K02 | Unique participants | distinct `participantId` with ≥1 CONFIRMED registration | D | 1,2 | SA, CM |
| K03 | Submission rate | registrations with an entry at SUBMITTED or later (excl. WITHDRAWN) ÷ CONFIRMED. For `SHORTLIST_ONLY` institution route: institutions that submitted a shortlist ÷ registered institutions | D | 2 | SA, CM |
| K04 | Shortlist / finalist rate | SCHOOL_SHORTLISTED-or-later ÷ SUBMITTED-or-later; finalist = `finalOutcome` ∈ {WINNER, RUNNER_UP, FINALIST, SPECIAL_MENTION} ÷ IN_JUDGING-or-later | D | 2 | SA, CM |
| K05 | Phase funnel | per competition: registered → confirmed → submitted → school shortlisted → submitted to FOA → FOA verified → in judging → finalist → winner/runner-up → certificate issued. Physical track: requested → dispatched → received → verified (+ discrepancies). Step conversion + median days per step, built from `ProductEvent` so past states count | D | 2,8 | SA, CM |
| K06 | Completion rate | CONFIRMED registrations with ≥1 certificate issued ÷ CONFIRMED (after RESULTS_PUBLISHED) | D | 2 | SA, CM |
| K07 | Repeat participation | participants CONFIRMED in ≥2 competitions ÷ unique participants; per competition, % returning | route, state, age band | 4 | SA, CM |
| K08 | Institutions | registered, VERIFIED, active (≥1 CONFIRMED student registration in trailing 12 months), median days to verify, students per active institution | type, state, city | 3 | SA, CM |
| K09 | Engagement ladder | participants per highest `EngagementMilestone`; transitions A→B in period; conversion = reached B ÷ reached A, by competition cohort | route, age band, state | 4 | SA, COM |
| K10 | Community | users reaching COMMUNITY_MEMBER (new/month), clubs, ambassadors (§9) | state | 4 | SA, COM |
| K11 | Volunteers | applications, approved, active (approved hours or assignment in last 90 d), approved hours by activity | activity, state | 7 | SA, COM |
| K12 | NGO network | directory listings by status, type, state; new/month | type, state | 5 | SA, COM |
| K13 | Donations | count, gross, net of refunds, unique donors, average gift, by campaign, one-time vs recurring. **MRR** = Σ active recurring plans normalised to monthly at period end; recurring churn | campaign, FY month | – | SA, FIN |
| K14 | Fees & auctions | fee income and refunds; lots listed/sold, sell-through %, proceeds captured, winning bid vs reserve | competition | – | SA, FIN; AUC (auctions) |
| K15 | Gallery reach | views and shares per entry, competition, discipline (`PageStatDaily`, `ShareCountDaily`) | competition, discipline | 6 | SA, CON |
| K16 | Events | registered, attended (checked in), no-show % | event, city | 4 | SA, COM |
| K17 | Adoption | active listings, applications, approved, completed, median days listing → adoption | org, city | – | SA, ADO |
| K18 | Certificates | issued by `CertificateType`; QR verifications (`/verify` hits) | competition | 2 | SA, CM |
| K19 | Participant feedback | NPS = %(9–10) − %(0–6); response rate; mean per rating question | survey audience, competition, route | 8 | SA, CM |
| K20 | Social reach | followers, posts, reach, impressions, engagements per channel per month; MoM growth | channel | 6 | SA, CON |
| K21 | Web traffic | visitors, pageviews, top public pages, referrers (Umami) | path | 6 | SA, CON |
| K22 | Comms health | sent, delivery %, bounce %, suppression % | channel, category | – | SA |

**Objective 8 coverage:** participation K01–K07; engagement K09, K10, K16; institutional partnerships K08; volunteer involvement K11; social-media reach K15, K20, K21; participant feedback K19.

**Targets for the 6-month objectives:** `KpiTarget { id, kpiKey, filters Json?, periodStart, periodEnd, targetValue Int, setByUserId, createdAt }`, editable by SA. KPI tiles and reports show progress against the active target.

### 11.3 Data Model

```prisma
model ProductEvent {           // server-side product analytics, from Outbox
  id String @id; outboxId String @unique; eventKey String; occurredAt DateTime
  entityType String; entityId String; competitionId String?; institutionId String?; participantId String?
  actorRole Role?; props Json  // allowlisted non-PII keys per eventKey; anything else stripped
  @@index([eventKey, occurredAt]) @@index([competitionId, eventKey])
}
model FeedbackSurvey {
  id String @id; title String; audience FeedbackAudience // GUARDIAN | ADULT_PARTICIPANT | COORDINATOR | JUDGE | VOLUNTEER | EVENT_ATTENDEE
  competitionId String?; eventId String?; questions Json; anonymous Boolean @default(true)
  status FeedbackSurveyStatus /* DRAFT OPEN CLOSED */; opensAt DateTime; closesAt DateTime; createdByUserId String; createdAt DateTime
}
model FeedbackInvitation {
  id String @id; surveyId String; userId String?; guardianId String?; institutionId String?
  tokenHash String @unique; notificationId String?; respondedAt DateTime?
  @@unique([surveyId, userId, guardianId])
}
model FeedbackResponse {
  id String @id; surveyId String; invitationId String? /* null when survey.anonymous */
  npsScore Int /* 0–10 */; answers Json; freeText String? /* ≤1000, PII-scrubbed */
  dims Json /* snapshot: route, child ageBand, state, institutionId, discipline */
  freeTextStatus FreeTextStatus /* PENDING OK HIDDEN */; submittedAt DateTime
}
model SocialMetricSnapshot {
  id String @id; channel SocialChannel /* INSTAGRAM FACEBOOK YOUTUBE X LINKEDIN WHATSAPP_CHANNEL OTHER */
  periodMonth DateTime /* 1st of month, IST */; followers Int; posts Int; reach Int?; impressions Int?
  engagements Int?; videoViews Int?; source MetricSource /* MANUAL API */; notes String?
  enteredByUserId String; updatedAt DateTime
  @@unique([channel, periodMonth])
}
model PageStatDaily    { date DateTime; path String; pageviews Int; visitors Int; @@id([date, path]) }
model ShareCountDaily  { date DateTime; entryId String; channel String; count Int; @@id([date, entryId, channel]) }
model ImpactAdjustment { id String @id; counterKey String; delta Int; note String; enteredByUserId String; createdAt DateTime } // offline activity, audited
model ReportExport     { id String @id; reportKey String; filters Json; suppressed Boolean; requestedByUserId String; status ExportStatus /* QUEUED READY FAILED */; fileAssetId String?; rowCount Int?; createdAt DateTime; expiresAt DateTime }
```

**Feedback surveys:**
- **Questions:** a fixed NPS question ("How likely are you to recommend FOA competitions to a friend or family member?", 0–10) plus at most 5 questions of type `RATING_1_5`, `SINGLE_CHOICE` or `FREE_TEXT` (≤1000 chars). A default survey per audience is seeded.
- **Invitations:** job `feedback.invite` runs 3 days after a competition reaches RESULTS_PUBLISHED. It invites guardians of minor participants, adult participants and coordinators through §10 `feedbackSurvey.opened`, with one reminder.
- **Response page:** `/feedback/[token]` needs no login. The token is single-use.
- **Minors are never surveyed directly.** Guardians answer, with "your child" wording.
- **Anonymous by default:** the response is not linked to its invitation; the invitation only gets `respondedAt`.
- **Free text** is auto-scrubbed (emails and phone numbers masked) and visible only to SA and CM. Quoting it publicly requires separate consent (§12).

**Social metrics:** CON enters them in a monthly form at `/admin/reports/social`, one row per channel. Rows stay editable for 60 days (audited). If last month is missing, the staff digest flags it from the 3rd of the month. API ingestion later writes to the same table with `source = API`.

### 11.4 Data Pipeline

- **Event ingestion.** `analytics.ingest` (§10.1) writes `ProductEvent`. It is idempotent on `outboxId`, and props pass a per-event allowlist. No client-side product events exist.
- **Base views.** `analytics.v_registrations`, `v_entries`, `v_artworks`, `v_certificates`, `v_payments`, `v_donations`, `v_engagement`, `v_volunteers`, `v_events`, `v_adoptions`, `v_feedback` are PII-free. Derived columns:
  - `istDate`, `state`, `city`, `isMinor`.
  - `ageBand` of enum `AnalyticsAgeBand` ∈ {`UNDER_9`, `9_12`, `13_15`, `16_17`, `18_21`, `22_PLUS`}, computed at the competition's age cutoff. It is analytics-only and distinct from §9's `AgeBand`. Competition-specific age groups (§6) are also available.
- **Materialized views** `analytics.mv_*_daily` have grain istDate × competition × route × institution × state × ageBand × discipline, with a unique index so they can be refreshed `CONCURRENTLY`.
  - Job `analytics.refresh` runs hourly, with a full refresh at 02:00 IST.
  - Funnel MVs refresh every 15 min while a competition is between REGISTRATION_OPEN and RESULTS_PENDING_APPROVAL.
  - Every report shows "Data as of HH:mm IST".
- **Report registry** in `src/server/domain/reports/`: each report is `{ key, roles, filtersSchema (zod), query(filters), audience: 'STAFF'|'INSTITUTION'|'PUBLIC' }`. Filters live in URL search params so views can be bookmarked. Available filters: date range (last 30 d, current FY, competition window, custom), competition, discipline, route, institution, state/city, age band.
- **CSV export** uses the same query and suppression as the screen. Up to 50k rows export synchronously. Larger exports run as a job into the private bucket with a 24 h signed URL. Each export writes a `ReportExport` and an `AuditLog` row. Files are UTF-8 with BOM.

### 11.5 Access Control & Small-Cell Suppression

| Report area (`/admin/reports/...`) | Roles |
|---|---|
| Overview & targets (`/`) | all staff roles; tiles filtered by role |
| Competitions, funnel, institutions, certificates, feedback (`/competitions`, `/competitions/[code]`, `/institutions`, `/feedback`) | SA; CM (scoped competitions only) |
| Engagement ladder, community, volunteers, events, NGOs (`/engagement`, `/community`) | SA, COM |
| Adoption (`/adoption`) | SA, ADO |
| Donations, fees, MRR, auctions (`/finance`) | SA, FIN; AUC sees auctions only |
| Social, web, gallery (`/social`, `/web`) | SA, CON |
| Communications health (`/communications`) | SA |
| Institution report (`/institution/reports`) | INSTITUTION_ADMIN, INSTITUTION_COORDINATOR (own institution) |
| Impact feed (`/api/v1/impact`) | public |

`suppressSmallCells(rows, { k: 10, audience })` runs in the report service and is unit-tested:
- **STAFF:** exact counts on screen. Exports are suppressed by default; only SA can switch suppression off, and doing so is audited.
- **INSTITUTION and PUBLIC:**
  - Any person-count cell of 1–9 becomes `"<10"` (`null` in JSON).
  - Secondary suppression: the next-smallest cell in the same row/column is also hidden, so a suppressed cell can't be derived from totals.
  - Rates whose denominator is < 10 are hidden.
- **Money** totals are never suppressed in finance views. Donor counts follow k.
- **Feedback** breakdowns with < 10 responses are hidden for every audience, staff included, to protect anonymity. Free text never appears in institution or public views.

### 11.6 Web Analytics (Cookieless)

- **Tool:** **Umami, self-hosted** with its own database and role on the VPS Postgres (§2.3), and proxied first-party under `/stats`. No cookies, no cross-site identifiers, no custom client events. It honours DNT/GPC (`data-do-not-track`).
- **Banned:** GA, GTM, Meta Pixel, LinkedIn Insight, Hotjar, session replay and all ad pixels. This is enforced by CSP `script-src 'self'` plus the Umami origin, and by a CI test that fails if the built bundle references known tracker hosts.
- **Where the script loads:** only in the `(public)` layout, and only when no session cookie exists. It is never rendered on `(auth)` routes, `/competitions/[slug]/register`, `/feedback/*`, `/dashboard/*`, `/institution/*`, `/judge/*` or `/admin/*`, so there is no tracking on authenticated pages or pages minors use to register or sign in (DPDP children's rules, §12).
- **Gallery stats:** job `analytics.pullWebStats` runs nightly and copies per-path pageviews/visitors for `/gallery/*`, `/competitions/*`, `/impact` and `/donate` from the Umami API into `PageStatDaily`.
- **Shares:** share buttons call server action `gallery.share(entryCode, channel)`, which increments `ShareCountDaily`. No identifiers are stored.
- **Product analytics** come only from `ProductEvent` (server-side, via the Outbox).

### 11.7 Institution Report & Public Impact Feed

**`/institution/reports`** (own institution; per competition and all-time):
- **Content:** students registered / confirmed / consent pending; entries submitted; school-shortlisted; submitted to FOA; FOA finalists, winners and runners-up; certificates issued and downloaded; physical-artwork status counts; splits by age band and discipline.
- **Counts:** own-institution counts are exact, since coordinators already see their students (§4.2).
- **Benchmarks** ("all participating institutions": median submission and shortlist rate) appear only when ≥10 institutions contribute, and are k-suppressed. Other institutions are never named or ranked.
- **Export:** CSV of the same aggregates. Student-level lists stay in the operational screens (§6/§7).

**`GET /api/v1/impact`** returns `{ asOf, counters: { participants, institutions, competitions, statesReached, artworksShowcased, certificatesIssued, volunteers, volunteerHours, communityMembers, eventAttendees, ngosListed, adoptionsFacilitated, fundsRaisedMinor, currency } }`.
- **Source:** MVs plus `ImpactAdjustment` (except `fundsRaisedMinor`, below).
- **Rounding and suppression:** counters < 10 are omitted. Counts ≥ 10 are rounded down to the nearest 10 and displayed as "1,240+".
- **Funds:** `fundsRaisedMinor` is the sum of ledger INCOME in the donation categories over PUBLISHED months, read from §8's `TransparencySnapshot`. It MUST equal the transparency page's donations total for the same period.
- **Caching:** 1 h (`cacheLife({ revalidate: 3600 })`).
- **Consumers:** §9 `/impact` and the home page.

### 11.8 Admin Home `/admin` (Module 22)

Layout: global search bar, then "Needs attention" queue cards, KPI tiles, and a strip of active competitions showing status and the next phase deadline.

**Queues** are defined in `src/server/domain/admin-home/queues.ts` as `{ key, roles, countQuery, oldestQuery, slaHours, href }`.
- **Counts** are live indexed queries (not MVs), cached 60 s per queue and scope.
- **Each card** shows the count and the oldest item's age, turns red past its SLA, and links to the pre-filtered list.
- **Visibility:** queues for modules behind disabled feature flags are hidden. Users only see queues for their roles.

| Queue | Definition | Roles | SLA |
|---|---|---|---|
| Institutions awaiting verification | `Institution.status = PENDING_VERIFICATION` | SA, CM | 48 h |
| Entries awaiting FOA verification | `Entry.status = SUBMITTED_TO_FOA` OR (`Entry.route = INDIVIDUAL` AND `Entry.status = SUBMITTED`) | SA, CM | 72 h |
| Entries awaiting fixes past deadline | changes requested, fix-by passed | CM | – |
| Artwork overdue / in transit | REQUESTED past dispatch deadline; DISPATCHED > 7 d not RECEIVED | CM | 0 h |
| Artwork discrepancies open | `PhysicalArtwork.status = DISCREPANCY` | SA, CM | 72 h |
| Judging progress | per open round: % scored, judges behind schedule | CM | round deadline |
| Results awaiting approval | `Competition.status = RESULTS_PENDING_APPROVAL` | SA, CM | 48 h |
| Consent issues | registrations blocked on consent > 3 d; withdrawals needing unpublish (§12) | SA, CM | 72 h (withdrawal) |
| Safeguarding reports open | open reports, count and age only (§12) | `SAFEGUARDING_DESIGNATION` holders (DSL, deputy DSL), SUPER_ADMIN; not STAFF_ADMIN | by severity (§12.9): CRITICAL acknowledged ≤ 1 h and triaged ≤ 4 h; HIGH ≤ 24 h; MEDIUM/LOW ≤ 72 h |
| Data-subject requests pending | export/erasure requests (§12) | SA | per §12 |
| Failed payments / unreconciled | FAILED in 7 d; captured without ledger entry (§8) | FIN | 24 h |
| Failed notifications | T notifications FAILED/BOUNCED in 72 h | SA | 24 h |
| Contact inbox | unanswered `ContactMessage` | SA, COM | 48 h |
| Gallery moderation | items pending moderation (§7) | CON, CM | 24 h |
| Volunteer / NGO / adoption applications | pending (§9) | COM / COM / ADO | 5 d |
| Auction follow-ups | lots awaiting payment or shipping (§8) | AUC | 48 h |

**KPI tiles**, each with value, delta vs the previous equivalent period, and a link to the report:
- **SA/CM:** active competitions; confirmed registrations vs `KpiTarget`; submissions; institutions verified/active; latest NPS.
- **FIN:** donations this FY (gross, count); MRR; fees collected; failed payments in 7 d.
- **COM:** community members; active volunteers; upcoming event registrations.
- **CON:** gallery views in 30 d; social followers (last month, MoM).
- **SA:** notification delivery % in 7 d.

**Global search** (`Ctrl/Cmd+K`, server action `adminSearch(q)`):
- **Normalisation:** trim and uppercase. In the random segment only, I/L → 1 and O → 0.
- **Code patterns** (anchored regex → field): `^FOA-P-` → `ParticipantProfile.participantCode`; `^FOA-I-` → `Institution.institutionCode`; `^FOA-C-` → `Certificate.certificateNumber`; `^FOA-RCPT-` → `Donation.receiptNumber`; `^LOT-` → `AuctionLot.lotCode`; `^[A-Z]{3,6}\d{2}-I-` → `InstitutionRegistration.reference`; `^[A-Z]{3,6}\d{2}-R-` → `Registration.registrationNumber`; `^[A-Z]{3,6}\d{2}-E-` → `Entry.entryCode`; `^[A-Z]{3,6}\d{2}-A-` → `PhysicalArtwork.artworkCode`; `^[A-Z]{3,6}\d{2}$` → `Competition.code`.
- **Exact code match:** navigates directly when there is one result.
- **Non-code queries:**
  - Trigram search over institution and competition names (all staff).
  - Participant name, or exact email/phone, only for roles with PII access (SA, CM).
  - Donor email or receipt number for FIN.
- **Results:** filtered through `can(user, 'view', resource)`, at most 20, each showing a type badge, code, status and link.
- **Audit and limits:** searches by name, email or phone write `AuditLog` action `admin.search`. Rate limit 60/min per user. Judges and institution roles have no `/admin` access.

### 11.9 Acceptance Criteria

1. Each KPI K01–K22 has a SQL definition with a unit test against the §2.1 seed data and expected values.
2. CM scoped to competition X gets 403 for reports on competition Y. CM gets 403 on `/admin/reports/finance` and sees no FIN tiles. These checks run server-side.
3. Institution and public outputs show 1–9 counts as `"<10"`, apply secondary suppression, and hide benchmarks with fewer than 10 contributing institutions. Feedback breakdowns with fewer than 10 responses are hidden for every role.
4. `/api/v1/impact` contains no counter below 10, rounds as specified, and `fundsRaisedMinor` equals the transparency page's donations total for the same period.
5. A Playwright test confirms that authenticated pages, `(auth)` routes and registration pages make network requests only to first-party origins. CSP blocks a test GA snippet.
6. A `ProductEvent` built from an Outbox payload that contains name, email or phone keys stores none of them.
7. MV refresh runs `CONCURRENTLY` without blocking report reads, and every report shows its "Data as of" time.
8. Each Admin Home queue count equals the row count at its `href` on seed data. Queues and tiles not allowed for a role are not rendered and their data is not fetched.
9. Global search resolves all 10 code types exactly, including lowercase input and O/0 or I/1 confusion. Name/phone search is unavailable to FIN and is audit-logged for SA/CM.
10. A CSV export matches the on-screen numbers for the same filters and writes `ReportExport` and `AuditLog`.
11. A feedback token works once. An anonymous `FeedbackResponse` has no column linking it to a person or invitation.
12. The social monthly form rejects a duplicate (channel, month). The staff digest flags a missing previous month from the 3rd.

### 11.10 Open Questions

- **Web analytics tool?** Default: Umami self-hosted. Plausible Cloud is the fallback. Vercel Analytics is not used because it has no per-path stats API we need.
- **Suppression threshold?** Default: k = 10. Public counters are also rounded down to the nearest 10.
- **Survey minors directly?** Default: no. Guardians answer on the child's behalf.
- **Social-media API integration timing?** Default: manual monthly entry in MVP. Meta Graph and YouTube Data API ingestion comes in M7.
- **Definition of an "active institution"?** Default: ≥1 CONFIRMED student registration in the trailing 12 months.
- **Should volunteer hours count when self-logged?** Default: only hours approved by COM (§9) count.
- **Should institutions see feedback from their own guardians?** Default: no in MVP. Only FOA-wide aggregates, staff-only.
- **Publish KPI targets on `/impact`?** Default: no. Targets are internal only.
