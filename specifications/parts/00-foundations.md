# FOA Platform — Technical Specification

> Source: `FoA.md` (conversion of `FoA.pdf`). This spec turns the vision document into buildable requirements. Where the source is silent or still debated, this spec picks a **default** and lists it under **Open Questions** (§15) so it can be changed later without blocking the build.

## 0. How to Use This Spec (for coding agents)

- Build in milestone order (§14). Each milestone has acceptance criteria. Don't start a milestone until the previous one's criteria pass.
- Section numbers are stable, so reference them in commits and PRs (e.g. `feat(entries): §6.5 entry state machine`).
- **MUST / SHOULD / MAY** follow RFC 2119.
- Every status change goes through a domain service function that (1) checks permission, (2) validates the transition against the state machine in this spec, (3) writes an `AuditLog` row, and (4) emits a domain event for notifications. Never write a `status` column directly from a route handler or UI.
- Entity and enum names in this spec are canonical. Use them verbatim in the schema and code.

## 1. Overview & Scope

**Product:** A web platform for Friends of Animals (FOA), a non-profit that nurtures compassion for animals among children and young adults through creative competitions, community, awareness, adoption facilitation and fundraising.

**Primary 6-month goal (MVP):** Run pilot competitions end to end (drawing, painting, art, craft, essay, photography, videography). Participants register through a school or individually, submit work, get judged (school level, then FOA level), and receive certificates. Selected work goes to a public gallery. Participants stay engaged afterwards.

**In scope for MVP (Milestones M0–M5):** public site and CMS pages, auth, institutions, competitions, registration with fees, submissions, school-level judging, physical artwork logistics, FOA-level judging, results, certificates with QR verification and logo stamping, gallery, donations, basic finance ledger and public transparency page, notifications, consent and safeguarding, admin dashboard, and basic reports.

**Post-MVP (M6–M8):** auctions, adoption, NGO directory, volunteer management, events, community/clubs/ambassadors, advanced analytics. The data model reserves space for these, but they ship after the pilot.

**Assumed jurisdiction:** India first (pin codes, "All India" rankings). Default currency is INR and the display timezone is `Asia/Kolkata`. Multi-country support must stay possible: never hard-code country, currency or timezone in business logic.

## 2. Tech Stack & Architecture

Defaults (swap if the team prefers, but keep the architecture):

| Concern | Default | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript (strict)** | Server Components and Server Actions; Route Handlers for webhooks and the public API |
| UI | Tailwind CSS + shadcn/ui | Mobile-first. WCAG 2.2 AA |
| DB | **PostgreSQL** (Neon) | Branch per preview deployment |
| ORM | Prisma | Migrations checked in |
| Auth | Better Auth (or Auth.js) | Email OTP plus phone OTP. Password optional. Sessions in DB |
| Object storage | S3-compatible (Cloudflare R2 / AWS S3) | Private bucket for originals; public CDN bucket for derived/stamped assets only |
| Uploads | Presigned direct-to-bucket uploads (multipart for video) | Server never proxies large files |
| Image processing | `sharp` | Thumbnails, web derivatives, EXIF stripping, logo stamping |
| PDF | Headless Chromium (Playwright) HTML→PDF, or `@react-pdf/renderer` | Certificates, receipts |
| QR | `qrcode` | Certificate verification |
| Background jobs | pg-boss (Postgres-backed queue) or Inngest | Scheduled transitions, PDF generation, notifications, image processing |
| Payments | **Razorpay** (Orders, Subscriptions, Webhooks) behind a `PaymentProvider` interface | Fees, donations, auction payments |
| Email | Resend (or SES) | Templated, React Email |
| SMS | MSG91 (or similar), behind a `SmsProvider` interface | Indian SMS needs DLT-registered templates |
| Search | Postgres full-text plus `pg_trgm` | Gallery, NGO directory, admin lists |
| Observability | Sentry plus structured logs | |
| Hosting | Vercel (app) plus Neon (DB) | Jobs run on the queue worker or Vercel Cron |
| Testing | Vitest (unit/domain), Playwright (E2E) | State machines MUST have unit tests covering every allowed and disallowed transition |

### 2.1 Repository Layout

```
src/
  app/
    (public)/            # marketing + public modules
    (auth)/              # login, register, verify OTP
    dashboard/           # participant / member / guardian dashboard
    institution/         # school/college coordinator dashboard
    judge/               # judge/jury dashboard
    admin/               # FOA staff dashboard
    verify/[certificateNumber]/   # public certificate verification (QR target)
    api/webhooks/razorpay/route.ts
    api/v1/...           # JSON API only where needed (uploads, polling)
  server/
    domain/<module>/     # services, state machines, validators (zod), policies
    db/                  # prisma client, repositories
    jobs/                # queue handlers + schedules
    integrations/        # payment, email, sms, storage adapters
    auth/                # session helpers, RBAC
  components/
  emails/                # React Email templates
  lib/                   # pure utilities (ids, money, dates)
prisma/schema.prisma
prisma/seed.ts           # realistic seed: 1 competition, 3 schools, 30 participants, 2 judges
tests/
```

### 2.2 Architectural Rules

- **Domain services own the business logic.** UI and route handlers call services. Services call repositories. Policies (`can(user, action, resource)`) run inside services.
- **Validation:** zod schemas live next to each service. The same schemas validate forms on the client.
- **Idempotency:** webhook handlers and payment-confirmation flows MUST be idempotent, keyed by provider event ID.
- **Files:** originals are private and served only through short-lived signed URLs, after an authorization check. Public pages only ever show derived assets with metadata stripped and the logo stamped (§7).
- **Soft delete** (`deletedAt`) for user-generated content. Hard delete only through the data-erasure workflow (§12).

## 3. Conventions

### 3.1 Identifiers

Every entity has an internal `id` (UUIDv7, string). Human-facing codes are separate, unique and indexed:

| Code | Entity | Format | Example |
|---|---|---|---|
| FOA Participant ID | `ParticipantProfile.participantCode` | `FOA-P-{YY}{6 Crockford base32}` | `FOA-P-26K7M2QX` |
| Institution ID | `Institution.institutionCode` | `FOA-I-{5 base32}` | `FOA-I-8H3TZ` |
| Competition code | `Competition.code` | `{3–6 uppercase letters}{YY}` set by admin | `PAWS26` |
| Institution registration ref | `InstitutionRegistration.reference` | `{compCode}-I-{5 base32}` | `PAWS26-I-Q2W9R` |
| Competition Registration Number | `Registration.registrationNumber` | `{compCode}-R-{6 base32}` | `PAWS26-R-7XK2PA` |
| Entry ID | `Entry.entryCode` | `{compCode}-E-{6 base32}` | `PAWS26-E-M4N8VB` |
| Artwork ID | `PhysicalArtwork.artworkCode` | `{compCode}-A-{6 base32}` | `PAWS26-A-3JD9KE` |
| Certificate number | `Certificate.certificateNumber` | `FOA-C-{YY}-{10 base32}` | `FOA-C-26-9XQ4M2T7KD` |
| Auction lot | `AuctionLot.lotCode` | `LOT-{YY}-{5 base32}` | |
| Donation receipt | `Donation.receiptNumber` | `FOA-RCPT-{FY}-{sequential 6 digits}` | `FOA-RCPT-2627-000123` (sequential, because accounting needs it) |

Codes use Crockford base32 (no I, L, O, U) and are generated randomly with a collision retry. They are never derived from personal data.

### 3.2 Money, Time, Text

- Money is stored as **integer minor units** (`amountMinor: Int`) plus `currency: String` (ISO 4217). Never use floats.
- All timestamps are stored in UTC (`timestamptz`) and displayed in the viewer's timezone (default `Asia/Kolkata`). Competition deadlines are stored as exact instants. The admin UI enters them in IST.
- Age is computed from `dateOfBirth` against the competition's `ageCutoffDate`. Store DOB, never store age.
- Rich text (rules, blog posts) is stored as sanitized HTML or Markdown. All rendering goes through a single sanitizer.

### 3.3 Status & Audit

- Statuses are Postgres enums named `<Entity>Status`, with values in `SCREAMING_SNAKE_CASE`.
- `AuditLog { id, actorUserId?, actorRole, action, entityType, entityId, before Json?, after Json?, ip?, userAgent?, createdAt }` is **append-only**. It is written for every state transition, permission change, consent change, money movement and admin edit of user data.
- Domain events (`entry.submitted`, `results.published`, …) are written to an `Outbox` table in the same transaction and dispatched by the job worker (notifications, analytics).

### 3.4 Shared Core Entities

These are defined here and referenced by every section:

- `User { id, email?, emailVerifiedAt?, phone?, phoneVerifiedAt?, name, locale, status: ACTIVE|SUSPENDED|DELETED, createdAt }`. At least one of email or phone is required.
- `UserRole { userId, role: Role, scopeType?: INSTITUTION|COMPETITION|ORGANIZATION, scopeId?, grantedBy, grantedAt }`
- `ParticipantProfile { id, participantCode, userId? (null = managed profile with no login), fullName, displayName, dateOfBirth, gender?, pinCode, city, state, country, schoolNameText?, institutionId?, guardianId?, createdByUserId, createdAt }`
- `Guardian { id, userId?, fullName, relationship, phone, email?, verifiedAt? }`. A guardian can manage several participants.
- `Institution { id, institutionCode, name, type: SCHOOL|COLLEGE|UNIVERSITY|OTHER, addressLine1, addressLine2?, city, state, pinCode, country, contactPhone, contactEmail, principalName, principalEmail, principalPhone, status: PENDING_VERIFICATION|VERIFIED|REJECTED|SUSPENDED, verifiedBy?, verifiedAt? }`
- `InstitutionMember { institutionId, userId, memberRole: AUTHORISED_PERSON|COORDINATOR, designation?, phone, email }`
- `Consent`, `ConsentDocument`: see §12. `Payment`: see §8. `Notification`: see §10. `AuditLog`, `Outbox`: see above. `Setting` (the runtime configuration table holding every section's config keys): see §13.9.
- `FileAsset { id, ownerType, ownerId, kind: ORIGINAL|WEB|THUMB|STAMPED|PDF|OTHER, bucket, key, mime, sizeBytes, width?, height?, durationSec?, checksumSha256, uploadedByUserId, scanStatus: PENDING|CLEAN|INFECTED|SKIPPED, createdAt }`

### 3.5 Cross-Section Contracts (binding for all sections)

Each enum below is owned by the section in brackets. Other sections use it verbatim and don't redefine it.

```ts
enum CompetitionStatus {            // [§6]
  DRAFT, PUBLISHED /* visible, registration not open yet */, REGISTRATION_OPEN,
  REGISTRATION_CLOSED, IN_PROGRESS /* conduct + submission */, SCHOOL_JUDGING,
  FOA_JUDGING, RESULTS_PENDING_APPROVAL, RESULTS_PUBLISHED, ARCHIVED, CANCELLED }

enum Discipline { DRAWING, PAINTING, ART, CRAFT, ESSAY, PHOTOGRAPHY, VIDEOGRAPHY }  // [§6]
enum ParticipationRoute { INSTITUTION, INDIVIDUAL }                               // [§6]
enum DigitalSubmissionScope { ALL, SHORTLIST_ONLY }  // [§6] resolves the "top five or all?" debate per competition

enum EntryStatus {                  // [§6 owns DRAFT→FOA_VERIFIED, §7 owns IN_JUDGING→FINALIZED]
  DRAFT, SUBMITTED, NOT_SHORTLISTED, SCHOOL_SHORTLISTED, SUBMITTED_TO_FOA,
  FOA_VERIFIED, REJECTED_INELIGIBLE, IN_JUDGING, ELIMINATED, FINALIZED,
  WITHDRAWN, DISQUALIFIED }

enum PhysicalArtworkStatus {        // [§6] logistics track, separate from EntryStatus
  NOT_REQUIRED, REQUESTED, DISPATCHED, RECEIVED, VERIFIED, DISCREPANCY,
  IN_EXHIBITION, LISTED_FOR_AUCTION /* set by §8 */, SOLD /* set by §8 */,
  RETURNED, RETAINED }

enum JudgingLevel { SCHOOL, CITY, STATE, NATIONAL, GLOBAL }                       // [§7]
enum AwardScheme { RANKED /* 1st,2nd,3rd… */, GRADED /* A,B,… */, MEDAL /* GOLD,SILVER,BRONZE */ } // [§7]
enum EntryOutcome { WINNER, RUNNER_UP, FINALIST, SPECIAL_MENTION, PARTICIPANT }   // [§7]
enum CertificateType { PARTICIPATION, SCHOOL_MERIT, FINALIST, WINNER, RUNNER_UP, SPECIAL_MENTION,
  VOLUNTEER_SERVICE /* issued via §9.8 using the §7 engine */ } // [§7]

enum PaymentPurpose { REGISTRATION_FEE, DONATION, AUCTION }                       // [§8]
enum PaymentStatus { CREATED, AUTHORIZED, CAPTURED, FAILED, REFUNDED, PARTIALLY_REFUNDED } // [§8]

enum ConsentType {                  // [§12]
  TERMS, DATA_PROCESSING, PARTICIPATION, COMMUNICATION, PUBLIC_DISPLAY,
  SOCIAL_MEDIA, AUCTION_OF_ARTWORK, PARTICIPANT_PHOTO_VIDEO, GUARDIAN_VERIFIED }

enum EngagementMilestone {          // [§9]
  PARTICIPANT, SCHOOL_WINNER, FOA_FINALIST, COMMUNITY_MEMBER, VOLUNTEER, AMBASSADOR }
```

Fields on `Entry` that §6 and §7 share: `schoolRank Int?`, `schoolAwardLabel String?`, `finalOutcome EntryOutcome?`, `finalAwardLabel String?`, `galleryCandidate Boolean @default(false)`, `auctionCandidate Boolean @default(false)`.

Service interfaces other sections call (the owner section specifies the internals):

```ts
PaymentService.createOrder({ purpose, amountMinor, currency, payerUserId, refType, refId, notes? }) // §8
  // emits payment.captured / payment.failed with { paymentId, refType, refId }
PaymentService.recordOfflinePayment({ refType, refId, amountMinor, method, reference, receivedAt, proofFileAssetId }) // §8
  // FINANCE or STAFF_ADMIN; creates an OFFLINE Payment in CAPTURED and emits the same payment.captured
LedgerService.record({ type: 'INCOME'|'EXPENSE', category, amountMinor, currency, sourceType, sourceId, occurredAt }) // §8
ConsentService.has(participantId, ConsentType, competitionId?) / .require(...) / .record(...) / .withdraw(...) // §12
NotificationService.notify(eventKey, recipients[], payload)   // §10 owns templates + channels
EngagementService.recordMilestone(participantId|userId, EngagementMilestone, source) // §9 only: other sections emit events and never call it (§3.6)
StampService.stamp(fileAssetId, { variant: 'GALLERY'|'SOCIAL'|'CERT_SHARE' }) => FileAsset // §7
```

Domain event naming: `<entity>.<pastTenseVerb>`, with both parts in lowerCamelCase (`institutionMember.invited`, `galleryItem.published`, `entry.changesRequested`), e.g. `registration.confirmed`, `entry.submitted`, `entry.shortlisted`, `artwork.received`, `results.published`, `certificate.issued`, `lot.won`, `donation.captured`. Each section lists the events it emits. **The §10.3 catalogue is the single source of truth for event keys.** If a section and §10.3 disagree, §10.3 wins and the section must be corrected. Events a section emits that have no §10.3 row are recorded for analytics only and send nothing; a section that wants a message must add a row. Scheduled reminders use `reminder.<name>` keys owned and scheduled by §10. They are not domain events, and no section emits them. An event payload may carry `silent: true` to record the fact for analytics without sending notifications.

### 3.6 Integration Contracts Between Sections

These were agreed while the sections were written in parallel. They are binding.

| Contract | Owner | Consumer | Rule |
|---|---|---|---|
| Shortlist messages under `SHORTLIST_ONLY` | §7.3 | §6.9, §10.3 | Sent from the per-category lists in `schoolShortlist.finalized`. §7 `finalizeSchoolRound` is its sole emitter, exactly once per school round; §6 never emits it. `createShortlistedEntry` emits `entry.shortlisted` with `silent: true` |
| School shortlist service | §6.9 | §7.3, §7.5 | On finalize, §7 calls `EntryService.applySchoolShortlist({ institutionRegistrationId, categoryId, shortlisted, notShortlistedEntryIds })` once per category (scope ALL); under SHORTLIST_ONLY it uses `createShortlistedEntry`. `reopenSchoolRound` calls `EntryService.revertSchoolShortlist({ institutionRegistrationId, categoryId })`, allowed only while no entry of that institution × category is FOA_VERIFIED or later |
| School-judging window | §6.3 | §7.3 | `Competition.schoolShortlistSize` and `shortlistSubmissionClosesAt` are the only settings; a per-school extension is `SubmissionExtension(SHORTLIST)`. School rounds open when the competition enters SCHOOL_JUDGING, in both scopes. No auto-finalise or auto-forfeit: an unfinished round becomes OVERDUE (§7.15 E5) |
| Registration-fee payments | §8.3 | §6.6 | One order per `RegistrationPaymentBatch` (`refType: 'RegistrationPaymentBatch'`, `refId: batchId`, amount = Σ item `amountMinor`); an individual registration pays through a batch of one. §6 `markBatchPaidOffline` calls `PaymentService.recordOfflinePayment` (FINANCE, STAFF_ADMIN). A capture for a registration that is no longer payable puts the batch in NEEDS_REVIEW (`registration.paymentNeedsReview`), with no automatic refund. Refunds are requested by COMPETITION_MANAGER or STAFF_ADMIN and approved by FINANCE; a partial refund lists `RegistrationPaymentBatchItem` ids. Only competition cancellation and duplicate resolution refund without approval |
| Auction state on artwork | §6.10 | §8.5, §12.6 | Only §8 calls `ArtworkService.setAuctionState`. A lot accepts VERIFIED, IN_EXHIBITION or RETAINED artwork and stores `PhysicalArtwork.statusBeforeListing`. LISTED_FOR_AUCTION → `statusBeforeListing` when a lot is cancelled, unsold or unscheduled. On cancellation of a paid or shipped lot, §8 reverts SOLD → `statusBeforeListing`, or calls §6 `recordArtworkReturn` if the work goes back to the creator |
| Auction credit mode | §12.3 | §8.5 | Stored in `Consent.metadata.creditMode` on the AUCTION_OF_ARTWORK consent. For minors it is capped at FIRST_NAME_INITIAL |
| Physical readiness for judging | §6.10 | §7.2 | A round with `requiresPhysicalVerified` admits an entry iff `ArtworkService.physicalReady(entryId)` = `!artwork.requiredForJudging \|\| artwork.status ∈ {VERIFIED, IN_EXHIBITION, RETAINED}`. `waivePhysicalForJudging` sets `requiredForJudging = false` |
| Participation certificates | §7.7 | §6 | Issued from CONFIRMED Registrations that participated, not from Entries (SHORTLIST_ONLY students may have no Entry). One PARTICIPATION per registration (`categoryId` null); award certificates are per category |
| Consent-withdrawal SLAs | §12.6 | §7, §8, §9, §10 | Every consumer uses §12.6's deadlines verbatim (gallery ≤ 24 h, social takedown ≤ 72 h) |
| Competition display/auction flags | §6.2 | §7, §8, §12 | Canonical names are `allowPublicDisplay` and `allowAuction` |
| Institution competition routes | §6.11 | §7, §12 | Use `/institution/competitions/[code]/…` (competition code, not id) |
| Engagement milestones | §9.7 | §6, §7 | §9 subscribes to `registration.confirmed`, `entry.submitted`, `entry.withdrawn`, `entry.disqualified`, `certificate.issued`, `certificate.revoked` and `results.published`. Other sections never call `EngagementService` directly |
| Gallery/featured query | §7.10 | §9.4 | `GalleryQuery.featured(limit)` |
| Fund totals | §8.4 | §9.6 | `DonationQuery.totalForFund(fundId, since?: Date)` returns `{ amountMinor, currency, donorCount }` from CAPTURED donations net of refunds |
| Impact counters | §11.7 | §9.4 | `/api/v1/impact` is the only source for home and `/impact` counters. Overrides go through `ImpactAdjustment`, except `fundsRaisedMinor`: the sum of ledger INCOME in the donation categories over PUBLISHED months, read from §8's `TransparencySnapshot`, equal to the `/transparency` donations total |
| Moderation & display prefs | §12.7–12.8 | §7, §9 | `ModerationReview`, `ContentReport` and `ParticipantDisplayPrefs` are defined in §12 |
| Feature flags | §13.8 | all | Post-MVP modules ship behind `FeatureFlag` keys listed in §13.8 |

## 4. Roles & Permissions

### 4.1 Roles (`Role` enum)

| Role | Who | Scope |
|---|---|---|
| `MEMBER` | Any registered user (community member, donor, bidder, adopter) | self |
| `PARTICIPANT` | A user who owns a `ParticipantProfile` (adult, or a minor with a login) | own profile |
| `GUARDIAN` | Parent/guardian managing a minor's profile | linked participants |
| `INSTITUTION_ADMIN` | Authorised person / principal | one institution |
| `INSTITUTION_COORDINATOR` | Teacher coordinator | one institution |
| `JUDGE` | Jury member | assigned rounds |
| `VOLUNTEER` | Approved volunteer | assigned tasks |
| `ORG_REP` | Representative of an NGO, rescue organization or shelter | one organization |
| `STAFF_ADMIN` | FOA administrator | global |
| `SUPER_ADMIN` | Platform owner; manages roles and settings | global |
| `COMPETITION_MANAGER` | Program/competition coordinator | global or one competition |
| `CONTENT_MANAGER` | Social media and content team | content |
| `COMMUNITY_MANAGER` | Community, volunteers, events | community modules |
| `FINANCE` | Finance/accounts team | money and ledger |
| `AUCTION_MANAGER` | Auction administrator | auctions |
| `ADOPTION_COORDINATOR` | Adoption coordinator | adoption |

A user can hold several roles. Staff roles require 2FA (TOTP or passkey).

### 4.2 Permission Matrix (summary; each module section refines it)

| Capability | Public | Member | Participant/Guardian | Inst. Coord./Admin | Judge | Comp. Mgr | Staff Admin | Finance | Content |
|---|---|---|---|---|---|---|---|---|---|
| View published competitions, gallery, blog, transparency | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Register individually for a competition | | ✓ | ✓ | | | | | | |
| Register an institution / its students | | | | ✓ (own) | | | ✓ | | |
| Submit an entry | | | ✓ (own) | ✓ (own students) | | | ✓ | | |
| School-level judging and shortlisting | | | | ✓ (own) | | | ✓ | | |
| Score entries in a FOA round | | | | | ✓ (assigned) | | | | |
| Create or edit competitions, rounds, rubrics | | | | | | ✓ | ✓ | | |
| Approve and publish results | | | | | | ✓ | ✓ | | |
| Issue or revoke certificates | | | | | | ✓ | ✓ | | |
| Moderate gallery | | | | | | ✓ | ✓ | | ✓ |
| View participant PII | | | own | own students | **no** (sees entry code only) | ✓ | ✓ | | |
| Record ledger entries and publish financial reports | | | | | | | | ✓ | |
| Record an offline registration-fee payment | | | | | | | ✓ | ✓ | |
| Request a registration-fee refund (FINANCE approves) | | | | | | ✓ | ✓ | ✓ | |
| Manage roles | | | | | | | SUPER_ADMIN only | | |

**Judging is blind by default:** judges see the entry code, category, age group and the work itself. They do not see name, school or city.

## 5. Information Architecture & Routes

Mapping of the 33 core modules from the source document to routes. Detail pages and actions are specified in the module sections.

### 5.1 Public

| # | Module | Route(s) | Section |
|---|---|---|---|
| 1 | Home | `/` | 9 |
| 2 | About FOA | `/about` | 9 (CMS page) |
| 3 | Competitions | `/competitions`, `/competitions/[slug]`, `/competitions/[slug]/register`, `/competitions/[slug]/results` | 6, 7 |
| 4 | Art Gallery / Showcase | `/gallery`, `/gallery/[entryCode]` | 7 |
| 5 | Auctions | `/auctions`, `/auctions/[lotCode]` | 8 |
| 6 | Animal Adoption | `/adopt`, `/adopt/[id]`, `/adopt/[id]/apply` | 9 |
| 7 | Animal Welfare & Awareness | `/awareness`, `/awareness/[slug]` | 9 |
| 8 | Community | `/community` | 9 |
| 9 | Volunteer | `/volunteer`, `/volunteer/apply` | 9 |
| 10 | NGO Directory | `/ngos`, `/ngos/[slug]`, `/ngos/register` | 9 |
| 11 | Donate | `/donate`, `/donate/thank-you` | 8 |
| 12 | Financial Transparency | `/transparency` | 8 |
| 13 | Impact / Our Work | `/impact` | 9 |
| 14 | Schools & Institutions | `/schools`, `/schools/register` | 6 |
| 15 | Events & Campaigns | `/events`, `/events/[slug]` | 9 |
| 16 | News / Stories / Blog | `/blog`, `/blog/[slug]` | 9 |
| 17 | Contact Us | `/contact` | 9 |
| 18 | Registration / Login | `/login`, `/register`, `/verify-otp` | 6, 12 |
| — | Certificate verification | `/verify/[certificateNumber]` | 7 |
| — | Legal | `/privacy`, `/terms`, `/safeguarding`, `/child-protection-policy` | 12 |

### 5.2 Authenticated Dashboards

| # | Module | Route root | Section |
|---|---|---|---|
| 19 | User Dashboard | `/dashboard` (registrations, entries, certificates, donations, bids, applications, engagement timeline, managed children) | 6–9 |
| 20 | School / Institution Dashboard | `/institution` | 6, 7 |
| 21 | Judge / Jury Dashboard | `/judge` | 7 |
| 22 | FOA Admin Dashboard | `/admin` | all |
| 23 | Auction & Payment Mgmt | `/admin/auctions`, `/admin/payments` | 8 |
| 24 | Donation Mgmt | `/admin/donations` | 8 |
| 25 | Adoption Mgmt | `/admin/adoption` | 9 |
| 26 | Volunteer Mgmt | `/admin/volunteers` | 9 |
| 27 | Content / Social Media Mgmt | `/admin/content`, `/admin/social` | 9 |
| 28 | Reports & Analytics | `/admin/reports` | 11 |
| 29 | Finance / Budget Mgmt | `/admin/finance` | 8 |
| 30 | Notifications & Communications | `/admin/communications` | 10 |
| 31 | Certificates, Awards & Recognition | `/admin/certificates` | 7 |
| 32 | Logo stamping before social media | pipeline in §7; UI in `/admin/social` | 7 |
| 33 | Privacy, Consent & Safeguarding | `/admin/safeguarding`, `/admin/consents`, `/dashboard/privacy` | 12 |
