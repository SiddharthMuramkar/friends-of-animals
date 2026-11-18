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

The stack is locked (decided in issue #11). Keep the architecture; a row changes only through a new decision on a GitHub issue. Versions are pinned in `package.json` and the Compose files.

| Concern | Lock | Notes |
|---|---|---|
| Framework | **Next.js 16.4.x (App Router) + TypeScript (strict)**, started from `create-next-app` | Server Components and Server Actions; Route Handlers for auth, webhooks and the public API. Turbopack, `cacheComponents: true`, `output: 'standalone'` |
| Runtime | Node 26 LTS (`engines.node: "26.x"`); TypeScript 7.0.x | `next build` type-checks with the project's `tsc` |
| Tooling | pnpm 12; oxlint (type-aware via `oxlint-tsgolint`; `nextjs`, `react`, `jsx-a11y` and `import` plugins) + oxfmt | oxlint replaces ESLint and oxfmt replaces Prettier |
| UI | Tailwind CSS 4 + shadcn/ui (`rsc: true`), `next/font` Inter, lucide icons | Mobile-first. WCAG 2.2 AA |
| i18n | next-intl 4 | Wired in M0 (§13.5) |
| Validation | Zod 4 | Shared by forms and services (§2.2) |
| DB | **PostgreSQL 18.7** in Docker on the Mumbai VPS: `pg-prod` and `pg-nonprod` | Never published on a host port. Databases per environment: §2.4 |
| Pooler | PgBouncer 1.26, the only public DB endpoint | TLS (Let's Encrypt) + SCRAM, transaction pooling, port 6432. Reachable only from Vercel Static IPs (Hostinger firewall plus a `DOCKER-USER` rule) |
| ORM | **Drizzle ORM 0.45.4** + drizzle-kit 0.31.x on postgres.js, pinned | Prefer the core query builder over RQB v1. Move to Drizzle 1.0 when it is stable and Better Auth's peer range allows. SQL migrations in `drizzle/`, checked in |
| Backups | pgBackRest to Cloudflare R2 (WAL pushed at least every 60 s, 30-day PITR), plus a daily `age`-encrypted `pg_dump` kept 35 days in a locked bucket | Quarterly restore drill (§13.1) |
| Auth | **Better Auth 1.7.x** + Drizzle adapter | Email OTP, phone OTP through our `SmsProvider`, TOTP/passkey, captcha. Password optional. Sessions in DB. FOA layer on top: scoped `UserRole` + `can()`, guardian rules, staff 2FA gate, step-up (§4, §13.1) |
| Object storage | **Cloudflare R2** via the S3 API | Buckets `foa-private` (originals, `quarantine/`), `foa-public` (derived/stamped assets only) and `foa-evidence` (§13.1). Vercel Blob is not used |
| Uploads | Presigned direct-to-bucket uploads from the browser (multipart above 100 MB) | Server never proxies large files |
| CDN | Cloudflare CDN on `media.<foa-domain>` in front of `foa-public` | Purge by URL through the Cloudflare API (§7.10, §12.6) |
| Image and video | `sharp` + `heif-dec` (HEIC); ffmpeg/ffprobe | Thumbnails, web derivatives, EXIF stripping, logo stamping, video posters. Runs in `worker-media` |
| PDF | Headless Chromium (Playwright) HTML→PDF in `worker-media`; Gotenberg 8 (LibreOffice) for DOCX→PDF | Certificates, receipts, letters, rendered cards |
| Antivirus | ClamAV (`clamd` over TCP on the Compose network) | Every upload is scanned before promotion (§13.1) |
| QR | `qrcode` | Certificate verification |
| Background jobs | **pg-boss 12** on the same Postgres | `worker` and `worker-media` containers on the VPS. Vercel only sends jobs (§2.2). Every schedule is a pg-boss cron with tz `Asia/Kolkata`, run by `worker`. Vercel Cron is not used |
| Caching | `'use cache'` + `cacheTag` / `cacheLife`; `revalidateTag(tag, profile)` and `updateTag` | The worker invalidates only through the internal route (§2.2) |
| Rate limits | Stored in Postgres | No Redis |
| Payments | **Razorpay** (Orders, Subscriptions, Webhooks; domestic methods, §8.4.6) behind a `PaymentProvider` interface | Fees, donations, auction payments |
| Email | **Amazon SES** (`ap-south-1`) behind an `EmailProvider` interface | Templated, React Email |
| SMS | **MSG91** behind an `SmsProvider` interface | Indian SMS needs DLT-registered templates |
| Search | Postgres full-text plus `pg_trgm` | Gallery, NGO directory, admin lists |
| Observability | Sentry (`@sentry/nextjs` on Vercel, `@sentry/node` in the worker, Sentry cron monitors), pino structured logs, `/api/health` | §13.3 |
| Hosting | Vercel Pro (functions in `bom1`) for the app; Docker Compose on the Mumbai VPS for data and workers | §2.3 |
| Testing | Vitest (latest) + PGlite (unit/domain); Playwright (E2E) in GitHub Actions CI, never on the VPS | State machines MUST have unit tests covering every allowed and disallowed transition |

### 2.1 Repository Layout

```
src/
  app/                   # App Router: layout.tsx, page.tsx, not-found.tsx, error.tsx, global-error.tsx, globals.css
    (public)/            # marketing + public modules
    (auth)/              # login, register, verify OTP
    dashboard/           # participant / member / guardian dashboard
    institution/         # school/college coordinator dashboard
    judge/               # judge/jury dashboard
    admin/               # FOA staff dashboard
    verify/[certificateNumber]/   # public certificate verification (QR target)
    api/auth/[...all]/route.ts    # Better Auth handler
    api/webhooks/razorpay/route.ts  # also ses/ and msg91/ (§10.7)
    api/internal/revalidate/route.ts  # HMAC-signed cache invalidation for the worker (§2.2)
    api/health/route.ts  # DB, queue and worker heartbeat (§13.3)
    api/v1/...           # JSON API only where needed (uploads, polling)
  components/            # site chrome
    ui/                  # shadcn/ui
  lib/                   # pure utilities (site, utils, ids, money, dates)
  env.schema.ts          # zod env schemas + parseEnv(); no server-only, so scripts and drizzle-kit can import it
  env.ts                 # server-only, cached env accessor (§13.9)
  instrumentation.ts     # validates the env when the server starts (§13.9); Node-only half in instrumentation-node.ts
  server/
    db/
      index.ts           # Drizzle client (postgres.js)
      schema/            # one file per module + index.ts barrel
      pii.ts             # PII registry and encrypted columns (§12.2, §13.1)
      repositories/
    domain/<module>/     # services, state machines, validators (zod), policies
    jobs/                # pg-boss queues, handlers, schedules, send helpers
    integrations/        # payment, email, sms, storage, CDN-purge adapters
    auth/                # Better Auth config, session helpers, RBAC
  worker/                # pg-boss worker entrypoint; imports src/server
  emails/                # React Email templates
  i18n/                  # next-intl config
  test/                  # PGlite test harness
messages/                # next-intl message files, {locale}.json (§13.5)
drizzle/                 # generated SQL migrations plus hand-written SQL (partial indexes, triggers), checked in
scripts/
  migrate.ts             # applies drizzle/ through DIRECT_URL
  load-env.ts            # loads .env.local and .env for scripts and drizzle-kit
  seed.ts                # later (M0): realistic seed: 1 competition, 3 schools, 30 participants, 2 judges
  brand-assets.ts
docker/                  # VPS Compose files; PgBouncer and pgBackRest config
docker-compose.yml       # local stack: Postgres 18 on 127.0.0.1
Dockerfile               # standalone app image for the local stack
tests/e2e/               # Playwright (runs in GitHub Actions)
```

### 2.2 Architectural Rules

- **Domain services own the business logic.** UI and route handlers call services. Services call repositories. Policies (`can(user, action, resource)`) run inside services.
- **Validation:** zod schemas live next to each service. The same schemas validate forms on the client.
- **Idempotency:** webhook handlers and payment-confirmation flows MUST be idempotent, keyed by provider event ID.
- **Files:** originals are private and served only through short-lived signed URLs, after an authorization check. Public pages only ever show derived assets with metadata stripped and the logo stamped (§7).
- **Soft delete** (`deletedAt`) for user-generated content. Hard delete only through the data-erasure workflow (§12).
- **Cache invalidation.** Cached reads use `'use cache'` with `cacheTag` and `cacheLife`. A Server Action invalidates with `updateTag` (read-your-own-writes) or `revalidateTag(tag, profile)`. The worker can't call either, so it MUST revalidate only through `POST /api/internal/revalidate`: the body carries the tags and a timestamp and is signed with HMAC-SHA256 (`REVALIDATE_SECRET`); a bad or stale signature gets 401. For removals (consent withdrawal, erasure, takedown) the route uses `revalidateTag(tag, { expire: 0 })`, so no stale copy is served.
- **Database connections and jobs.** Vercel functions reach Postgres only through PgBouncer in transaction mode (`DATABASE_URL`; postgres.js with `prepare: false` and a small pool). Migrations use `DIRECT_URL` (§2.3). pg-boss workers and the Outbox `LISTEN` MUST use a direct Postgres connection on the Compose network, never the transaction-mode PgBouncer. The Vercel side only sends jobs: pg-boss runs there with supervision, scheduling and migration off, and each `send` runs inside the caller's Drizzle transaction, so a job exists only if the change committed. Outbox rows (§3.3) fire `NOTIFY` from an insert trigger; the worker's dispatcher listens and also polls every 5 s (§10.1).

### 2.3 Placement

| Where | Runs |
|---|---|
| **Vercel Pro**, functions in `bom1` | The Next.js app: pages, Server Actions and Route Handlers (auth, webhooks, `/api/health`, `/api/internal/revalidate`). R2 presigning. pg-boss send-only. DB migrations in `vercel-build` through `DIRECT_URL`, a PgBouncer session-mode entry with a migrator role; migrations take a Postgres advisory lock (#12). Builds use the Static IPs ("Use Static IPs for builds" on), because PgBouncer accepts only those IPs |
| **Mumbai VPS** (Docker Compose) | `pg-prod`, `pg-nonprod`, `pgbouncer`, `worker`, `worker-media`, `clamav`, `gotenberg`, and the pg-boss dashboard (on 127.0.0.1 only, reached through an SSH tunnel) |
| **Cloudflare** | R2 buckets, the `media.<foa-domain>` CDN, and the backup repository and dump bucket |
| **GitHub Actions** | CI, Playwright E2E, worker image builds |

- Vercel reaches the database only through PgBouncer on port 6432. There is no HTTP path from Vercel to the worker: work is handed over through Postgres (Outbox rows and pg-boss jobs).
- The worker connects to Postgres directly on the Compose network. Apart from fetching the app's public static assets (certificate rendering, §7.7), the only app endpoint it calls is `/api/internal/revalidate` (§2.2).
- Only PgBouncer on port 6432 (from Vercel Static IPs only) and SSH accept inbound traffic on the VPS. Any other published port binds 127.0.0.1, because Docker-published ports bypass ufw.
- Worker images are built by GitHub Actions, pushed to GHCR tagged with the commit SHA, and deployed with `docker compose pull && docker compose up -d --wait`. A rollback redeploys the previous tag.

### 2.4 Environments

| Environment | App | Database | Notes |
|---|---|---|---|
| **local** | `pnpm dev` | Compose Postgres 18 on 127.0.0.1; Vitest uses in-memory PGlite | Email to Mailpit. Storage: a local S3 server (RustFS container) or the in-memory storage driver |
| **preview** | Vercel preview deployment per PR | `foa_pr_<n>` on `pg-nonprod`, created from the template database `foa_seed` during `vercel-build` and dropped when the PR closes | |
| **staging** (test) | `foa.shipped-it.dev`, Vercel custom environment `staging` | `foa_staging` on `pg-nonprod` | |
| **production** | FOA's own domain | `pg-prod`, with PITR (§13.1) | SES out of sandbox; Razorpay live |

- Behaviour switches read `APP_ENV` (`local`, `preview`, `staging` or `production`), never `VERCEL_ENV`, which reads `preview` in the custom `staging` environment.
- Per-environment rules for payments, email and SMS: §13.8.

## 3. Conventions

**Notation.** The `prisma` code blocks in this spec describe the logical model. Implement them in Drizzle (`src/server/db/schema/`):

- **Keys.** `id String @id` → `uuid` (UUIDv7, generated in the app). A column that references an `id`, including one used as the key (e.g. `competitionId String @id`), takes that `id`'s type. A natural key (e.g. `Setting.key`, `ShortLink.code`, `ReceiptSequence.fy`, `FinancialPeriod.month`) keeps its own type, here `text`.
- **Scalars.** `String` → `text`; `Int` → `integer`; `BigInt` → `bigint` (`@default(autoincrement())` → an identity column); `Boolean` → `boolean`; `Float` → `double precision`; `Decimal` / `@db.Decimal(p,s)` → `numeric` / `numeric(p,s)`; `Bytes` → `bytea`; `DateTime` → `timestamptz`, but `DateTime @db.Date` → `date`; `Json` → `jsonb`; enums → `pgEnum`; `Unsupported("tsvector")` → a `customType`.
- **Encrypted columns.** A column listed as encrypted in §13.1, marked `enc` or named `…Encrypted` uses the encrypted `customType` in `src/server/db/pii.ts`, whatever its logical type.
- **Indexes.** `@@index` / `@@unique` → Drizzle `index()` / `uniqueIndex()`. Partial indexes and triggers are written as SQL in `drizzle/` migrations.

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

## 7. Judging, Results, Certificates, Gallery & Logo Stamping

**Owns:** rubrics, school-level and FOA-level judging rounds, score storage and aggregation, results approval and publishing, certificates, prize fulfilment, `StampService`, the gallery and the social export queue. This section owns the §3.5 enums `JudgingLevel`, `AwardScheme`, `EntryOutcome` and `CertificateType`. All other enums, the core entities (§3.4) and the code formats (§3.1) are used verbatim.

**Assumed §6 names (map 1:1 if §6 differs):** `Registration` (`participantId`, `institutionRegistrationId?`, categories via `RegistrationCategory`, confirmed status); `InstitutionRegistration`; `Entry` (`registrationId`, `participantId`, `categoryId`, `discipline`, plus EXIF-stripped `WEB` media and a video poster); `PhysicalArtwork`; the competition category (discipline × age group, called `categoryId` here); and the competition flags `allowPublicDisplay` and `digitalSubmissionScope`. §7 calls §6's `EntryService.applySchoolShortlist` to run `SUBMITTED → SCHOOL_SHORTLISTED | NOT_SHORTLISTED`, and `EntryService.revertSchoolShortlist` for its reversal when a school round is reopened. §7 defines the guards for `FOA_JUDGING → RESULTS_PENDING_APPROVAL → RESULTS_PUBLISHED` and requests those transitions through §6's `CompetitionService.transition()`.

**Role abbreviations:** CM = COMPETITION_MANAGER (global or scoped to the competition), SA = STAFF_ADMIN (SUPER_ADMIN implies SA), IA/IC = INSTITUTION_ADMIN / INSTITUTION_COORDINATOR (own institution), J = JUDGE (own assignment), CT = CONTENT_MANAGER, P/G = PARTICIPANT / GUARDIAN (own or linked profile). Every action follows §0: permission → transition guard → AuditLog → Outbox event. Event names use the camelCase entity names that §10 already consumes. **Public identity** (name form, school, city) always follows §12.7 `ParticipantDisplayPrefs`. §7 toggles can only hide more.

### 7.1 Judging Framework (Rubrics)

```prisma
enum RubricStatus { DRAFT PUBLISHED ARCHIVED }
model JudgingRubric {
  id String @id;  competitionId String;  discipline Discipline? /* null = competition default */;  version Int
  status RubricStatus @default(DRAFT);  title String;  guidanceHtml String  // sanitized: how to judge, panel + COI guidance
  frameworkPdfAssetId String?;  publishedAt DateTime?;  publishedByUserId String?
  @@unique([competitionId, discipline, version])
}
model RubricCriterion {
  id String @id;  rubricId String;  order Int;  key String /* unique per rubric */;  label String
  description String                       // what earns high vs low marks
  weight Decimal @db.Decimal(5,2)          // > 0, relative
  maxScore Int @default(10)                // 1–100; judges enter integers 0..maxScore
}
```

- **Rubric resolution:** an entry is scored on the PUBLISHED rubric for `(competitionId, entry.discipline)`, falling back to `(competitionId, null)`. Opening any round, school or FOA, requires a rubric to resolve for every discipline in the competition. Each pair has at most one PUBLISHED rubric, and publishing a new version ARCHIVES the old one. A version referenced by any round past DRAFT is immutable; rounds pin it in `RoundEntry.rubricId`.
- **Validation:** 2–10 criteria, every weight > 0.
- **Seeded default:** Theme & message (30), Creativity & originality (25), Technique (25; the label varies by discipline: "Language & structure" for ESSAY, "Composition & light" for PHOTOGRAPHY, "Storytelling & editing" for VIDEOGRAPHY), Presentation & effort (20), each scored out of 10.
- **Weighted total:** computed on the server only, on a 0–100 scale to 2 decimals: `weightedTotal = 100 × Σᵢ(wᵢ × sᵢ / maxᵢ) / Σᵢ wᵢ`.
- **Standardized judging framework:** on publish, job `rubric.render_pdf` uses Playwright to build a PDF with the criteria per discipline, the `SchoolJudgingPolicy` (§7.3), panel and COI guidance, and the certification text. The same content renders in `/institution/competitions/[code]/judging` and `/judge/rounds/[roundId]/framework`. The PDF is served without authentication (it contains no PII) by `/competitions/[slug]/judging-framework.pdf` and is rebuilt when the rubric or policy changes.

### 7.2 Rounds: Model & Configuration

```prisma
enum JudgingMode { DIGITAL PHYSICAL }            enum RoundEntryPool { FOA_VERIFIED PREVIOUS_ROUND_ADVANCED }
enum PartitionBy { NONE CITY STATE COUNTRY }     enum AssignmentMode { ALL BALANCED }
enum NormalizationMode { NONE Z_SCORE }          enum JudgingRoundStatus { DRAFT OPEN SCORING_CLOSED LOCKED FINALIZED CANCELLED }
model JudgingRound {
  id String @id;  competitionId String;  level JudgingLevel;  name String   // "All India Final"
  sequence Int                                   // SCHOOL = 0; FOA rounds 1..n with non-decreasing level
  status JudgingRoundStatus @default(DRAFT)
  // SCHOOL only
  institutionRegistrationId String? @unique      // required iff level = SCHOOL
  certifiedByUserId String?;  certifiedAt DateTime?;  certificationTextHash String?;  shortfallReason String?
  closedOnBehalfMode String? /* PARTICIPATION_ONLY | STAFF_ENTERED */
  // FOA only
  mode JudgingMode @default(DIGITAL);  requiresPhysicalVerified Boolean @default(true)
  entryPool RoundEntryPool?;  routeFilter ParticipationRoute[] /* default both */;  sourceRoundIds String[]
  partitionBy PartitionBy @default(NONE);  isFinal Boolean @default(false)   // exactly one final round per competition
  advanceCount Int?                              // per (category, partition); null iff isFinal
  awardScheme AwardScheme?;  awardBands Json @default("[]")   // AwardBand[]; [] = no awards this round
  minJudgesPerEntry Int @default(3);  assignmentMode AssignmentMode @default(ALL)
  normalization NormalizationMode @default(NONE);  tieBreak Json /* TieBreakStep[], §7.4.5 */;  shareFeedback Boolean @default(false)
  opensAt DateTime?;  closesAt DateTime?;  resultsHash String? /* set at LOCK */
  openedAt DateTime?;  closedAt DateTime?;  lockedAt DateTime?;  finalizedAt DateTime?;  finalizedByUserId String?
}
enum RoundEntryStatus { ACTIVE EXCLUDED WITHDRAWN DISQUALIFIED }
model RoundEntry {
  id String @id;  roundId String;  entryId String;  categoryId String;  partitionKey String?
  rubricId String /* pinned at open */;  blindTitle String? /* redacts an identifying title */
  status RoundEntryStatus @default(ACTIVE);  excludedReason String?;  submittedSheetCount Int @default(0)
  meanScore Decimal?;  normalizedScore Decimal?;  finalScore Decimal? /* normalizedScore ?? meanScore; all Decimal(5,2) */
  rank Int? /* within (categoryId, partitionKey); may be shared */;  insufficientScores Boolean @default(false)
  advanced Boolean @default(false);  awardBandKey String?;  awardLabel String?;  specialMention Boolean @default(false)
  overrideReason String?;  galleryRecommendations Int @default(0);  auctionRecommendations Int @default(0)
  @@unique([roundId, entryId])
}
```

```ts
type AwardBand = { key: string; label: string /* "All India 1st" | "A Grade" | "Gold" */;
  outcome: 'WINNER' | 'RUNNER_UP' | 'SPECIAL_MENTION';
  rankFrom?: number; rankTo?: number;         // RANKED, MEDAL (inclusive)
  minPercent?: number;                        // GRADED: finalScore ≥ minPercent, evaluated top-down
  prizeId?: string /* → §6 CompetitionPrize; drives PrizeFulfilment (§7.8) */ };
type TieBreakStep = { kind: 'CRITERION_MEAN_BY_WEIGHT' | 'MEDIAN_TOTAL' | 'MANUAL' };
```

- **Default bands** (editable): RANKED is 1st (WINNER, rank 1), 2nd (RUNNER_UP, 2), 3rd (RUNNER_UP, 3). MEDAL is Gold, Silver and Bronze over the same ranks. GRADED is A Grade (WINNER, ≥ 80) and B Grade (RUNNER_UP, ≥ 65). Overlapping bands are rejected on save.
- **Default plan** (seeded with the competition): one FOA round with `NATIONAL`, `isFinal`, `PHYSICAL`, `entryPool FOA_VERIFIED` and §6 `Competition.awardScheme` (the default for the final round; the round may override it).
  - **Adding levels:** each extra level is a round with `entryPool PREVIOUS_ROUND_ADVANCED`.
  - **Partitions:** CITY (City/District) partitions by CITY, STATE by STATE, NATIONAL by COUNTRY or NONE, GLOBAL by NONE.
  - **Partition key:** the trimmed, lowercased `ParticipantProfile.city/state/country`. Judges never see it.
- **Pool guard:** an entry joins a round only if both checks pass.
  - **Consent:** `ConsentService.has(participantId, PARTICIPATION, competitionId)` (§12 gate for judging).
  - **Physical:** `PHYSICAL` forces `requiresPhysicalVerified`. A round with `requiresPhysicalVerified` admits an entry iff §6 `ArtworkService.physicalReady(entryId)`.
  - Entries that fail stay FOA_VERIFIED and appear under "Blocked" on the Pool tab, with the reason.

### 7.3 School-Level Judging (Phase 6)

```prisma
model SchoolJudgingPolicy {                      // one per competition with the INSTITUTION route
  competitionId String @id;  positionsPerCategory Int @default(3) /* 3 or 5 */
  positionLabels String[] @default(["1st","2nd","3rd"])  // N and the window are §6 Competition.schoolShortlistSize / shortlistSubmissionClosesAt
  rubricScoresRequired Boolean @default(false);  minPanelSize Int @default(1) /* UI recommends 3 */
  certificationText String /* versioned; hash stored on the round */
}
model SchoolPanelMember { id String @id; roundId String; name String; designation String; isExternal Boolean @default(false) } // no account
model SchoolResult {
  id String @id;  roundId String;  registrationId String;  categoryId String
  entryId String?                                // null under SHORTLIST_ONLY or when nothing was submitted
  participated Boolean                           // default: SUBMITTED entry exists (ALL) / true (SHORTLIST_ONLY)
  position Int?                                  // 1..positionsPerCategory, unique per (roundId, categoryId)
  advanced Boolean @default(false);  scores Json? /* {criterionKey:int} */;  weightedTotal Decimal? @db.Decimal(5,2)
  @@unique([roundId, registrationId, categoryId])
}
```

1. **Creation:** when a §6 InstitutionRegistration becomes ACTIVE, a SCHOOL round (DRAFT) is created for it. It opens when the competition enters SCHOOL_JUDGING (at `submissionClosesAt`), in both scopes. On opening, one `SchoolResult` row is created per confirmed Registration and category, and rows are re-synced while the round is OPEN.
2. **Coordinator UI** (`/institution/competitions/[code]/judging`): the framework (rubric and PDF), a panel editor and a results grid per category. School rounds are not blind: rows show name, registration number and a thumbnail via signed URL. Columns are participated, position, advance and optional rubric scores. The grid autosaves through `saveSchoolResults`.
3. **`finalizeSchoolRound` validations** (errors reported per row):
   - V1: the panel has at least `minPanelSize` members.
   - V2: the certification box is ticked ("conducted and judged according to FOA guidelines"). Stores `certifiedByUserId`, `certifiedAt` and `certificationTextHash`.
   - V3: positions are unique within 1..`positionsPerCategory` and belong to participated rows.
   - V4: at most N (§6 `schoolShortlistSize`) advanced rows per category. If fewer than min(N, participated count), `shortfallReason` is required.
   - V5: if `positionsPerCategory ≤ N`, every positioned row is advanced.
   - V6: under ALL, every advanced row has a SUBMITTED entry. Under SHORTLIST_ONLY, no entry is needed.
   - V7: if `rubricScoresRequired`, every advanced row has all scores in range.
4. **Finalize effects** (one transaction, plus jobs):
   - The round → FINALIZED and becomes read-only for the school.
   - **ALL:** §6 `EntryService.applySchoolShortlist({ institutionRegistrationId, categoryId, shortlisted: [{ entryId, schoolRank, schoolAwardLabel }], notShortlistedEntryIds })`, called once per category, moves each SUBMITTED entry to SCHOOL_SHORTLISTED or NOT_SHORTLISTED, with `schoolAwardLabel = positionLabels[position-1]`.
   - **SHORTLIST_ONLY:** no entry moves. §6 allows the Phase 7 upload only for registration × category pairs with `SchoolResult.advanced` and creates each Entry directly in SCHOOL_SHORTLISTED through `EntryService.createShortlistedEntry`, copying `schoolRank` and `schoolAwardLabel`.
   - **Certificates** (§7.7): one PARTICIPATION per Registration with a participated row (keyed by Registration, so students with no digital entry are covered) and SCHOOL_MERIT for every positioned row.
   - **Milestone:** none recorded here. §9 derives SCHOOL_WINNER from `certificate.issued` (SCHOOL_MERIT), so §7 does not call `EngagementService` directly.
   - **Event:** `schoolShortlist.finalized { roundId, competitionId, institutionRegistrationId, scope, categories: [{ categoryId, shortlistedRegistrationIds[], notShortlistedRegistrationIds[] }] }`. §7 `finalizeSchoolRound` (including a close on behalf) is its sole emitter, exactly once per school round; §6 never emits it.
   - **Messages under ALL:** §10 sends "shortlisted for further judging" and "not shortlisted" from §6's `entry.shortlisted` / `entry.notShortlisted`.
   - **Messages under SHORTLIST_ONLY:** §10 sends both messages from this event's lists. §6's later creation of the entry in SCHOOL_SHORTLISTED MUST NOT re-send `entry.shortlisted`.

### 7.4 FOA-Level Judging (Phase 9)

#### 7.4.1 Judge Assignment & Conflicts of Interest

```prisma
enum JudgeAssignmentStatus { INVITED ACCEPTED DECLINED REMOVED }
model JudgeAssignment {
  id String @id;  roundId String;  judgeUserId String /* UserRole JUDGE, scopeType COMPETITION */
  categoryIds String[];  partitionKeys String[] /* empty = all */;  status JudgeAssignmentStatus @default(INVITED)
  coiInstitutionIds String[];  coiStatement String? /* "none" is explicit */;  coiDeclaredAt DateTime?;  removedReason String?
  @@unique([roundId, judgeUserId])
}
```

- **Invitations:** sent to a user or an email address. Accepting creates the user and the scoped `JUDGE` role if needed. It requires agreeing to the code of conduct and confidentiality terms and declaring conflicts of interest.
- **Clearance:** accepting, and opening a round, run `SafeguardingService.assertCleared(judgeUserId, 'JUDGE')` (§12.9). PHYSICAL rounds count as in-person judging and require police verification.
- **Automatic conflicts:** every institution where the judge is an `InstitutionMember` is added. Any entry whose participant has the judge as `Guardian.userId` is treated as conflicted. A conflicted judge never gets a sheet for that entry, and the server never says why.
- **Distribution when the round opens:**
  - `ALL`: every ACCEPTED judge on a category scores every non-conflicted entry in it.
  - `BALANCED`: each entry gets exactly `minJudgesPerEntry` judges, least-loaded first, with seeded random tie-breaks (seed = roundId).
  - Each (judge, RoundEntry) pair gets one PENDING `ScoreSheet`.
  - Opening fails, naming the affected entries, if any entry would have fewer than `minJudgesPerEntry` eligible judges.

#### 7.4.2 Scoring, Storage, Comments, Re-scoring

```prisma
enum ScoreSheetStatus { PENDING DRAFT SUBMITTED VOID }   enum FeedbackStatus { PENDING APPROVED SUPPRESSED }
model ScoreSheet {
  id String @id;  roundId String;  roundEntryId String;  judgeAssignmentId String;  judgeUserId String
  status ScoreSheetStatus @default(PENDING);  weightedTotal Decimal? @db.Decimal(5,2)
  privateComment String?                          // FOA staff only; never shown to participants or schools
  participantFeedback String?;  feedbackStatus FeedbackStatus @default(PENDING)  // shown only if shareFeedback && APPROVED
  recommendGallery Boolean @default(false);  recommendAuction Boolean @default(false)
  enteredByUserId String?;  proxyScanAssetId String?   // PHYSICAL proxy entry by staff
  version Int @default(0);  submittedAt DateTime?;  voidReason String? /* COI|JUDGE_REMOVED|ENTRY_WITHDRAWN|ROUND_CANCELLED */
  @@unique([roundEntryId, judgeUserId])
}
model CriterionScore     { scoreSheetId String; criterionId String; score Int; @@id([scoreSheetId, criterionId]) }
model ScoreSheetRevision { id String @id; scoreSheetId String; version Int; snapshot Json; changedByUserId String; reason String?; createdAt DateTime } // append-only
```

- **Submit** requires every criterion scored as an integer from 0 to max. The server computes `weightedTotal`.
- **Re-scoring audit:** while the round is OPEN, a judge may edit their own SUBMITTED sheet. Each edit bumps `version`, writes a `ScoreSheetRevision` and an AuditLog row, and emits `scoreSheet.revised`. After SCORING_CLOSED, sheets change only if the round is reopened. The results and approval views flag re-scored sheets.
- **Feedback:** if `shareFeedback` is on, CM/SA must approve, edit or suppress each item before results are proposed. Approved feedback appears, attributed to "Judge 1..n", on `/dashboard/entries/[entryCode]` after results are PUBLISHED.

#### 7.4.3 Blind Scoring UI (`/judge/rounds/[roundId]/entries/[entryCode]`)

- **Shows:** entry code, discipline, category/age-group label, title (or `blindTitle`), description and statement, and `WEB` media only (images with zoom up to 4096 px, essay text, video player). Also the rubric with descriptions, score inputs, a live weighted total, private comment, feedback box (only if `shareFeedback`), gallery/auction recommendation toggles, "Declare conflict", Save draft (autosaves every 10 s), Submit and Prev/Next.
- **Never shows:** names, school, city, DOB, registration or participant codes, original file names, other judges' scores, aggregates or ranks. Judge routes serialize through an allow-list.
- **Queue:** shuffled per judge (seed = judgeUserId + roundId), filterable by category and status.
- **PHYSICAL mode:** judges score in the same UI on tablets at the venue, with the queue sorted by `PhysicalArtwork.artworkCode` (the only label on the work). Alternatively, a CM keys in printed per-judge paper sheets with `enterScoresOnBehalf`, which requires a scan.

#### 7.4.4 Aggregation, Ties, Advancement & Outcomes

- **Aggregation:** only SUBMITTED sheets count. `meanScore` is the mean of `weightedTotal`. `insufficientScores` means `submittedSheetCount < minJudgesPerEntry`.
- **`Z_SCORE`** (optional): for each judge, within the round and category, `z = (x − μⱼ)/σⱼ`, rescaled to `50 + 10z` and clamped to 0–100. `normalizedScore` is the mean of the rescaled values. A judge with fewer than 5 sheets in the category, or with σⱼ = 0, contributes raw totals.
- **Ranking:** within each (categoryId, partitionKey), over ACTIVE entries only, by `finalScore` descending. Results are recomputed on close and reopen, and on demand while SCORING_CLOSED.
- **Tie-breaks (default chain):**
  1. Mean criterion score as a percentage of max, comparing criteria in descending weight (rubric order breaks equal weights).
  2. The higher median `weightedTotal`.
  3. MANUAL.

  Entries still tied share a rank (1, 2, 2, 4).
- **Boundary ties:** a shared rank that straddles the advance cutoff or an award-band edge creates a `TieResolution { id, roundId, groupKey, boundary: 'ADVANCE'|'AWARD:<bandKey>', roundEntryIds[], resolution?: 'ORDER'|'SHARE', orderedEntryIds[], reason?, resolvedByUserId?, resolvedAt? }`. It must be resolved before LOCK.
  - `SHARE` at the cutoff advances every tied entry, so the cutoff expands. `SHARE` at an award edge gives all of them the better band ("Joint 2nd"). `ORDER` applies the manager's order.
  - The UI pre-selects SHARE for ADVANCE and ORDER for AWARD. A reason is always required.
- **Advancement and awards:** the top `advanceCount` per (category, partition) advance; a smaller group advances entirely. Bands are applied top-down. `specialMention` is set manually, in any round. In SCORING_CLOSED a CM may override `advanced`, `awardBandKey` or `specialMention` with `overrideRoundEntry` and a reason; overrides are highlighted at approval.
- **Outcomes:** finalizing the final round sets the following for every entry that entered FOA judging:

| Entry | `status` | `finalOutcome` | `finalAwardLabel` |
|---|---|---|---|
| In the final round and matched a band | FINALIZED | band.outcome | band.label |
| In the final round with `specialMention` and no band | FINALIZED | SPECIAL_MENTION | "Special Mention" |
| In the final round, otherwise | FINALIZED | FINALIST | "Finalist" |
| Eliminated earlier with `specialMention` in any round | ELIMINATED | SPECIAL_MENTION | "Special Mention" |
| Eliminated earlier | ELIMINATED | PARTICIPANT | highest level-award label won, else null |

- **Candidate flags** (CM can edit them until the initial release is PUBLISHED; §8 reads `auctionCandidate`):
  - `galleryCandidate` is preset for WINNER, RUNNER_UP, SPECIAL_MENTION and FINALIST, or when at least 50% of final-round sheets recommend the entry.
  - `auctionCandidate` is preset when at least 50% recommend it and its PhysicalArtwork is VERIFIED.
- **Participant view:** participants and schools see only "In FOA judging" for IN_JUDGING, ELIMINATED and FINALIZED entries until results are PUBLISHED. Eliminations in individual rounds are never notified.
- **Progress** (round page): sheets submitted out of the total; per judge, pending, draft, submitted and last activity; per category, coverage; and the list of `insufficientScores` entries.
- **Reminders and auto-close:** §10 schedules `reminder.judgingDue` from `closesAt` using `JudgingQuery.pendingSheetsByJudge(roundId)`. At `closesAt` a job tries a non-forced close; if coverage is incomplete, the round stays OPEN and `judgingRound.closeBlocked` is emitted.

### 7.5 State Machines

**FOA `JudgingRound`:**

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| DRAFT → OPEN | CM/SA `openRound`, or job at `opensAt` | Competition FOA_JUDGING. Rubric resolves. Source rounds FINALIZED. Pool not empty. Judges cleared (§12.9). Every entry has ≥ `minJudgesPerEntry` eligible ACCEPTED judges | RoundEntry snapshot. First FOA round: entries FOA_VERIFIED → IN_JUDGING. PENDING sheets. `judgingRound.opened` |
| OPEN → SCORING_CLOSED | CM/SA `closeRound`, or job | All sheets SUBMITTED or VOID, or `force` with a reason | Ranks computed. `insufficientScores` flagged. TieResolutions created. `judgingRound.closed` |
| SCORING_CLOSED → OPEN | CM/SA `reopenRound` | Reason | `judgingRound.reopened` (judges notified) |
| SCORING_CLOSED → LOCKED | CM/SA `lockRound` | No ACTIVE entry with `insufficientScores` (exclude it, or reassign and reopen). All TieResolutions resolved | `resultsHash` frozen. `judgingRound.locked` |
| LOCKED → SCORING_CLOSED | SA `unlockRound` | Reason | Hash cleared. `judgingRound.unlocked` |
| LOCKED → FINALIZED | CM/SA `finalizeRound` | None | Non-final: advanced entries stay IN_JUDGING and feed the next pool; the rest → ELIMINATED. Final: §7.4.4 outcomes and flags, then competition → RESULTS_PENDING_APPROVAL. `judgingRound.finalized` |
| DRAFT, OPEN or SCORING_CLOSED → CANCELLED | SA | Reason. No later round past DRAFT | Sheets VOID. Entries whose only round this was → FOA_VERIFIED |

**SCHOOL `JudgingRound`:**

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| DRAFT → OPEN | System | §7.3 step 1. Rubric resolves | SchoolResult sync. `schoolRound.opened` |
| OPEN → FINALIZED | IA/IC `finalizeSchoolRound`, or CM/SA `closeSchoolRoundOnBehalf` | V1–V7 | §7.3 step 4 |
| FINALIZED → OPEN | CM/SA `reopenSchoolRound` | Reason. The §6.9 `revertSchoolShortlist` guard holds for every category: no entry of this institution × category is FOA_VERIFIED or later | §6 `EntryService.revertSchoolShortlist({ institutionRegistrationId, categoryId })` per category: entries revert to SUBMITTED (ALL), or entries created by §6.9 row 7 are soft-deleted (SHORTLIST_ONLY). SCHOOL_MERIT certificates REVOKED; PARTICIPATION certificates are revoked only for registrations whose rows are all later unticked. `schoolRound.reopened` |

**`EntryStatus` (the transitions §7 owns):**

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| FOA_VERIFIED → IN_JUDGING | System (`openRound`, `syncRoundPool`) | In pool scope. Physical guard passes | RoundEntry created |
| IN_JUDGING → IN_JUDGING | System (non-final `finalizeRound`) | `advanced` | Joins the next round's pool |
| IN_JUDGING → ELIMINATED | System (non-final `finalizeRound`) | Not advanced, or EXCLUDED | Outcome set at the final finalize |
| IN_JUDGING → FINALIZED | System (final `finalizeRound`) | None | `finalOutcome`, `finalAwardLabel` |
| IN_JUDGING → FOA_VERIFIED | System (round CANCELLED) | The entry's only round | RoundEntry removed |
| IN_JUDGING, ELIMINATED or FINALIZED → DISQUALIFIED | CM/SA `disqualifyEntry` (from FINALIZED: SA only) | Reason | RoundEntry DISQUALIFIED. §7.15 E3. `entry.disqualified` |
| IN_JUDGING → WITHDRAWN | §6's service: SA `withdrawEntry`, or the cascade from a Registration becoming WITHDRAWN (including the system acting on `consent.withdrawn` for PARTICIPATION, §12.6) | Per §6 | RoundEntry WITHDRAWN, sheets VOID |
| ELIMINATED or FINALIZED → WITHDRAWN | Same as IN_JUDGING → WITHDRAWN | Per §6 | RoundEntry WITHDRAWN. If results are already published, a §7.15 E3 correction follows (certificates revoked, results corrected) |

### 7.6 Results Approval & Publishing (Phase 10)

```prisma
enum ResultsReleaseStatus { PROPOSED APPROVED REJECTED PUBLISHED SUPERSEDED }
model ResultsRelease {
  id String @id;  competitionId String;  version Int /* 1 = initial, ≥ 2 = correction */;  status ResultsReleaseStatus @default(PROPOSED)
  snapshot Json      // per level/category ordered {entryId, entryCode, rank, finalScore, outcome, awardLabel}; overrides,
                     // tie resolutions, re-scored sheets, COI voids, setMinJudges changes, diff vs previous version
  snapshotHash String;  publishAt DateTime /* embargo end; default = approval time */;  publicNote String?;  correctionReason String?
  proposedByUserId String;  proposedAt DateTime;  approvedByUserId String?;  approvedAt DateTime?;  rejectionReason String?;  publishedAt DateTime?
  @@unique([competitionId, version])
}
```

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| ∅ → PROPOSED | CM/SA `proposeResults` / `proposeCorrection` | Initial: competition RESULTS_PENDING_APPROVAL, all FOA rounds FINALIZED, no entry IN_JUDGING, feedback moderated. An ACTIVE template exists for each needed type. No open PROPOSED/APPROVED release | Snapshot and hash. `results.approvalRequested` (to SAs) |
| PROPOSED → APPROVED | SA `approveResults` (step-up 2FA, §13.1) | **Approver ≠ proposer.** Recomputed hash = `snapshotHash`. `publishAt` ≥ now | Publish job scheduled. `results.approved` |
| PROPOSED or APPROVED → REJECTED | SA `rejectResults`, or the publish job on a stale hash | Reason | `results.rejected` |
| APPROVED → PUBLISHED | Job at `publishAt` (plus a 1-minute sweeper) | Still APPROVED. Hash valid | See below. Previous PUBLISHED → SUPERSEDED |

- **Embargo:** between APPROVED and `publishAt`, only CM and SA can see results. Nothing participant-facing happens: no outcomes shown, no FOA-level certificates, notifications or gallery candidates. The page says "Results will be announced soon".
- **Initial publish effects:**
  1. Competition → RESULTS_PUBLISHED, and outcomes become visible.
  2. Certificates created (§7.7).
  3. PrizeFulfilment rows created for bands that have a `prizeId`, from the linked §6 CompetitionPrize.
  4. GalleryItem CANDIDATE created for each `galleryCandidate` entry if `allowPublicDisplay`.
  5. No milestone call. §9 derives FOA_FINALIST from `results.published` using `finalOutcome`.
  6. `results.published` emitted (§10 fans it out to participants, guardians and schools), and the worker revalidates the cache tag `results:{competitionId}` through the internal route (§2.2).
- **`/competitions/[slug]/results`** (cached with `cacheTag('results:{competitionId}')`, revalidated on publish, correction or consent change):
  - **Layout:** tabs per discipline, then sections per category. Each section lists award bands in order, then special mentions, then finalists alphabetically. Level awards from non-final rounds appear under "{Level} awards".
  - **Name:** when `ConsentService.has(participantId, PUBLIC_DISPLAY, competitionId)` holds, the §12.7 public name (minors: "Aarav S." unless `showFullName`). Otherwise "{entryCode} · Name withheld".
  - **Institution:** shown only with that consent and §12.7 `showSchool`.
  - **Never shown:** city, age or DOB.
  - Every row has a "Report" link (§12.8).
  - **Thumbnail:** only when a PUBLISHED GalleryItem exists, linking to it.
  - **Also:** aggregate counts and, after a correction, "Updated on {date}" with the `publicNote`.
  - School-level results are never public.
- **Corrections:** `proposeCorrection({ mode, changes[], publicNote, reason })` follows the same two-person rule. Finalized rounds are never reopened.
  - **Modes:** `PROMOTE_NEXT` re-applies the final round's bands to its locked ranking without DISQUALIFIED or WITHDRAWN entries. `LEAVE_GAP` leaves the band vacant. `MANUAL` takes per-entry outcome changes, each with a reason.
  - **On publish, for each changed entry:** old certificates → REVOKED ("Results corrected") and new ones are issued. Lost PENDING prizes → CANCELLED; DISPATCHED or DELIVERED ones get `recoveryRequired`. New awards get PENDING prizes. Gallery recognition is updated. `results.corrected` is emitted with `affectedEntryIds`.

### 7.7 Certificates (Module 31)

```prisma
enum CertificateStatus { PENDING GENERATED FAILED REVOKED SUPERSEDED }
model Certificate {
  id String @id;  certificateNumber String @unique /* §3.1, assigned at creation */;  type CertificateType
  status CertificateStatus @default(PENDING);  competitionId String?;  registrationId String?;  participantId String?
  subjectUserId String? /* VOLUNTEER_SERVICE: the volunteer */;  data Json? /* VOLUNTEER_SERVICE: hours, period, skills */
  // CHECK: exactly one of participantId / subjectUserId is set; competitionId and registrationId are required unless type = VOLUNTEER_SERVICE
  entryId String?;  categoryId String? /* null for PARTICIPATION */;  roundId String? /* awarding round */;  institutionId String?;  level JudgingLevel?;  awardLabel String?
  nameSnapshot String /* PDF: fullName (Q9) */;  displayNameSnapshot String /* §12.7 public name: /verify, CERT_SHARE */;  categoryLabel String
  templateId String;  templateVersion Int;  pdfAssetId String? /* FileAsset PDF, private */
  issuedAt DateTime?;  revokedAt DateTime?;  revokedReason String? /* internal */;  supersededById String?
  // partial unique (registrationId, categoryId, type, roundId) NULLS NOT DISTINCT WHERE status IN (PENDING, GENERATED, FAILED)
  //   AND type <> VOLUNTEER_SERVICE; PARTICIPATION (categoryId null) stays one per registration
}
model CertificateTemplate {
  id String @id;  type CertificateType;  competitionId String? /* null = global default */;  name String
  html String;  css String;  version Int;  status String /* DRAFT|ACTIVE|ARCHIVED */
  pageSize String @default("A4");  orientation String @default("LANDSCAPE")
  signatories Json /* [{name, title, signatureAssetId}] ≤ 3 */;  backgroundAssetId String?
}
```

| CertificateType | Trigger | Recipients |
|---|---|---|
| PARTICIPATION | `finalizeSchoolRound` (institution route) | One per Registration with a participated SchoolResult |
| PARTICIPATION | Initial release PUBLISHED (individual route) | Individual registrations whose entry reached SUBMITTED and is not WITHDRAWN, DISQUALIFIED or REJECTED_INELIGIBLE |
| SCHOOL_MERIT | `finalizeSchoolRound` | Positioned rows (`awardLabel` = position label) |
| FINALIST / WINNER / RUNNER_UP / SPECIAL_MENTION | Release PUBLISHED | One per entry by `finalOutcome` (a winning finalist gets WINNER only), plus one per level award won in a non-final round (`level`, band label) |
| VOLUNTEER_SERVICE | §9.8 `issueVolunteerCertificate` | The volunteer (`subjectUserId`), with data (hours, period, skills) |

- **Templates:** the ACTIVE template for `(type, competitionId)` is used, falling back to `(type, null)`.
  - Merge fields: `{{name}}`, `{{displayName}}`, `{{competitionName}}`, `{{competitionYear}}`, `{{categoryLabel}}`, `{{awardLabel}}`, `{{levelLabel}}`, `{{institutionName}}`, `{{issueDate}}` (IST, `d MMM yyyy`), `{{certificateNumber}}`, `{{qrSvg}}`, `{{verifyUrl}}`, `{{foaLogoUrl}}`, `{{#signatories}}`.
  - Rendering is Handlebars with escaping on, no triple-stash and no custom helpers.
  - A template becomes ACTIVE only after a successful preview render.
  - Issued PDFs are immutable: template edits never re-render them, only reissue does.
- **Generation:** job `certificate.generate(id)` skips GENERATED certificates.
  - **Render:** Playwright HTML→PDF in `worker-media`, with Noto fonts (Latin, Devanagari and other Indic scripts) bundled in the image. Every request is blocked except the app's asset origin and `data:` URLs. Timeout 30 s.
  - **QR:** the `qrcode` package encodes `{APP_URL}/verify/{certificateNumber}`.
  - **Store and issue:** the PDF goes to `certificates/{competitionCode}/{certificateNumber}.pdf` (private) as a FileAsset of kind PDF. The certificate → GENERATED and `certificate.issued` is emitted.
  - **Retries:** at 1 min, 10 min and 1 h, then FAILED.
  - **Throughput:** at least 5,000 certificates in 30 minutes on 4 workers.
- **`/verify/[certificateNumber]`:** public, `noindex`, 30 requests per minute per IP. The input is normalized (uppercase; Crockford O→0, I/L→1).
  - **Shows:** the §12.7 public name, competition and year, type and award label, issue date, and **VALID** (GENERATED) or **REVOKED** (REVOKED or SUPERSEDED; superseded adds "Replaced by a reissued certificate").
  - **VOLUNTEER_SERVICE:** shows the display name, "Volunteer service", the period, hours and status. No competition.
  - **Never shows:** DOB, age, city or school, and no full name unless `showFullName` is set. The institution name appears only with PUBLIC_DISPLAY consent and `showSchool`.
  - PENDING, FAILED and unknown numbers return the same 404.
- **Downloads:** `/dashboard/certificates` serves participants and guardians (every linked participant). It offers the PDF (signed URL, 5 min), a "Share image" (CERT_SHARE, private) and the verify link.
  - `/institution/competitions/[code]/certificates` lists every certificate for the institution's registrations. `requestCertificateBundle` builds a ZIP (`{participantCode}_{type}_{certificateNumber}.pdf`) as a private FileAsset of kind OTHER, valid 7 days, and emits `certificateBundle.generated`.
  - FOA-level certificates appear only after results are PUBLISHED. Only staff can download revoked or superseded PDFs.

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| ∅ → PENDING | System (trigger table) | No live certificate for (registrationId, categoryId, type, roundId) | Number assigned (collision retry). Job enqueued |
| PENDING → GENERATED / FAILED | Job | PDF stored / retries exhausted | `certificate.issued` / admin alert |
| FAILED → PENDING | CM/SA `regenerateCertificate` | None | Re-enqueued |
| GENERATED → REVOKED | CM/SA `revokeCertificate`, school reopen, correction, DQ | Reason | `/verify` shows REVOKED. CERT_SHARE deleted. `certificate.revoked` |
| GENERATED → SUPERSEDED | CM/SA `reissueCertificate` | Reason (e.g. name fix) | New certificate with a **new number**. `certificate.revoked` |

### 7.8 Prize Fulfilment

```prisma
enum PrizeFulfilmentStatus { PENDING DISPATCHED DELIVERED CANCELLED }   // PrizeType is §6's, on CompetitionPrize
model PrizeFulfilment {
  id String @id;  competitionId String;  entryId String;  participantId String;  certificateId String?
  competitionPrizeId String /* §6 CompetitionPrize from AwardBand.prizeId: prizeType, description, cash amount */
  deliverTo String          // INSTITUTION (default, institution route) | PARTICIPANT (default, individual) | HAND_OVER
  addressSnapshot Json?     // confirmed on /dashboard/entries/[entryCode] or /institution/.../results; purged 90 days after DELIVERED
  status PrizeFulfilmentStatus @default(PENDING);  courier String?;  trackingNumber String?;  proofAssetId String?
  recoveryRequired Boolean @default(false);  dispatchedAt DateTime?;  deliveredAt DateTime?;  notes String?
}
```

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| ∅ → PENDING | System at release PUBLISHED | Band has a `prizeId` whose CompetitionPrize is not CERTIFICATE_ONLY | `prizeFulfilment.created` (§10 sends the address request) |
| PENDING → DISPATCHED | CM/SA | Address, courier and tracking (all waived for HAND_OVER) | `prize.dispatched`. CASH: `LedgerService.record({ type: 'EXPENSE', category: 'PRIZES_AWARDS', sourceType: 'PRIZE_FULFILMENT', … })` |
| DISPATCHED → DELIVERED | CM/SA | None | `prize.delivered` |
| PENDING → CANCELLED | CM/SA, correction | Reason | None |

### 7.9 Logo Stamping: `StampService` (Module 32)

```prisma
enum StampVariant { GALLERY SOCIAL_SQUARE SOCIAL_PORTRAIT CERT_SHARE }   enum StampPosition { TOP_LEFT TOP_RIGHT BOTTOM_LEFT BOTTOM_RIGHT }
model StampSettings {     // competitionId null = global; a competition row overrides it
  id String @id;  competitionId String? @unique;  logoAssetId String /* PNG with alpha; SVG rasterized on upload */
  position StampPosition @default(BOTTOM_RIGHT);  logoWidthPct Int @default(14) /* 8–25 */;  marginPct Int @default(4)
  opacity Decimal @default(0.9);  codeWatermark Boolean @default(true) /* code in the opposite bottom corner */
  socialBackground String @default("#FFFFFF");  version Int;  updatedByUserId String;  updatedAt DateTime
}
model StampedDerivative {
  id String @id;  sourceAssetId String;  variant StampVariant;  settingsHash String;  outputAssetId String;  thumbAssetId String?
  @@unique([sourceAssetId, variant, settingsHash])
}
```

**Interface** (a compatible extension of §3.5): `StampService.stamp(fileAssetId, { variant: 'GALLERY'|'SOCIAL'|'CERT_SHARE', aspect?: 'SQUARE'|'PORTRAIT' }) → FileAsset (kind STAMPED)`. `aspect` applies to SOCIAL only and defaults to SQUARE.

1. **Idempotency:** `settingsHash = sha256(canonicalJSON(effective settings) + logo.checksumSha256 + variant + STAMP_PIPELINE_VERSION)`. If a StampedDerivative exists for (source, variant, hash), it is returned unchanged. Concurrent calls serialize on `pg_advisory_xact_lock`.
2. **Source:** depends on the content.
   - **Image entry:** the given ORIGINAL or WEB asset (scanStatus CLEAN), read on the server only. §7 passes the ORIGINAL; §8 may pass WEB.
   - **Video:** the §6 poster frame.
   - **Essay:** a Playwright-rendered "essay card" (title plus up to 60 words).
   - **CERT_SHARE:** the certificate's 1080×1350 share layout (display name and QR), rendered by Playwright.
3. **sharp:**
   - Apply EXIF orientation with `.rotate()` and convert to sRGB.
   - Apply the variant geometry.
   - Composite the logo (`logoWidthPct`, alpha × opacity) at `position` inside `marginPct`, then the code as SVG text (font 2.2% of width, 70% opacity, 1 px shadow).
   - Encode as JPEG q85 with mozjpeg. `withMetadata()` is never called, so EXIF, GPS and XMP are dropped.
4. **Geometry:**
   - **GALLERY:** longest edge ≤ 2048 px, no upscaling. A 480 px thumbnail is resized *from the stamped output*, so it carries the logo. It is encoded at q70, stepping down to q50 if needed, to stay ≤ 60 KB (§13.2 budget).
   - **SOCIAL_SQUARE** (1080×1080): the artwork is fitted (`contain`) into a centred 952×952 box on `socialBackground`. Logo and code stay within a 64 px safe margin.
   - **SOCIAL_PORTRAIT** (1080×1350): the artwork fills the top 1080×1150 with 48 px padding. The bottom 200 px is the **caption-safe band**: background only, logo on the left, code on the right, no artwork.
   - **CERT_SHARE** (1080×1350).
5. **Storage:** GALLERY and SOCIAL variants go to the public CDN bucket. CERT_SHARE goes to the private bucket, served by signed URL, because certificates are personal. Keys are `stamped/{variant}/{sourceChecksum[0..16]}-{settingsHash[0..12]}.jpg` and contain no names or codes. The output FileAsset has `kind STAMPED` and the source's owner.

- **Hard rule:** public pages, OG/Twitter meta tags, sitemaps, the results page, images linked from emails and social packs use only `kind = STAMPED`.
  - `toPublicImageUrl(asset)` throws for anything else. Public components accept only its branded `PublicImageUrl` type.
  - ORIGINAL assets are never served publicly. WEB assets are served only by signed URL to authorized viewers.
  - **MVP video exception:** the player streams the §6 WEB transcode with a STAMPED poster and a fixed CSS logo overlay (Q12).
- **Restamping:** `updateStampSettings` bumps `version` and enqueues `stamp.restamp_all`. That job restamps every source used by APPROVED or PUBLISHED GalleryItems and DRAFT or READY SocialExports, swaps each reference atomically, and deletes superseded public objects after 7 days. Posted exports keep their historical assets. Re-running it with unchanged settings does nothing.

### 7.10 Gallery (Phase 11, Module 4)

```prisma
enum GalleryItemStatus { CANDIDATE APPROVED PUBLISHED UNPUBLISHED REJECTED }
enum GalleryRecognition { WINNER RUNNER_UP SPECIAL_MENTION FINALIST SCHOOL_MERIT PARTICIPANT }
model GalleryItem {
  id String @id;  entryId String @unique;  competitionId String;  participantId String;  status GalleryItemStatus @default(CANDIDATE)
  title String;  story String? /* ≤ 500 chars, moderated */;  displayNameSnapshot String /* §12.7 public name, refreshed at each approval */
  categoryLabel String /* "Painting · 9–12 years"; never DOB/age */;  discipline Discipline;  year Int
  institutionNameSnapshot String?;  city String?;  state String?;  country String?
  showInstitution Boolean @default(true);  showCity Boolean @default(true)  // moderator veto; effective = toggle AND §12.7 showSchool / showCity
  isAdult Boolean /* ≥ 18 at publish; gates the sitemap (§13.6) */;  moderationReviewId String? /* §12.8 ModerationReview */
  recognition GalleryRecognition /* finalOutcome ?? (schoolRank ? SCHOOL_MERIT : PARTICIPANT) */;  recognitionLabel String
  imageAssetId String?;  thumbAssetId String?;  ogImageAssetId String? /* STAMPED GALLERY / thumb / SOCIAL_SQUARE */
  essayMode String @default("EXCERPT") /* or FULL */;  essayExcerpt String? /* default first 120 words */;  videoAssetId String?
  featured Boolean @default(false);  featuredRank Int?;  unpublishReason String? /* MODERATOR|CONSENT_WITHDRAWN|DISQUALIFIED|REPORTED|ERASURE */
  searchVector Unsupported("tsvector") /* title, story, displayName, competition name */
  approvedByUserId String?;  approvedAt DateTime?;  publishedAt DateTime?;  unpublishedAt DateTime?
}
```

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| ∅ → CANDIDATE | System at release PUBLISHED (`galleryCandidate`), or CT/CM/SA `addGalleryCandidate` | Competition RESULTS_PUBLISHED. `allowPublicDisplay`. Entry not WITHDRAWN or DISQUALIFIED | Fields snapshotted |
| CANDIDATE → APPROVED | CT/CM/SA | `ConsentService.has(participantId, PUBLIC_DISPLAY, competitionId)`. A §12.8 `ModerationReview` for the item is APPROVED (checklist: consent, faces, PII, age-appropriate, matches entry) | Stamp jobs (GALLERY + SOCIAL_SQUARE) |
| CANDIDATE → REJECTED | CT/CM/SA | Reason | None |
| APPROVED → PUBLISHED | CT/CM/SA (bulk allowed) | Stamped assets ready. Consent re-checked | Listed (sitemap only if `isAdult`). Cache tags revalidated (§2.2). `galleryItem.published` |
| PUBLISHED or APPROVED → UNPUBLISHED | CT/CM/SA (reason), or system: `consent.withdrawn` (PUBLIC_DISPLAY), §12 `consent.reconcile`, DQ, §12.8 auto-hide (REPORTED), §12 erasure | None | Delisted. Detail page returns 410. Consent withdrawal or erasure: public objects deleted and purged from the CDN. `galleryItem.unpublished` |
| UNPUBLISHED → APPROVED | CT/CM/SA | Not ERASURE. Consent present. New APPROVED review if REPORTED | Restamped if the objects were deleted |

- **Consent withdrawal SLA** (§12.6): gone from every public page, the sitemap and the results page within **15 minutes** (high-priority job plus cache-tag revalidation through the internal route, §2.2). The same job deletes the public objects and purges their URLs from the Cloudflare CDN (credentials in §13.9): target 15 minutes, hard limit **24 hours**. Handlers and §12's `consent.reconcile` both call `GalleryService.unpublishForConsent(participantId, competitionId, reason)`.
- **`/gallery`:**
  - **Filters:** `competition`, `discipline`, `age` (category), `year`, `recognition`.
  - **Search:** `q` uses `websearch_to_tsquery('simple', q)` plus `pg_trgm` on `displayNameSnapshot`.
  - **Sort and paging:** featured (`featuredRank`), then recognition, then `publishedAt` desc. 24 per page with a cursor.
  - **Featured:** at most 12 items. `GalleryQuery.featured(limit)` feeds the home page (§9).
- **`/gallery/[entryCode]`:**
  - **Content:** the STAMPED image with a lightbox, title, the §12.7 public name, category, competition link, recognition badge and story. Location is state and country by default; city and institution appear only when both the §12.7 pref and the item toggle allow them. A "Report" link is present (§12.8).
  - **Essays and videos:** essays show the excerpt, or the full sanitized text. Videos play in the player.
  - **Share buttons:** WhatsApp, Facebook, X, copy link and Web Share.
  - **Meta tags:** `og:title` "{title} by {publicName}", `og:image` = `ogImageAssetId` with width and height, `twitter:card=summary_large_image`, and a canonical URL. Hidden fields never appear in meta tags.

### 7.11 Social Media Showcase (`/admin/social`)

```prisma
model SocialExport {
  id String @id;  entryId String;  galleryItemId String?;  certificateId String?;  kind String /* ARTWORK|ESSAY_CARD|CERTIFICATE */
  status String @default("DRAFT") /* DRAFT|READY|CANCELLED */;  squareAssetId String?;  portraitAssetId String?;  certShareAssetId String?
  caption String;  acknowledgementLine String /* cannot be removed */;  createdByUserId String;  readyAt DateTime?
}
model SocialPostRecord {
  id String @id;  socialExportId String;  platform String /* INSTAGRAM|FACEBOOK|X|LINKEDIN|YOUTUBE|WHATSAPP|OTHER */
  source String @default("MANUAL") /* API reserved for post-MVP */;  postedUrl String?;  postedAt DateTime;  postedByUserId String
  status String @default("LIVE") /* LIVE|TAKEDOWN_REQUIRED|TAKEN_DOWN */;  takedownDueAt DateTime?;  takenDownAt DateTime?;  note String?
}
```

- **Tabs:** Candidates (PUBLISHED gallery items and awarded entries with SOCIAL_MEDIA consent and no export yet), Drafts, Ready, Posted (the post log), Takedowns.
- **`createSocialExport`:**
  - **Requirements:** RESULTS_PUBLISHED, `allowPublicDisplay`, entry not WITHDRAWN or DISQUALIFIED, and `ConsentService.require` for both PUBLIC_DISPLAY and SOCIAL_MEDIA (§12.4).
  - **Stamping:** SOCIAL_SQUARE and SOCIAL_PORTRAIT, or CERT_SHARE for a certificate export.
  - **Caption draft:** `"{title}" by {publicName} ({categoryLabel}): {recognitionLabel}, {competitionName}.\n{story excerpt}\n{acknowledgementLine}\n#FriendsOfAnimals`. `publicName` follows §12.7.
  - **Acknowledgement line:** "Artwork by {publicName}. Thank you, {publicName}, for sharing your compassion for animals with FOA."
  - **Location:** institution and city appear only when both §12.7 and the item toggles allow them.
- **`markSocialExportReady`** requires an APPROVED §12.8 `ModerationReview` of the export, the acknowledgement line verbatim, and a caption of at most 2,200 characters. "Download pack" gives a signed-URL ZIP of the images plus `caption.txt`.
- **`recordSocialPost`** creates one record per platform after manual posting, re-checking consent first (blocked if consent was withdrawn). It emits `socialFeature.published` so §10 can tell the participant and give the withdraw link.
- **Takedowns:** on `consent.withdrawn` (SOCIAL_MEDIA, including §12's cascade from PUBLIC_DISPLAY), DQ or erasure:
  - DRAFT and READY exports → CANCELLED immediately.
  - LIVE records → TAKEDOWN_REQUIRED, with `takedownDueAt = now + 72 h` (§12.6), emitting `socialPost.takedownRequired` to CT.
  - Records still pending at the due time emit `socialPost.takedownOverdue` to SA.
  - TAKEN_DOWN requires a note. Third-party reshares cannot be recalled; §12 informs the guardian.

### 7.12 Pages

| Route | Roles | Purpose |
|---|---|---|
| `/competitions/[slug]/results`, `/gallery`, `/gallery/[entryCode]`, `/verify/[certificateNumber]` | Public | §7.6, §7.10, §7.7 |
| `/judge`, `/judge/invitations/[assignmentId]` | J | Invitations, assigned rounds, deadlines, own progress; accept with code of conduct and COI |
| `/judge/rounds/[roundId]` (+ `/framework`), `…/entries/[entryCode]` | J | Queue (category/status filters), rubric and guidance; blind scoring (§7.4.3) |
| `/institution/competitions/[code]/judging` | IA/IC | Framework and PDF, panel, results grid, certify and finalize, deadline status |
| `/institution/competitions/[code]/certificates`, `…/results` | IA/IC | Certificate list, downloads, bulk ZIP; school results; own students' FOA outcomes after publish; prize address |
| `/dashboard/certificates`, `/dashboard/entries/[entryCode]` | P/G | Certificates, share image, verify link; status, outcome, approved feedback, prize address |
| `/admin/competitions/[id]/judging` (+ `/rubrics/[rubricId]`, `/schools`) | CM/SA | Pipeline overview; rubric editor with PDF preview; per-school board (status, overdue, extend, reopen, close on behalf) |
| `…/judging/rounds/[roundId]` | CM/SA (unlock: SA) | Tabs: Config · Pool (incl. Blocked) · Judges · Progress · Results & Ties · Feedback; printable physical sheets |
| `…/judging/results` | CM/SA (approve: SA) | Releases: propose, approve/reject, schedule, corrections, diff |
| `/admin/certificates` (+ `/templates/[id]`, `/prizes`) | CM/SA | Search by number, name or competition; regenerate, revoke, reissue; template editor with live preview; prize board |
| `/admin/gallery` (+ `/[itemId]`), `/admin/social` (+ `/[exportId]`, `/stamping`) | CT/CM/SA (stamping: SA, CT) | Moderation tabs, editor, featured order; export queue, post log, takedowns; logo settings with live preview |

### 7.13 Server Actions

| Action | Input | Authorization | Effect |
|---|---|---|---|
| `upsertRubric` / `publishRubric` | competitionId, discipline?, title, guidanceHtml, criteria[] / rubricId | CM/SA | Save DRAFT (new version if one is PUBLISHED) / publish, archive the previous, PDF job, `rubric.published` |
| `setSchoolJudgingPolicy` | competitionId, fields | CM/SA | Upsert. No changes once any school round is FINALIZED (the deadline is §6's `shortlistSubmissionClosesAt`) |
| `saveSchoolPanel` / `saveSchoolResults` | roundId, members[] / rows[] | IA/IC, round OPEN | Replace the panel / upsert drafts with per-row errors |
| `finalizeSchoolRound` | roundId, certify: true, shortfallReason? | IA/IC | §7.3 |
| `reopenSchoolRound` / `extendSchoolDeadline` / `closeSchoolRoundOnBehalf` | roundId, reason / until / mode, rows?, evidenceAssetId, reason | CM/SA | §7.5 / §6 `SubmissionExtension(SHORTLIST)` for the InstitutionRegistration / §7.15 E5 |
| `createRound` / `updateRound` | competitionId, config | CM/SA, DRAFT only | Validates level order, partitions, bands, single `isFinal` |
| `inviteJudges` / `respondToInvite` | roundId, [{userId \| email, categoryIds, partitionKeys?}] / assignmentId, accept, COI, agreements | CM/SA / J (self) | INVITED (`judgeAssignment.created`) / ACCEPTED or DECLINED (clearance checked) |
| `openRound` / `syncRoundPool` / `closeRound` / `reopenRound` | roundId, force?, reason? | CM/SA, job | §7.5. Sync adds newly eligible entries while OPEN |
| `excludeRoundEntry` / `setBlindTitle` / `setMinJudges` | roundEntryId, reason / blindTitle / roundId, value ≥ 1, reason | CM/SA | EXCLUDED (counts as not advanced) / redaction / lower coverage requirement (audited, shown at approval) |
| `saveScoreSheet` / `submitScoreSheet` | sheetId, scores[], comments, recommend flags | J (own), OPEN | Draft or submit. Edits after submit are revisioned |
| `declareConflict` | sheetId, reason | J (own), OPEN | Sheet VOID (COI). Replacement auto-assigned if coverage drops below the minimum |
| `enterScoresOnBehalf` | sheetId, scores[], scanAssetId | CM/SA, PHYSICAL | Same as submit, setting `enteredByUserId` |
| `removeJudge` / `reassignSheets` | assignmentId, reason / roundId, roundEntryIds[], judgeUserId | CM/SA | §7.15 E1 / new COI-checked PENDING sheets |
| `resolveTie` / `overrideRoundEntry` | tieResolutionId, resolution, order?, reason / roundEntryId, fields, reason | CM/SA, SCORING_CLOSED | Recompute / recorded override |
| `lockRound` / `unlockRound` / `finalizeRound` | roundId, reason (unlock) | CM/SA; unlock SA only | §7.5 |
| `moderateFeedback` / `setCandidateFlags` | sheetId, APPROVE \| SUPPRESS, text? / entryId, flags | CM/SA | §7.4.2 / §7.4.4 |
| `disqualifyEntry` | entryId, reason, evidenceAssetId? | CM/SA; from FINALIZED, SA only | §7.15 E3 |
| `proposeResults` / `proposeCorrection` | competitionId, publishAt? / mode, changes[], publicNote, reason | CM/SA | New PROPOSED release |
| `approveResults` / `rejectResults` / `reschedulePublish` | releaseId, reason? / publishAt | SA, not the proposer | §7.6 |
| `upsertCertificateTemplate` / `activateCertificateTemplate` | fields / templateId | CM/SA | ACTIVE requires a successful preview |
| `regenerateCertificate` / `revokeCertificate` / `reissueCertificate` | certificateId, reason? | CM/SA | §7.7 |
| `getCertificateDownloadUrl` / `createCertificateShareImage` | certificateId | Owner P/G, IA/IC (own), CM/SA / owner P/G | 5-minute signed URL (GENERATED only, unless staff) / CERT_SHARE (private) |
| `requestCertificateBundle` | competitionId | IA/IC | ZIP job |
| `confirmPrizeAddress` / `markPrizeDispatched` / `markPrizeDelivered` / `cancelPrize` | prizeId, address / courier, tracking / proof? / reason | P/G or IA/IC (own) / CM/SA | §7.8 |
| `addGalleryCandidate` / `approveGalleryItem` / `rejectGalleryItem` / `publishGalleryItem` / `unpublishGalleryItem` / `setFeatured` | entryId / itemId(s), edits, reason, featured, rank | CT/CM/SA | §7.10 (at most 12 featured) |
| `createSocialExport` / `updateSocialExport` / `markSocialExportReady` / `cancelSocialExport` / `recordSocialPost` / `markTakenDown` | entryId \| certificateId / exportId, caption / platform, postedUrl, postedAt / postRecordId, note | CT/CM/SA | §7.11 |
| `updateStampSettings` | settings, competitionId? | SA, CT | `version`++, restamp job, `stampSettings.updated` |

### 7.14 Domain Events (for §10, §11)

| Event | Emitted when | Payload |
|---|---|---|
| `rubric.published` | Rubric published | competitionId, rubricId, discipline |
| `schoolRound.opened` / `.overdue` / `.reopened` | Open / `shortlistSubmissionClosesAt` (or extension) passed, round OVERDUE (§7.15 E5) / §7.5 | roundId, institutionRegistrationId, deadline |
| `schoolShortlist.finalized` | School round FINALIZED (incl. on behalf) | §7.3 step 4 payload |
| `judgeAssignment.created` | Invitation | assignmentId, roundId, categoryCount, closesAt (no participant PII) |
| `judgingRound.opened` / `.closed` / `.closeBlocked` / `.reopened` / `.locked` / `.unlocked` / `.finalized` | §7.5 | roundId, level, competitionId |
| `scoreSheet.revised`, `entry.disqualified` | Post-submit edit; DQ | sheetId, version; entryId, competitionId |
| `results.approvalRequested` / `.approved` / `.rejected` / `.published` / `.corrected` | §7.6 | competitionId, releaseId, version, affectedEntryIds (correction only) |
| `certificate.issued` / `.revoked`, `certificateBundle.generated` | §7.7 | certificateId, type, participantId or subjectUserId, registrationId?; institutionId, fileAssetId |
| `prizeFulfilment.created` | PrizeFulfilment created (§7.8) | prizeId, entryId, participantId, deliverTo |
| `prize.dispatched` / `prize.delivered` | §7.8 | prizeId, participantId, trackingNumber? |
| `galleryItem.published` / `.unpublished` | §7.10 | itemId, entryId, visibleFields[], reason? |
| `socialFeature.published` | `recordSocialPost` | postRecordId, participantId, platform, postedUrl |
| `socialPost.takedownRequired` / `.takedownOverdue`, `stampSettings.updated` | §7.11; §7.9 | postRecordId, platform, takedownDueAt; version |

Reminders are scheduled by §10, not emitted here: `reminder.schoolJudgingDeadline` from §6 `shortlistSubmissionClosesAt` or the school's `SubmissionExtension(SHORTLIST)`, and `reminder.judgingDue` from `closesAt`.

### 7.15 Edge Cases

- **E1. A judge drops out mid-round.** `removeJudge` sets the assignment to REMOVED.
  - If the judge had submitted every sheet, those sheets are kept. Otherwise **all** of the judge's sheets in the round → VOID (`JUDGE_REMOVED`), so every entry in a category keeps the same judge set.
  - Entries that fall below the minimum are listed. The CM invites a replacement or uses `reassignSheets` (under ALL, the replacement gets the whole category), or lowers the minimum with `setMinJudges`.
- **E2. Tie at a cutoff:** handled by §7.4.4. LOCK is blocked until it is resolved. SHARE expands the cutoff and enlarges the next round's pool.
- **E3. Entry disqualified after results are published.**
  - The entry → DISQUALIFIED, and all of its certificates → REVOKED immediately.
  - Its GalleryItem → UNPUBLISHED, and LIVE social posts → TAKEDOWN_REQUIRED.
  - A PROMOTE_NEXT correction is drafted. It takes effect, with new certificates, only after a second person approves it.
  - Prizes: PENDING → CANCELLED. Dispatched prizes get `recoveryRequired`.
- **E4. Consent withdrawn after a social post:** handled by §7.11 (72-hour takedown, then escalation). Withdrawing SOCIAL_MEDIA alone leaves the gallery untouched. Withdrawing PUBLIC_DISPLAY cascades to both (§12.6).
- **E5. A school never finalizes.**
  - §10 reminders go out at −7 d, −2 d and −1 d. At §6 `shortlistSubmissionClosesAt` (or the school's later `SubmissionExtension(SHORTLIST)`), a round that is not FINALIZED becomes OVERDUE: it stays OPEN, shows as overdue on the per-school board, and `schoolRound.overdue` goes to IA, IC and CM. There is **no automatic finalise and no automatic forfeit**.
  - The school can still finalize while the round is OVERDUE. Otherwise the CM uses `closeSchoolRoundOnBehalf` in one of two modes:
    - **`PARTICIPATION_ONLY`:** every confirmed registration with a SUBMITTED entry (ALL), or every confirmed registration (SHORTLIST_ONLY), is marked participated. Entries → NOT_SHORTLISTED, and PARTICIPATION certificates are issued.
    - **`STAFF_ENTERED`:** staff enter results from evidence the school sends, with the same effects as finalizing. The evidence upload is required.
  - FOA rounds open only in FOA_JUDGING, which §6 allows only once every school round is FINALIZED, so no entry reaches SUBMITTED_TO_FOA during FOA_JUDGING.
- **E6. Entry withdrawn during or after judging (§7.5):** its RoundEntry → WITHDRAWN and, while it is IN_JUDGING, its sheets → VOID. If results are already published, a correction follows as in E3.
- **E7. Artwork damaged or a DISCREPANCY found after the round opens:** the CM may `excludeRoundEntry` with a reason. The entry ends ELIMINATED / PARTICIPANT.
- **E8. Data changes between approval and `publishAt`:** a stale hash makes the job REJECT the release (`STALE`), and the CM re-proposes. Consent is applied at render time, so consent changes never make a release stale.
- **E9. Wrong name on a certificate:** after §6 fixes the profile, `reissueCertificate` issues a new number, and the old one verifies as REVOKED ("Replaced by a reissued certificate").
- **E10. Logo changes after publishing:** handled by `stamp.restamp_all`. Old public objects remain for 7 days, so shared links keep working until OG images refresh.

### 7.16 Acceptance Criteria

1. Weights 30/25/25/20 (max 10) with scores 8/6/7/10 give `weightedTotal = 76.50`. A total sent by the client is ignored.
2. Editing a rubric used by an OPEN round fails. Publishing v2 leaves RoundEntries pinned to v1.
3. `finalizeSchoolRound` rejects duplicate positions, more than N advanced, a positioned row that isn't advanced (when P ≤ N), and a missing certification. A valid grid under ALL leaves entries SCHOOL_SHORTLISTED or NOT_SHORTLISTED with `schoolRank` and `schoolAwardLabel` set.
4. SHORTLIST_ONLY: 40 participated registrations, 0 entries, 3 positions and 5 advanced give 40 PARTICIPATION and 3 SCHOOL_MERIT certificates and one `schoolShortlist.finalized` with 5 shortlisted and 35 not-shortlisted IDs, with 0 entry transitions.
5. Snapshot tests show judge-route responses contain no `fullName`, `displayName`, `dateOfBirth`, institution, city, `registrationNumber` or `participantCode`.
6. A judge with a COI on institution X gets no sheet for X's entries. `openRound` fails, naming entries, if that leaves an entry under the minimum.
7. With `requiresPhysicalVerified`, an entry whose artwork is DISPATCHED stays FOA_VERIFIED and is listed as Blocked. Entries in the pool move to IN_JUDGING.
8. Sheets of 70, 80 and 90 give `meanScore 80.00`. Under Z_SCORE, a judge with fewer than 5 sheets contributes raw totals.
9. Two entries still tied at the cutoff after the chain block `lockRound`. Resolving with SHARE advances both.
10. Editing a SUBMITTED sheet while OPEN writes a `ScoreSheetRevision`. Any edit after SCORING_CLOSED fails.
11. Finalizing the final round sets `finalOutcome` for every entry that entered FOA judging, per §7.4.4, and moves the competition to RESULTS_PENDING_APPROVAL.
12. `approveResults` fails for the proposer and for a CM. It succeeds for a different SA.
13. Before `publishAt`: no outcome on any participant or public page, no FINALIST-or-higher certificate rows, no `results.published`. All of them exist within 1 minute after.
14. The results page shows the §12.7 public name only with PUBLIC_DISPLAY consent (a minor without `showFullName` appears as "Aarav S."; with no consent, "{entryCode} · Name withheld"). It never shows city, age or DOB.
15. Every certificate number matches `^FOA-C-\d{2}-[0-9A-HJKMNP-TV-Z]{10}$` and is unique. The QR decodes to `{APP_URL}/verify/{number}`.
16. `/verify` shows REVOKED for revoked and superseded certificates. Unknown, PENDING and FAILED numbers give identical 404s. A minor's page without consent shows no school, city or DOB.
17. Reissue gives a new number and marks the old one SUPERSEDED. The school's bulk ZIP holds exactly the GENERATED certificates for its registrations.
18. Repeating `stamp()` with the same settings returns the same FileAsset. A logo change yields a new hash, and the restamp job updates every PUBLISHED item. Outputs carry no EXIF/GPS, and a pixel test finds the logo in the configured corner.
19. A crawl of public routes finds every `<img>` and `og:image` is a STAMPED public asset. `toPublicImageUrl` throws for ORIGINAL and WEB.
20. Gallery approval fails without PUBLIC_DISPLAY consent, without an APPROVED ModerationReview, or with `allowPublicDisplay = false`. After a withdrawal, the detail page returns 410 within 15 minutes and the objects are deleted within 24 hours (target 15 minutes). A minor's item never appears in `sitemap.xml`.
21. Gallery filters, and search by title or display name, return the right items. An item toggle set to false, or a §12.7 pref left off, hides institution or city on the page and in meta tags.
22. `createSocialExport` fails without SOCIAL_MEDIA or PUBLIC_DISPLAY consent, and `markSocialExportReady` fails if the acknowledgement line is removed. Withdrawing consent after posting sets LIVE records to TAKEDOWN_REQUIRED, due in 72 hours.
23. DQ after publishing: certificates are revoked at once. A PROMOTE_NEXT correction, approved by a second person, moves 2nd to 1st with new certificates and cancels the DQ'd entry's PENDING prize.
24. Unit tests cover every allowed and disallowed transition of the FOA round, the school round, §7's EntryStatus transitions, ResultsRelease, Certificate, PrizeFulfilment, GalleryItem and SocialPostRecord.

### 7.17 Open Questions (this section)

| # | Question the source leaves open | Default applied |
|---|---|---|
| Q1 | A/B grades vs gold/silver/bronze vs 1/2/3 | Configurable per round. Default: RANKED "All India 1st/2nd/3rd" in the final round (1st = WINNER, 2nd–3rd = RUNNER_UP) |
| Q2 | Are school-level rubric scores mandatory? | No. Positions and shortlist only |
| Q3 | Top 3 or top 5 school positions; prescribed N | 3 positions; N = 5 per category per school |
| Q4 | Which FOA levels are active | One round: NATIONAL, final, PHYSICAL. CITY/STATE/GLOBAL added as needed |
| Q5 | "Individuals judged on the physical copy" | `requiresPhysicalVerified = true` on every FOA round. Individuals go straight into the first FOA round (no school round, no school merit) |
| Q6 | Judges per entry, distribution, normalization | 3 judges; each panel judge scores the whole category (ALL); no normalization |
| Q7 | Tie-break rules | Criterion means by weight → median → manual. Share at the cutoff; order at award edges |
| Q8 | Who gives "final approval" | CM or SA proposes; a *different* SA approves |
| Q9 | Name printed on certificates | Full name on the private PDF; display name on `/verify`, share images and public pages |
| Q10 | Who counts as a "finalist"; intermediate-level awards | Every entry that reaches the final round. Non-final award bands off by default |
| Q11 | Do judges' comments reach participants? | Off by default. When on, moderated and anonymized |
| Q12 | Watermarking video | MVP: STAMPED poster plus a player logo overlay. Burned-in ffmpeg watermark after MVP |
| Q13 | Are eliminations disclosed before results? | No. Participants see "In FOA judging" until PUBLISHED |
| Q14 | Takedown SLAs | Taken from §12.6: pages 15 minutes; CDN target 15 minutes, limit 24 hours; social (manual) 72 hours |
| Q15 | A school that misses its deadline | No automatic forfeit. FOA closes it on the school's behalf (participation only, or staff-entered) |
| Q16 | Gallery "city/country where appropriate" | §12.7 defaults (state and country; city and school only by opt-in). The moderator's item toggles can hide them further |
| Q17 | Certificates for ineligible, withdrawn or absent students | Not issued |

## 8. Payments, Donations, Auctions & Financial Transparency

> **Owns:** `PaymentService`, `LedgerService`, `PaymentProvider`, `DonationQuery`, the enums `PaymentPurpose` and `PaymentStatus` (verbatim from §3.5), and every enum declared here. Sets `PhysicalArtworkStatus` `LISTED_FOR_AUCTION` / `SOLD`, and reverts `LISTED_FOR_AUCTION` or `SOLD` → `statusBeforeListing`, only through §6's artwork transition service (`setAuctionState`). **Milestones:** §8.1–8.4 and §8.6–8.7 are MVP. §8.5 (auctions) is post-MVP (M6–M8); its tables ship in the MVP schema.

### 8.1 Configuration (`MoneyConfig`)

Values live in the platform settings store. FINANCE edits `org.*`, `payment.*`, `donation.*` and `transparency.*`; AUCTION_MANAGER edits `auction.*`; SUPER_ADMIN can edit any key. Every change writes `AuditLog`. Amounts are in minor units (paise). Defaults marked *placeholder* are UI starting values, not FOA facts.

| Key | Default | Meaning |
|---|---|---|
| `org.legalName`, `org.address`, `org.pan`, `org.registrations[]` | none (required before go-live) | Printed on receipts. `registrations` = `{ label, number, validFrom?, validTo? }[]` (12A, 80G, CSR-1…) |
| `org.has80G` | `false` | Enables tax-receipt capture and the receipt's tax section (§8.4.4) |
| `org.fcraEnabled` | `false` | `false` = INR only, domestic methods only, foreign payments auto-refunded (§8.4.6) |
| `org.baseCurrency` | `INR` | Ledger and transparency currency |
| `payment.orderTtlMinutes` / `payment.refundDualApprovalAboveMinor` | `30` / `1000000` *placeholder* | Checkout validity in the UI (abandoned orders swept after 24h) / refunds above this need a second approver |
| `donation.suggestedAmountsMinor` | `[50000, 100000, 250000, 500000]` *placeholder* | Chips on `/donate` |
| `donation.minAmountMinor` / `donation.maxOnlineAmountMinor` | `10000` / `100000000` *placeholder* | Above the max, the form points to bank transfer |
| `donation.defaultFrequency` / `donation.recurringMaxAmountMinor` | `ONE_TIME` / `1500000` (₹15,000) | Preselected on `/donate` / RBI limit for e-mandate debits without extra authentication |
| `donation.recurringTotalCount` / `donation.maxPauseCycles` / `donation.haltedAutoCancelDays` | `120` / `3` / `30` | |
| `donation.cashMaxMinor` / `donation.cash80GMaxMinor` | `19999900` / `200000` | Cash must be under ₹2,00,000 (Income-tax Act s.269ST). Cash above ₹2,000 never gets 80G text |
| `transparency.showOrgDonorAmounts` / `transparency.showBudgets` | `true` / `false` | |
| `auction.paymentWindowHours` / `auction.secondChanceWindowHours` / `auction.maxSecondChanceOffers` | `72` / `48` / `2` | |
| `auction.antiSnipeWindowSec` / `auction.antiSnipeExtendSec` / `auction.antiSnipeMaxTotalMin` | `120` / `120` / `60` | |
| `auction.incrementTable` | `[{upTo:100000,inc:10000},{upTo:500000,inc:25000},{upTo:2000000,inc:50000},{upTo:null,inc:100000}]` | Increment band chosen by the current price |
| `auction.proxyBiddingEnabled` / `auction.minLotDurationHours` | `true` / `24` | |
| `auction.shippingCountries` / `auction.shippingFeeMode` | `["IN"]` / `INCLUDED` | `INCLUDED`: FOA absorbs shipping. `FLAT`: adds `auction.flatShippingMinor` |
| `auction.autoDeliverAfterDays` / `auction.nonPaymentStrikesToSuspend` | `14` / `2` | |
| `auction.minorCreditCap` / `auction.logisticsPartners` | `FIRST_NAME_INITIAL` / `[]` | Most identifying credit allowed for creators under 18 / partners offered at shipping |

### 8.2 Payments Core

#### 8.2.1 Data model

```prisma
enum PaymentPurpose { REGISTRATION_FEE, DONATION, AUCTION }                                  // §3.5 verbatim
enum PaymentStatus  { CREATED, AUTHORIZED, CAPTURED, FAILED, REFUNDED, PARTIALLY_REFUNDED }   // §3.5 verbatim
enum PaymentChannel { RAZORPAY, OFFLINE }   enum OfflineMethod { CHEQUE, DD, BANK_TRANSFER, UPI_DIRECT, CASH }
enum RefundStatus { REQUESTED, PENDING, PROCESSED, FAILED, REJECTED }   enum WebhookEventStatus { RECEIVED, PROCESSED, IGNORED, FAILED }
enum RefundReason { PAYER_REQUEST, DUPLICATE, WITHDRAWAL, EVENT_CANCELLED, LOT_CANCELLED, LATE_CAPTURE, FOREIGN_PAYMENT_BLOCKED, AMOUNT_MISMATCH, OTHER }

model Payment { id String @id; purpose PaymentPurpose; status PaymentStatus @default(CREATED); channel PaymentChannel
  amountMinor Int; currency String; refundedMinor Int @default(0); feeMinor Int?; taxOnFeeMinor Int?
  payerUserId String? /* null only for guest DONATION / OFFLINE */; payerName String?; payerEmail String?; payerPhone String?
  refType String /* 'RegistrationPaymentBatch'|'Donation'|'AuctionLot' */; refId String; notes Json? /* competitionId, fundId, offerRank */
  providerOrderId String? @unique; providerPaymentId String? @unique; providerSubscriptionId String?
  method String?; isInternational Boolean @default(false); failureCode String?; failureReason String?
  offlineMethod OfflineMethod?; offlineReference String?; proofFileAssetId String?; recordedByUserId String?
  guestAccessTokenHash String? /* SHA-256, 7-day TTL */; expiresAt DateTime?; authorizedAt DateTime?; capturedAt DateTime?; failedAt DateTime?
  providerSettlementId String?; settledAt DateTime?; reconciledAt DateTime?; createdAt DateTime; updatedAt DateTime
  @@index([refType, refId]) @@index([status, createdAt]) }   // partial unique: one Payment in (CREATED, AUTHORIZED) per (refType, refId)
model Refund { id String @id; paymentId String; amountMinor Int; currency String; reason RefundReason; reasonText String?
  status RefundStatus @default(REQUESTED); lineRefs Json? /* [{refType, refId}] */; isSystem Boolean @default(false)
  requestedByUserId String?; approvedByUserId String?; providerRefundId String? @unique
  createdAt DateTime; processedAt DateTime?; failureReason String? }
model WebhookEvent { id String @id; provider String; providerEventId String; eventType String; payload Json
  status WebhookEventStatus @default(RECEIVED); attempts Int @default(0); lastError String?; receivedAt DateTime; processedAt DateTime?
  @@unique([provider, providerEventId]) }   // payload redacted to ids + status after 180 days
model ProviderPlan { id String @id; provider String; amountMinor Int; currency String; interval String; providerPlanId String @unique
  @@unique([provider, amountMinor, currency, interval]) }           // created lazily per recurring amount
model ReconciliationRun { id String @id; provider String; forDate DateTime @db.Date; status String /* RUNNING|OK|ISSUES|FAILED */
  itemsMatched Int; issuesFound Int; startedAt DateTime; finishedAt DateTime? }
model ReconciliationIssue { id String @id; runId String?; kind String /* MISSING_IN_DB|NOT_CAPTURED_IN_DB|AMOUNT_MISMATCH|MISSING_AT_PROVIDER|DISPUTE */
  severity String /* INFO|WARN|CRITICAL */; paymentId String?; providerRef String; detail Json
  status String @default("OPEN") /* OPEN|RESOLVED|IGNORED */; resolvedByUserId String?; resolutionNote String? }
```

#### 8.2.2 `PaymentService` and `PaymentProvider`

```ts
PaymentService.createOrder({ purpose, amountMinor, currency, payerUserId /* null: guest donation */, refType, refId, notes?, payer? })
  => { paymentId, checkout: CheckoutParams, expiresAt }   // reuses the open Payment for the ref if amount+currency match,
                                                           // else marks it FAILED(SUPERSEDED) and creates a new one
PaymentService.requestRefund({ paymentId, amountMinor, reason, reasonText?, lineRefs?, system?: boolean }) => Refund
PaymentService.recordOfflinePayment({ purpose, refType, refId, amountMinor, method, reference, receivedAt, proofFileAssetId }) => Payment
PaymentService.getStatus(paymentId) => { status, capturedAt? }

interface PaymentProvider {   // RazorpayProvider (prod) and FakePaymentProvider (tests/local, deterministic signatures) MUST exist
  createOrder(i: { amountMinor; currency; receipt /* Payment.id */; notes: Record<string,string> }): Promise<{ providerOrderId }>;
  verifySignature(i: { kind: 'ORDER'; orderId; paymentId; signature } | { kind: 'SUBSCRIPTION'; subscriptionId; paymentId; signature }): boolean;
  verifyWebhook(rawBody: string, headers: Headers): { valid: boolean; eventId: string | null };
  parseWebhook(rawBody: string): NormalizedEvent;            // { type, paymentId?, orderId?, refundId?, subscriptionId?, entity }
  fetchPayment(providerPaymentId): Promise<ProviderPayment>;  // { id, orderId, status, amountMinor, currency, method, international, amountRefundedMinor, subscriptionId?, error? }
  fetchOrderPayments(providerOrderId): Promise<ProviderPayment[]>;
  refund(i: { providerPaymentId; amountMinor; refundId; notes }): Promise<{ providerRefundId; status: 'PENDING'|'PROCESSED'|'FAILED' }>;
  createSubscription(i: { amountMinor; currency; interval: 'MONTHLY'; totalCount; notes }): Promise<{ providerSubscriptionId; providerPlanId }>;
  cancelSubscription(id): Promise<void> /* immediate */; pauseSubscription(id): Promise<void>; resumeSubscription(id): Promise<void>;
  fetchSubscription(id): Promise<ProviderSubscription>;
  fetchSettlementItems(dateIst): Promise<SettlementItem[]>;  // { type: payment|refund|adjustment, entityId, amountMinor, feeMinor, taxMinor, settlementId, settledAt }
}
```

Only domain services call `createOrder`. The amount always comes from server data: §6's fee config, the validated donation choice, or the lot's hammer price.

#### 8.2.3 Razorpay implementation

- **Orders:** `POST /v1/orders` with `amount` (paise), `currency`, `receipt = Payment.id`, `notes = { paymentId, purpose, refType, refId }` (max 15 keys, 256 chars each). The account MUST use automatic capture, so AUTHORIZED is transient; Razorpay auto-refunds authorizations that are never captured.
- **Checkout:** the server returns `{ key: RAZORPAY_KEY_ID, order_id | subscription_id, amount, currency, name, description, prefill, notes }`, and the client opens Checkout.js. With `org.fcraEnabled=false`, international methods are hidden in Checkout and international cards stay disabled on the account.
- **Return:** the Checkout `handler` posts `razorpay_payment_id`, `razorpay_order_id` (or `razorpay_subscription_id`) and `razorpay_signature` to `confirmCheckoutReturn`. The expected signature is the hex `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)` (subscriptions: `payment_id + "|" + subscription_id`), compared with `crypto.timingSafeEqual`. A valid signature doesn't capture anything by itself; the service then calls `fetchPayment` and applies the provider's status and amount.
- **Webhooks** (`src/app/api/webhooks/razorpay/route.ts`) are the source of truth. Read the raw body (`await req.text()`) before parsing, verify `X-Razorpay-Signature` = `HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)`, and use the `X-Razorpay-Event-Id` header as the idempotency key. Subscribed events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`, `subscription.authenticated|activated|charged|pending|halted|paused|resumed|cancelled|completed`, `payment.dispute.created`. Razorpay retries failed deliveries for about 24h.
- **Pipeline:** (1) invalid signature → 400, WARN log, nothing stored; (2) `INSERT … ON CONFLICT (provider, providerEventId) DO NOTHING`, and an existing PROCESSED/IGNORED row → 200; (3) enqueue `payments.processWebhook(id)` and return 200 within 2s; (4) the job runs one transaction with `SELECT … FOR UPDATE` on the Payment (transition, Outbox rows, event status). Unknown types → IGNORED. Five retries with backoff, then FAILED (replayable in `/admin/payments`).
- **Ordering:** handlers never assume event order. If an event finds an earlier state than expected (e.g. `refund.processed` before `payment.captured`), the handler calls `fetchPayment` and applies the missing transitions first.
- **Attempts:** one order can carry several payment attempts. `payment.failed` sets FAILED only if no attempt is captured, and a later `payment.captured` moves FAILED → CAPTURED. Subscription charges are keyed by `providerPaymentId`: whichever of `payment.captured` and `subscription.charged` arrives first creates the Payment, and the other is a no-op.

#### 8.2.4 Payment state machine

| From → To | Trigger | Guard | Side effects |
|---|---|---|---|
| ∅ → CREATED | `PaymentService.createOrder` | amount > 0, server-computed. Currency allowed by config | Provider order created. AuditLog |
| CREATED/FAILED → AUTHORIZED | `payment.authorized` | | `authorizedAt` |
| CREATED/AUTHORIZED/FAILED → CAPTURED | `payment.captured`, `order.paid`, `confirmCheckoutReturn` or reconciliation, each after `fetchPayment` | Provider amount and currency equal the Payment's. Otherwise a CRITICAL `AMOUNT_MISMATCH` issue and stop | `capturedAt`. The purpose handler (§8.3–8.5) and `LedgerService.record` run in the same transaction. Outbox `payment.captured` |
| CREATED/AUTHORIZED → FAILED | `payment.failed` (no captured attempt), sweeper (`ABANDONED`), newer order (`SUPERSEDED`) | | Outbox `payment.failed` |
| CAPTURED/PARTIALLY_REFUNDED → PARTIALLY_REFUNDED | `refund.processed` | Σ processed < amount | `refundedMinor` updated. Ledger reversal. Outbox `payment.refunded` |
| CAPTURED/PARTIALLY_REFUNDED → REFUNDED | `refund.processed` | Σ processed = amount | Same, with `fully: true` |

**Stale or late captures.** A handler for a §8-owned ref (Donation, AuctionLot) returns `ACCEPTED` or `REJECTED_STALE`. A ref is stale when it's already paid, the lot has been re-offered or cancelled, or the payment is foreign while FCRA is off. A stale capture is still recorded as CAPTURED and posted, then fully refunded at once as a system refund (`LATE_CAPTURE`, `DUPLICATE` or `FOREIGN_PAYMENT_BLOCKED`) without approval. §6 owns its own refs: a capture for a registration that is no longer payable puts the batch in NEEDS_REVIEW and emits `registration.paymentNeedsReview`. There is no automatic refund.

#### 8.2.5 Refunds

- **Who:** FINANCE or SUPER_ADMIN. REGISTRATION_FEE refunds may also be requested by COMPETITION_MANAGER or STAFF_ADMIN and are approved by FINANCE. Above `payment.refundDualApprovalAboveMinor`, a different FINANCE/SUPER_ADMIN user must approve. System refunds (§8.2.4, `cancelLot`, and, for registration fees, only §6's competition cancellation and duplicate resolution) skip approval. **Partial refunds** are allowed: the service locks the Payment and rejects `refundedMinor + Σ pending + amount > amountMinor`.
- **Flow:** REQUESTED → (approval) → PENDING once the provider's `refund` is called with `refundId` in notes (after a network error, check the provider's refunds before retrying, so nothing is sent twice) → PROCESSED on `refund.processed`, or FAILED on `refund.failed` (FINANCE notified, may retry). REJECTED = approver declined. OFFLINE payments are refunded outside the gateway: FINANCE records the reference and proof, and the refund is PROCESSED at once.
- **Ledger:** on PROCESSED, post a negative entry with the original type and category, `sourceType=REFUND`.

#### 8.2.6 Reconciliation

- **Daily `payments.reconcile`** (06:00 IST, previous IST day): `fetchSettlementItems` (Razorpay `GET /v1/settlements/recon/combined?year&month&day`), match by `providerPaymentId`/`providerRefundId`, set fee, tax, settlement id, `settledAt` and `reconciledAt`, and post fee + tax as EXPENSE `PAYMENT_GATEWAY_FEES` (`sourceType=SETTLEMENT_FEE`).
- **Issues:** `NOT_CAPTURED_IN_DB` (auto-healed by applying the capture; INFO), `MISSING_IN_DB` (CRITICAL; refs never auto-created), `AMOUNT_MISMATCH` (CRITICAL), `MISSING_AT_PROVIDER` (CAPTURED but unsettled after T+3 days; WARN), `DISPUTE` (from `payment.dispute.created`; CRITICAL). CRITICAL issues emit `reconciliation.issueFound`. FINANCE resolves issues in `/admin/payments` with a note (AuditLog).
- **Hourly `payments.healPending`:** CREATED/AUTHORIZED Payments older than 15 min → `fetchOrderPayments` and apply. After 24h with nothing captured → FAILED (`ABANDONED`). RecurringDonations not updated in 35 days → `fetchSubscription` and apply.

### 8.3 Registration Fees (contract with §6)

- **Call:** one order per `RegistrationPaymentBatch`. §6 computes the fee from its competition config and calls `PaymentService.createOrder({ purpose: REGISTRATION_FEE, amountMinor, currency, payerUserId, refType: 'RegistrationPaymentBatch', refId: batchId, notes: { competitionId } })`, where `amountMinor` is the batch total (Σ `RegistrationPaymentBatchItem.amountMinor`). It never calls for a zero fee or waiver. **Individual:** a batch of one, payer = participant or guardian user. **Institution bulk:** a batch of N, payer = INSTITUTION_ADMIN/coordinator. One Payment covers the batch, and §6 keeps the item ↔ Registration map. §6's register page opens Checkout with the returned `checkout`. §8 never changes Registration state.
- **Events back** (Outbox, routed by `refType`; §6 consumers MUST be idempotent): `payment.captured { paymentId, purpose, refType, refId, amountMinor, currency, capturedAt }`, `payment.failed { paymentId, refType, refId, failureCode }`, `payment.refunded { paymentId, refundId, refType, refId, amountMinor, fully, lineRefs? }`. If the registration is no longer payable (cancelled or already paid), §6 puts the batch in NEEDS_REVIEW and emits `registration.paymentNeedsReview`. There is no automatic refund.
- **Offline payment** (cheque, DD, transfer): §6 `markBatchPaidOffline` (FINANCE or STAFF_ADMIN) calls `recordOfflinePayment({ refType: 'RegistrationPaymentBatch', refId, … })`, creating an OFFLINE Payment in CAPTURED that emits the same `payment.captured`.
- **Partial refund of a batch:** COMPETITION_MANAGER or STAFF_ADMIN calls `requestRefund({ paymentId, amountMinor, reason: WITHDRAWAL, lineRefs: [{ refType: 'RegistrationPaymentBatchItem', refId }, …] })`, where `amountMinor` is the sum of the listed items' `amountMinor`, and FINANCE approves under the normal approval rules. The Payment becomes PARTIALLY_REFUNDED, and `payment.refunded` returns the `lineRefs`.
- **Ledger:** INCOME `REGISTRATION_FEES`, tagged with `competitionId`. The payer gets an acknowledgement PDF by signed link (payment id, registration ref, amount, mode). It isn't a donation receipt and uses no receipt number.

### 8.4 Donations (modules 11, 24)

#### 8.4.1 Data model

```prisma
enum DonorType { INDIVIDUAL, CORPORATE, CSR, FOUNDATION, INSTITUTIONAL }   enum NameDisclosure { DISCLOSED, ANONYMOUS }
enum DonationFrequency { ONE_TIME, MONTHLY }   enum DonationStatus { PENDING, CAPTURED, FAILED, PARTIALLY_REFUNDED, REFUNDED }
enum RecurringDonationStatus { PENDING_AUTHORIZATION, ACTIVE, PAST_DUE, PAUSED, HALTED, CANCELLED, COMPLETED }   enum FundKind { GENERAL, CAMPAIGN, EVENT, COMPETITION }

model Fund { id String @id; code String @unique; slug String @unique; name String; description String?; kind FundKind
  eventId String?; competitionId String?; goalMinor Int?; currency String; startsAt DateTime?; endsAt DateTime?
  isActive Boolean; isPublic Boolean; showProgress Boolean @default(false) }   // seed GENERAL: cannot be deactivated
model Donor { id String @id; userId String? @unique; donorType DonorType; name String /* person or organisation */
  contactPersonName String?; email String?; emailNormalized String?; phone String?
  panEncrypted Bytes?; panLast4 String?; addressLine1 String?; addressLine2 String?; city String?; state String?; pinCode String?; country String?
  createdAt DateTime  @@index([emailNormalized]) }
model Donation { id String @id; donorId String; fundId String; donorType DonorType; frequency DonationFrequency; recurringDonationId String?
  paymentId String? @unique; status DonationStatus @default(PENDING); amountMinor Int; currency String; source String /* ONLINE|OFFLINE */; recordedByUserId String?
  nameDisclosure NameDisclosure @default(ANONYMOUS); publicDisplayName String?; message String? /* ≤280 */; messageApprovedAt DateTime?; messageApprovedBy String?
  taxReceiptRequested Boolean @default(false); taxName String?; taxPanEncrypted Bytes?; taxPanLast4 String?; taxAddress Json?; declaredAdult Boolean; declaredIndianOrigin Boolean?
  receiptNumber String? @unique; receiptFy String?; receiptSeq Int?; receiptFileAssetId String?; receiptTemplateVersion Int?; receiptIssuedAt DateTime?; receiptCancelledAt DateTime?
  utm Json?; createdAt DateTime; capturedAt DateTime?  @@unique([receiptFy, receiptSeq]) }
model RecurringDonation { id String @id; donorId String; userId String; fundId String; amountMinor Int; currency String; status RecurringDonationStatus
  providerSubscriptionId String @unique; providerPlanId String; nameDisclosure NameDisclosure; publicDisplayName String?; taxReceiptRequested Boolean
  chargesCount Int @default(0); failedAttempts Int @default(0); nextChargeAt DateTime?; pauseCyclesUsed Int @default(0); pausedAt DateTime?
  cancelledAt DateTime?; cancelledBy String? /* DONOR|ADMIN|PROVIDER|SYSTEM */; cancelReason String?; createdAt DateTime }
model ReceiptSequence { fy String @id /* "2627" = Apr 2026–Mar 2027 */; lastSeq Int @default(0) }
model ReceiptTemplate { id String @id; version Int @unique; name String; bodyHtml String; taxSectionHtml String?
  signatoryName String; signatoryTitle String; signatureFileAssetId String?; isActive Boolean; createdBy String; createdAt DateTime }
```

**`DonationQuery`** (read API for other sections): `DonationQuery.totalForFund(fundId, since?: Date) => { amountMinor, currency, donorCount }`, computed from CAPTURED donations net of refunds.

#### 8.4.2 Donate flow

1. **Form** (`/donate`; `?fund=<slug>` preselects): fund (active public funds, default GENERAL), frequency (default `donation.defaultFrequency`), amount (chip or custom whole rupees within min/max; MONTHLY ≤ `recurringMaxAmountMinor`), donor type (default INDIVIDUAL). Organisation types require name, contact person, email, phone and a DISCLOSED/ANONYMOUS radio with no default. INDIVIDUAL shows an unchecked "Show my name on the supporters wall" box (checked = DISCLOSED) and an editable public name (prefilled first name + last initial). An optional message appears only after FINANCE or CONTENT_MANAGER approval.
2. **Identity:** ONE_TIME allows guest checkout (name and email required, phone optional). MONTHLY needs a user with a verified email or phone; the form offers inline OTP sign-in. Minors can't donate; a guardian donates on their behalf. **Adulthood:** `isAdult(userId)` is false iff the user has their own ParticipantProfile (`ParticipantProfile.userId = userId`) with age < 18. Guardians who manage a minor's profile are not minors. Users without one, and guests, self-declare by ticking "I am 18 or older".
3. **Tax receipt** (rendered only if `org.has80G`): "I need a tax-exemption receipt" reveals name as on PAN, PAN (`^[A-Z]{5}[0-9]{4}[A-Z]$`) and address with pin code. Required once ticked, never collected otherwise.
4. **FCRA declaration** (when `org.fcraEnabled=false`): "I am an Indian citizen donating from my own Indian funds", or "Indian-registered entity" for organisations.
5. **`createDonationCheckout`:** upsert the Donor (by `userId`, else `emailNormalized` + `donorType`) → Donation PENDING → ONE_TIME: `PaymentService.createOrder` (`refType='Donation'`); MONTHLY: `provider.createSubscription` (reusing the `ProviderPlan` for the amount) plus RecurringDonation PENDING_AUTHORIZATION → return Checkout params.
6. **Return:** `confirmCheckoutReturn` redirects to `/donate/thank-you?p=<paymentId>&t=<guestToken>`, which polls `GET /api/v1/payments/[paymentId]/status` every 2s for up to 60s. When a user later verifies an email, Donor rows with that `emailNormalized` and no `userId` are attached to them (AuditLog).

#### 8.4.3 Capture handling (inside the `payment.captured` transaction)

1. **Foreign payment while FCRA is off** (`isInternational && !org.fcraEnabled`): return `REJECTED_STALE` (`FOREIGN_PAYMENT_BLOCKED`). No receipt number is allocated. The donation becomes REFUNDED when the refund processes, and the donor is told why.
2. **Otherwise, receipt allocation:** Donation → CAPTURED. Compute the FY from `capturedAt` in Asia/Kolkata (Apr–Mar). Run `INSERT … ON CONFLICT DO NOTHING`, then `UPDATE "ReceiptSequence" SET "lastSeq"="lastSeq"+1 WHERE fy=$1 RETURNING "lastSeq"`, giving `receiptNumber = FOA-RCPT-{fy}-{seq:06}`. Because this runs in the capture transaction, numbers are gapless and failed payments never consume one.
3. **Ledger:** INCOME, with the category from the donor-type map (`INDIVIDUAL→DONATIONS_INDIVIDUAL`, `CORPORATE→DONATIONS_CORPORATE`, `CSR→CSR_CONTRIBUTIONS`, `FOUNDATION|INSTITUTIONAL→GRANTS_INSTITUTIONAL`), tagged with `fundId`. Outbox `donation.captured` (§10 sends a thank-you message only, no attachment).
4. **Receipt PDF:** the job `donations.renderReceipt` writes the PDF (FileAsset `PDF`, private bucket) and, after it renders, emits `donation.receiptIssued`. §10's message carries a signed download link valid for 7 days, not an attachment.

#### 8.4.4 Receipts

- **Template:** the active `ReceiptTemplate` renders only whitelisted variables: org legal name, address, PAN, `org.registrations`; receipt number and date (IST); donor name and type; amount in figures and Indian-system words ("Rupees One Lakh Five Thousand Only"); mode (UPI, card, netbanking, cheque no., bank ref) and transaction ref; fund; recurring flag; "No goods or services were provided in exchange".
- **Tax section:** `taxSectionHtml` (80G text, registration no. and validity, donor PAN and address) renders only if `org.has80G && taxReceiptRequested && !(CASH && amount > cash80GMaxMinor)`.
- **Regeneration** (template fix, name correction) keeps the number, bumps `receiptTemplateVersion`, and keeps old files. **Refund** sets `receiptCancelledAt` and re-renders with a "CANCELLED, refunded on …" watermark ("Amended: ₹X refunded" if partial). Numbers are never reused.
- **Recurring:** one receipt per charge, plus a FY consolidated statement (not a receipt) on `/dashboard`. **Form 10BD:** if `org.has80G`, FINANCE exports the data per FY; the accountant confirms the columns.

#### 8.4.5 Donation and recurring state machines

| Entity: From → To | Trigger | Guard | Side effects |
|---|---|---|---|
| Donation ∅ → PENDING | `createDonationCheckout` | Validation passed | Payment CREATED |
| Donation ∅ → CAPTURED | `recordOfflineDonation` (FINANCE) | Proof attached. Cash < `cashMaxMinor` | OFFLINE Payment CAPTURED. Receipt. Ledger |
| Donation PENDING/FAILED → CAPTURED | `payment.captured` | Not foreign-blocked | Receipt, ledger, `donation.captured` |
| Donation PENDING → FAILED | `payment.failed` / `ABANDONED` | | No email for abandoned payments |
| Donation CAPTURED → PARTIALLY_REFUNDED / REFUNDED | `payment.refunded` | | Receipt amended or cancelled. `donation.refunded` |
| Recurring ∅ → PENDING_AUTHORIZATION | `createDonationCheckout` (MONTHLY) | Signed in | Provider subscription created. Sweeper cancels it if still unauthorised after 24h |
| PENDING_AUTHORIZATION → ACTIVE | `subscription.authenticated` / `activated` | | `recurringDonation.activated` |
| ACTIVE/PAST_DUE → ACTIVE | `subscription.charged` | Idempotent on `providerPaymentId` | New Donation + Payment CAPTURED (disclosure and tax fields copied). `failedAttempts=0`. `recurringDonation.charged` |
| ACTIVE → PAST_DUE | `subscription.pending` (charge failed, provider retrying) | | `failedAttempts++`. `recurringDonation.chargeFailed` (with an update-payment link) |
| PAST_DUE → HALTED | `subscription.halted` (retries exhausted) | | `recurringDonation.halted`. Auto-cancel after `haltedAutoCancelDays` |
| ACTIVE ↔ PAUSED | Donor or FINANCE pause/resume → provider, confirmed by `subscription.paused` / `resumed` | `pauseCyclesUsed < maxPauseCycles` | `recurringDonation.paused` / `recurringDonation.resumed` |
| non-terminal → CANCELLED | Donor/FINANCE cancel, `subscription.cancelled`, or HALTED timeout | | Provider cancelled immediately. `recurringDonation.cancelled` |
| ACTIVE → COMPLETED | `subscription.completed` | | Donor invited to renew |

Changing the amount means cancelling and creating a new subscription, because the mandate must be re-authorised.

#### 8.4.6 Foreign contributions

`org.fcraEnabled=false` (default): INR only, international methods off at Checkout and on the account, declaration required, international captures auto-refunded (§8.4.3). `true` is specified but not built until FOA confirms registration. It needs a second provider account settling into FOA's FCRA-designated bank account (chosen by `Payment.providerAccount: DOMESTIC|FCRA`), `isForeignContribution` ledger tagging, and donor nationality fields for FCRA reporting.

#### 8.4.7 Admin donation management (`/admin/donations`)

- **Search:** receipt no., donor name/email/phone, PAN last 4, fund, donor type, status, source, date and amount range, recurring.
- **Actions:** view; refund (§8.2.5); resend or regenerate the receipt; record an offline donation (method, reference, received date, required proof upload, donor details, disclosure); edit disclosure or public name at the donor's request; approve or reject messages; manage Funds; manage receipt templates (new version, sample-data preview, activate); export CSV (PAN masked unless `includePan=true`, which needs a reason and is AuditLogged); export Form 10BD data.
- **Roles:** FINANCE has full access. STAFF_ADMIN is read-only. CONTENT_MANAGER approves messages and edits Fund copy.

### 8.5 Auctions (Phase 15; modules 5, 23), post-MVP

#### 8.5.1 Data model

```prisma
enum AuctionLotStatus { DRAFT, SCHEDULED, LIVE, CLOSED_PENDING_PAYMENT, CLOSED_UNSOLD, PAID, SHIPPED, DELIVERED, CANCELLED, RELISTED }
enum CreatorCreditMode { FULL_NAME, FIRST_NAME_INITIAL, ANONYMOUS }   enum BidKind { MANUAL, PROXY }   enum BidStatus { VALID, VOIDED }

model AuctionEvent { id String @id; slug String @unique; title String; description String?; startsAt DateTime; endsAt DateTime; isPublished Boolean; createdBy String }
model AuctionLot { id String @id; lotCode String @unique; auctionEventId String; physicalArtworkId String; entryId String; competitionId String; participantId String
  status AuctionLotStatus @default(DRAFT); title String; story String?; awardLabel String?; disciplineLabel String; ageCategoryLabel String
  imageFileAssetId String /* STAMPED */; extraImageFileAssetIds String[]; dimensionsText String?; materialText String?; conditionNote String?
  creditMode CreatorCreditMode; creditLine String /* rendered snapshot */; currency String; startingBidMinor Int; reserveMinor Int?; fixedIncrementMinor Int?
  opensAt DateTime; closesAt DateTime; originalClosesAt DateTime; extensionCount Int @default(0)
  currentBidMinor Int?; leaderUserId String?; bidCount Int @default(0); version Int @default(0)
  proceedsFoaBps Int; proceedsCreatorBps Int; proceedsSchoolBps Int /* snapshot at SCHEDULED; sum = 10000 */
  winnerUserId String?; hammerMinor Int?; offerRank Int @default(0); paymentDueAt DateTime?; paymentId String?; shareNameWithArtist Boolean @default(false)
  shippingAddress Json?; logisticsPartner String?; trackingNumber String?; trackingUrl String?; shippedAt DateTime?; deliveredAt DateTime?; deliveryIssueOpen Boolean @default(false)
  relistedFromLotId String?; cancelReason String?; createdBy String; createdAt DateTime; updatedAt DateTime
  @@index([status, closesAt]) }  // partial unique (physicalArtworkId) WHERE status NOT IN (CANCELLED, RELISTED, CLOSED_UNSOLD)
model AuctionBid { id String @id; lotId String; bidderUserId String; amountMinor Int; kind BidKind; status BidStatus @default(VALID)
  placedAt DateTime @default(now()); idempotencyKey String @unique; ipHash String?; voidReason String?  @@index([lotId, amountMinor]) }
model AuctionMaxBid { id String @id; lotId String; bidderUserId String; maxAmountMinor Int; isActive Boolean; updatedAt DateTime  @@unique([lotId, bidderUserId]) }
model AuctionBidder { userId String @id; termsVersion Int; termsAcceptedAt DateTime; dateOfBirth DateTime @db.Date
  nonPaymentStrikes Int @default(0); suspendedAt DateTime?; suspendReason String? }
model AuctionTerms { id String @id; version Int @unique; bodyMarkdown String; publishedAt DateTime?; publishedBy String? }
model AuctionProceedsPolicy { competitionId String @id; foaBps Int @default(10000); creatorBps Int @default(0); schoolBps Int @default(0); payoutNote String?; updatedBy String }
model ProceedsPayout { id String @id; lotId String; payeeType String /* CREATOR|SCHOOL */; payeeRefId String; amountMinor Int
  status String /* PENDING|PAID|WAIVED */; reference String?; paidAt DateTime?; paidBy String? }
model AuctionAcknowledgement { id String @id; lotId String @unique; participantId String; institutionId String?; letterFileAssetId String; issuedAt DateTime }
```

#### 8.5.2 Lot eligibility guards

Checked in `createLot`, re-checked in `scheduleLot` and again at SCHEDULED → LIVE. Each failure has its own error code.

1. `PhysicalArtwork.status ∈ {VERIFIED, IN_EXHIBITION, RETAINED}` (§6), and no other non-terminal lot exists for the artwork.
2. `Entry.auctionCandidate = true` (§7), and the entry is not WITHDRAWN or DISQUALIFIED.
3. `Competition.allowAuction = true` (§6).
4. `ConsentService.has(participantId, AUCTION_OF_ARTWORK, competitionId)` and `ConsentService.has(…, PUBLIC_DISPLAY, …)`. For a creator under 18, the auction consent must have been given by a guardian and `GUARDIAN_VERIFIED` must be present (§12).
5. **Credit:** `creditMode` = the consent's `metadata.creditMode`, captured on §12's consent form (ANONYMOUS if absent), capped at `auction.minorCreditCap` for minors. AUCTION_MANAGER can only choose a more private mode. `creditLine`: FULL_NAME → full name, school, city. FIRST_NAME_INITIAL → "Aarav S.", school, city. ANONYMOUS → "Young artist, {ageCategory}". DOB and exact age are never shown.
6. **Image:** `StampService.stamp(<web derivative>, { variant: 'GALLERY' })`. Only STAMPED assets are public.
7. **Prefill:** title, story (the participant's statement), `finalAwardLabel`, discipline, age category, and the dimensions, material and condition from §6 verification.

#### 8.5.3 Bidding (English ascending)

- **Eligibility** (`assertBidderEligible`): the bidder must be signed in and have `User.phoneVerifiedAt` set. They must have accepted the current `AuctionTerms.version`. Their declared DOB must make them 18+ on the bid date, and `isAdult(userId)` (§8.4.2) must hold, so minors can't bid. They must not be suspended and must not hold AUCTION_MANAGER or FINANCE. Guardians and relatives of the creator may bid; the admin view flags them.
- **Minimum next bid:** `startingBidMinor` when there are no bids, else `currentBidMinor + (fixedIncrementMinor ?? band(currentBidMinor))`. Amounts are whole rupees.
- **`placeBid({ lotCode, amountMinor, idempotencyKey })`**, one transaction:
  1. `SELECT … FROM "AuctionLot" WHERE "lotCode"=$1 FOR UPDATE`.
  2. Guards, on the DB clock: `LOT_NOT_LIVE`, `LOT_CLOSED` (`now() ≥ closesAt`), `NOT_ELIGIBLE`, `BID_TOO_LOW { minNextMinor }`, `ALREADY_LEADING` (the leader raises via `setMaxBid`).
  3. Insert a MANUAL bid. If another bidder's active max is ≥ the bid, insert a PROXY bid for them at `min(theirMax, amount + increment)` and they stay leader (a tie between a max and a manual bid goes to the earlier max). Then update `currentBidMinor`, `leaderUserId`, `bidCount`, `version++`.
  4. Anti-sniping: if `closesAt − now() < antiSnipeWindowSec`, set `closesAt = min(now() + antiSnipeExtendSec, originalClosesAt + antiSnipeMaxTotalMin)`, `extensionCount++`, and reschedule the close job.
  5. Outbox: `bid.placed`, `bid.outbid` to the previous leader (if changed), `lot.extended`.
- **`setMaxBid({ lotCode, maxAmountMinor })`:** same lock. The max must be ≥ minNext (or above the bidder's own max if they lead), and any needed proxy bid is placed at once. Max bids can only be raised, never lowered or withdrawn, and only their owner sees them. **Proxy bidding is ON by default** (recommended): casual bidders for children's art can't watch the close, and proxies blunt sniping.
- **Live updates by polling:** `GET /api/v1/auctions/lots/[lotCode]/state` → `{ status, currentBidMinor, minNextMinor, bidCount, closesAt, serverNow, reserveMet, youAreLeading, version }` (`no-store`, ETag on `version`). Clients poll every 10s, every 3s in the last 5 min, and right after their own bid. SSE can come later behind the same payload.
- **Public history:** amount, time and a per-lot pseudonym ("Bidder 3"; the viewer sees "You"). The reserve amount is never exposed, only met / not met. Rate limits: 10 bids/min per user, 60/min per IP. **`voidBid`** (AUCTION_MANAGER, reason required) recomputes the leader and price from the remaining VALID bids under the lock and notifies the affected bidders.

#### 8.5.4 Closing, payment, second chance

- **Close job:** `auctions.closeLot` runs at `closesAt` and is rescheduled on each extension. A per-minute sweeper catches any LIVE lot past `closesAt`. Under the lock the job re-checks `now() ≥ closesAt`; if the close has moved, it reschedules and exits.
- **Outcome:** no VALID bids, or `currentBidMinor < reserveMinor` → CLOSED_UNSOLD. Otherwise → CLOSED_PENDING_PAYMENT with `winnerUserId = leader`, `hammerMinor = currentBidMinor`, `offerRank = 1`, `paymentDueAt = now + paymentWindowHours`. Max bids are deactivated. `lot.won` goes to the winner and `lot.closed` to the other bidders.
- **`startLotPayment({ lotCode, shippingAddress, shareNameWithArtist })`** (current winner only): the address country must be in `shippingCountries`. The service calls `createOrder({ purpose: AUCTION, amountMinor: hammerMinor (+ flat shipping), refType: 'AuctionLot', refId, notes: { offerRank } })`.
- **Reminders:** §10 sends `reminder.auctionPayment` T−24 h and T−2 h before `paymentDueAt`. §8 emits no reminder event.
- **Overdue job** (at `paymentDueAt`, if not PAID): send `lot.paymentOverdue` and add a strike (reaching `nonPaymentStrikesToSuspend` suspends the bidder). Then, if `offerRank ≤ maxSecondChanceOffers`, make a **second-chance offer** to the highest VALID bid from a different, still-eligible bidder with a bid ≥ reserve, at that bidder's own highest bid. The lot stays CLOSED_PENDING_PAYMENT with the new winner, `offerRank++`, `paymentDueAt = now + secondChanceWindowHours`, and emits `lot.secondChanceOffered`. Paying is acceptance. `declineSecondChance` or a timeout moves on to the next candidate. No candidates left → CLOSED_UNSOLD.
- **Capture handler:** PAID only if `payerUserId = winnerUserId` and `notes.offerRank = offerRank`. Anything else is `REJECTED_STALE` and auto-refunded (`LATE_CAPTURE`).
- **On PAID:** artwork → SOLD (§6 service); ledger INCOME `AUCTION_PROCEEDS` tagged with `auctionEventId` and `competitionId`; PENDING ProceedsPayouts for non-zero creator or school shares; a purchase confirmation PDF for the buyer (a purchase, not a donation, so no tax-exemption receipt); `lot.paid`, `lot.sold`.

#### 8.5.5 Fulfilment, acknowledgement, proceeds

- **Shipping:** AUCTION_MANAGER calls `markLotShipped({ logisticsPartner, trackingNumber, trackingUrl? })` → SHIPPED (`lot.shipped`). Shipping invoices are manual EXPENSE `LOGISTICS` entries.
- **Delivery:** DELIVERED via the buyer's `confirmLotDelivery`, AUCTION_MANAGER's `markLotDelivered`, or automatically `autoDeliverAfterDays` after shipping. The buyer can call `reportDeliveryIssue` (photos, within 48h of delivery); this sets `deliveryIssueOpen`, blocks auto-delivery and alerts AUCTION_MANAGER.
- **Artist acknowledgement** (end-to-end flow step 13): on `lot.sold`, the job `auctions.issueAcknowledgement` renders a thank-you letter PDF (title, lot code, competition, award, amount raised, FOA signatory; the buyer's name only if `shareNameWithArtist`, otherwise "a supporter of FOA"). It's stored as an AuctionAcknowledgement and shown on the creator's `/dashboard` and, for the school route, on `/institution`. `lot.acknowledged { participantId, guardianId?, institutionId?, lotId, letterFileAssetId }` lets §10 thank the creator (via the guardian for minors) and the school coordinator.
- **Proceeds:** FINANCE pays PENDING ProceedsPayouts outside the platform (guardian's account for minors, or the school's account) and records `markProceedsPayoutPaid`, which posts EXPENSE `AUCTION_PROCEEDS_PAYOUTS`. A payee who declines makes the payout WAIVED. The lot page shows the split.

#### 8.5.6 Lot state machine

| From → To | Actor / trigger | Guard | Side effects |
|---|---|---|---|
| ∅ → DRAFT | AUCTION_MANAGER `createLot` | §8.5.2 guards 1–4 | Stamped image. AuditLog |
| DRAFT → SCHEDULED | AUCTION_MANAGER `scheduleLot` | Guards re-checked. `opensAt > now`. Duration ≥ `minLotDurationHours`. Event published. Current terms published. Proceeds policy exists | Artwork → LISTED_FOR_AUCTION (`setAuctionState`; the prior status is stored in `PhysicalArtwork.statusBeforeListing`). Proceeds snapshot. Jobs scheduled. `lot.scheduled` |
| SCHEDULED → DRAFT | AUCTION_MANAGER `unscheduleLot` | `now < opensAt` | Artwork → `statusBeforeListing` (`setAuctionState`). Jobs cancelled |
| SCHEDULED → LIVE | Job at `opensAt` | Consents still valid (otherwise → CANCELLED) | `lot.opened` |
| LIVE → CLOSED_PENDING_PAYMENT | Close job | `now ≥ closesAt`, a leader exists, reserve met | §8.5.4. `lot.won`, `lot.closed` |
| LIVE → CLOSED_UNSOLD | Close job | No bids, or reserve not met | Artwork → `statusBeforeListing` (`setAuctionState`). `lot.unsold` |
| CLOSED_PENDING_PAYMENT → same | Overdue job / `declineSecondChance` | An eligible next bid ≥ reserve, and `offerRank ≤ max` | New winner. `lot.paymentOverdue`, `lot.secondChanceOffered` |
| CLOSED_PENDING_PAYMENT → CLOSED_UNSOLD | Overdue job | No candidates left | Artwork → `statusBeforeListing` (`setAuctionState`). `lot.unsold` |
| CLOSED_PENDING_PAYMENT → PAID | `payment.captured` (AUCTION) | Payer = winner, `offerRank` matches | Artwork → SOLD. Ledger. Payouts. `lot.paid`, `lot.sold` |
| PAID → SHIPPED | AUCTION_MANAGER `markLotShipped` | Address, partner and tracking no. present | `lot.shipped` |
| SHIPPED → DELIVERED | Buyer / AUCTION_MANAGER / auto job | Auto only if `!deliveryIssueOpen` | `lot.delivered` |
| CLOSED_UNSOLD → RELISTED | AUCTION_MANAGER `relistLot` | Guards 1–4 still hold | New DRAFT lot with `relistedFromLotId` |
| DRAFT/SCHEDULED/LIVE/CLOSED_PENDING_PAYMENT → CANCELLED | AUCTION_MANAGER `cancelLot` (reason), or the `consent.withdrawn` consumer | | Bids lapse. Max bids deactivated. Artwork → `statusBeforeListing` (`setAuctionState`) if it was listed. Any later capture auto-refunded. `lot.cancelled` |
| PAID/SHIPPED → CANCELLED | AUCTION_MANAGER, with FINANCE approval (lost or damaged) | | Full refund (`LOT_CANCELLED`). Artwork: `setAuctionState` reverts SOLD → `statusBeforeListing`, or §6 `recordArtworkReturn` if the work goes back to the creator |

#### 8.5.7 Auction terms (`AuctionTerms`)

Versioned and published by STAFF_ADMIN. A bidder accepts them before their first bid and again on each new version. They MUST cover:

- **Bidding:** eligibility (18+, verified phone, shipping to `shippingCountries` only); bids are binding and can't be retracted (FOA alone may void a bid, for error or abuse); how proxy bidding, increments and anti-sniping work; a reserve may be undisclosed; the payment window, strikes, suspension and second-chance offers.
- **Ownership:** the creator (via the guardian for minors) donates the physical work to FOA under AUCTION_OF_ARTWORK consent, and title passes to the buyer on full payment. Copyright stays with the creator, so the buyer gets no reproduction or commercial rights. FOA keeps image use under PUBLIC_DISPLAY.
- **Sale:** original children's artwork, sold as is with the recorded condition note; transit-damage claims within 48h with photos, no other returns; a purchase is not a donation and gets no tax receipt; buyer identity is never published and is shared with the creator only on opt-in, and bidders appear as pseudonyms; the proceeds split is stated per lot; FOA may withdraw lots before payment, including on consent withdrawal, and bids on a withdrawn lot lapse without liability.

### 8.6 Finance Ledger & Budgets (module 29)

#### 8.6.1 Data model

```prisma
enum LedgerEntryType { INCOME, EXPENSE }   enum PeriodStatus { OPEN, LOCKED, PUBLISHED }
enum LedgerSourceType { PAYMENT, REFUND, OFFLINE_PAYMENT, SETTLEMENT_FEE, PROCEEDS_PAYOUT, PRIZE_FULFILMENT, MANUAL, REVERSAL }
enum FinancialReportType { AUDITED_STATEMENT, ANNUAL_REPORT, QUARTERLY_SUMMARY, REGISTRATION_DOCUMENT, OTHER }   enum FinancialReportStatus { DRAFT, PENDING_APPROVAL, PUBLISHED, WITHDRAWN }

model LedgerCategory { id String @id; code String @unique; name String; type LedgerEntryType; publicLabel String
  publicGroup String /* INCOME|PROGRAMS|FUNDRAISING|ADMINISTRATION */; isSystem Boolean; isActive Boolean; sortOrder Int }
model LedgerEntry { id String @id; seq BigInt @unique @default(autoincrement()); type LedgerEntryType; categoryId String
  amountMinor Int /* signed; negative only for refunds and reversals */; currency String; occurredAt DateTime; periodMonth String /* "2026-11" IST */; fy String
  fundId String?; auctionEventId String?; competitionId String?; sourceType LedgerSourceType; sourceId String?
  description String; counterpartyName String? /* never public */; attachmentFileAssetId String?
  reversalOfId String? @unique; lateAdjustment Boolean @default(false); createdByUserId String? /* null = system */; createdAt DateTime
  @@unique([sourceType, sourceId, categoryId]) @@index([periodMonth, categoryId]) }
model Budget { id String @id; fy String; categoryId String; fundId String?; amountMinor Int; currency String; notes String?
  status String /* DRAFT|APPROVED */; createdBy String; approvedBy String?; approvedAt DateTime?  @@unique([fy, categoryId, fundId]) }
model FinancialPeriod { month String @id; fy String; status PeriodStatus @default(OPEN); lockedBy String?; lockedAt DateTime?
  publishRequestedBy String?; publishRequestedAt DateTime?; publishedBy String?; publishedAt DateTime? }
model TransparencySnapshot { id String @id; throughMonth String; data Json; generatedAt DateTime }
model FinancialReport { id String @id; title String; type FinancialReportType; fy String?; fileAssetId String; summary String?
  status FinancialReportStatus; uploadedBy String; approvedBy String?; publishedAt DateTime?; withdrawnReason String? }
```

**Seed system categories.** INCOME: `DONATIONS_INDIVIDUAL`, `DONATIONS_CORPORATE`, `CSR_CONTRIBUTIONS`, `GRANTS_INSTITUTIONAL`, `REGISTRATION_FEES`, `AUCTION_PROCEEDS`, `SPONSORSHIP`, `OTHER_INCOME`. EXPENSE: `PRIZES_AWARDS`, `CERTIFICATES_PRINTING`, `LOGISTICS`, `PLATFORM_TECHNOLOGY`, `PAYMENT_GATEWAY_FEES`, `EVENTS_WORKSHOPS`, `AWARENESS_OUTREACH`, `ANIMAL_WELFARE_PROGRAMS`, `AUCTION_PROCEEDS_PAYOUTS`, `STAFF_ADMINISTRATION`, `PROFESSIONAL_FEES`, `OTHER_EXPENSE`. FINANCE can add and rename categories. System categories can't be deleted or change type.

#### 8.6.2 `LedgerService` rules

- **Signature:** `LedgerService.record({ type, category /* code */, amountMinor, currency, sourceType, sourceId, occurredAt, fundId?, auctionEventId?, competitionId?, description?, attachmentFileAssetId? })` is a superset of §3.5. It runs in the caller's transaction and is idempotent on `(sourceType, sourceId, category)`: a repeat call returns the existing row.
- **Immutable:** a Postgres trigger raises on UPDATE or DELETE of `LedgerEntry`. Corrections use `reverseLedgerEntry`, which adds a negated row (`reversalOfId`, `sourceType=REVERSAL`), optionally followed by a corrected entry.
- **Single entry** with categories is enough for the MVP. Amounts are in `org.baseCurrency`, on a cash basis: `occurredAt` = capture, refund or payment date.
- **Locked months:** an automatic posting whose month is LOCKED or PUBLISHED goes to the earliest OPEN month with `lateAdjustment=true`. Manual entries into locked months are rejected.

| Posting trigger | Type / category | Amount | Source |
|---|---|---|---|
| Captured payment (online / offline) | INCOME / by purpose: REGISTRATION_FEES, donor-type map (§8.4.3), AUCTION_PROCEEDS | +amount | PAYMENT or OFFLINE_PAYMENT / paymentId |
| Refund PROCESSED | Original type and category | −refund | REFUND / refundId |
| Settlement fee + tax | EXPENSE / PAYMENT_GATEWAY_FEES | +fee | SETTLEMENT_FEE / providerPaymentId |
| Proceeds payout paid | EXPENSE / AUCTION_PROCEEDS_PAYOUTS | +payout | PROCEEDS_PAYOUT / payoutId |
| Prize dispatched with a recorded cost (§7.8) | EXPENSE / PRIZES_AWARDS | +cost | PRIZE_FULFILMENT / prizeFulfilmentId |
| Manual (FINANCE) | Any active category | ± | MANUAL / entry id |

- **Manual entries:** FINANCE only, with a required description. EXPENSE entries also require an attachment: an invoice or receipt FileAsset (PDF, JPG or PNG) with `scanStatus=CLEAN`. Grants and CSR money received outside the gateway are recorded as offline donations (donor type FOUNDATION or CSR) so they get receipts. Other income (sponsorship, interest) is a MANUAL INCOME entry with an attachment.

#### 8.6.3 Budgets, reports, exports

- **Budgets:** one per FY × category (optionally × fund). FINANCE drafts; STAFF_ADMIN approves. Changing an approved budget needs a new approval, and AuditLog keeps the history.
- **Budget vs actual** (`/admin/finance`), per category for the FY and each quarter: budget, actual (Σ ledger), variance, % used. Rows at 90% or more show amber; above 100% show red. `budget.thresholdExceeded` fires once per category per FY when a category crosses 100%.
- **`exportLedgerCsv`:** RFC 4180, UTF-8 with BOM, one row per entry. Columns: `seq, date_ist, fy, period, type, category_code, category_name, amount_inr (2 dp), currency, fund_code, auction_event, competition_code, source_type, source_ref (payment id / receipt no. / refund id), provider_fee, description, counterparty, attachment_id, reversal_of_seq, late_adjustment, created_by`. Other exports: the donation register, Form 10BD data, and reconciliation issues.

#### 8.6.4 Period close and publish

| From → To | Actor | Guard | Effects |
|---|---|---|---|
| OPEN → LOCKED | FINANCE `lockPeriod` | Month ended. Previous month LOCKED. No OPEN CRITICAL reconciliation issue in the month | Manual postings blocked. `financialPeriod.locked` |
| LOCKED → OPEN | SUPER_ADMIN `reopenPeriod` (reason) | Not yet PUBLISHED | AuditLog |
| LOCKED → PUBLISHED | FINANCE `requestPeriodPublish`, then `approvePeriodPublish` by a different FINANCE or STAFF_ADMIN user | All earlier months PUBLISHED | Snapshot regenerated. `financialPeriod.published` |

A PUBLISHED month is never reopened. Later corrections arrive as `lateAdjustment` entries, and `/transparency` lists them as "adjustments to earlier periods".

### 8.7 Financial Transparency (`/transparency`, module 12)

- **Source:** the latest `TransparencySnapshot`, built only from LedgerEntries in PUBLISHED months and regenerated on period publish and on report publish or withdrawal. Public requests never query the ledger. The page is cached with `cacheTag('transparency')`, and writing a snapshot revalidates that tag (§2.2: `updateTag` in a Server Action, the internal route from the worker).
- **Periods:** FY ("FY 2026-27, Apr–Nov", published months only) and quarters (shown only when all three months are published).
- **Sections:**
  1. Totals: income, expenses and net, with "data through <month>" and a last-updated date.
  2. Charts, each with an accessible data table: income and expense by `publicLabel`, a monthly income-vs-expense trend, and the expense split by `publicGroup` (programs, fundraising, administration).
  3. Campaigns: per public Fund, total raised (Σ INCOME tagged with the fund), goal, donation count.
  4. Auctions: per published AuctionEvent, lots sold, total raised, amount paid to creators and schools.
  5. Supporters wall: individuals with a DISCLOSED donation (`publicDisplayName` and approved message, never amounts), and DISCLOSED organisations (name, plus the published-FY total if `showOrgDonorAmounts`). It covers CAPTURED, not fully refunded donations from any period, and is read live because it's recognition rather than financial data; a switch to ANONYMOUS disappears within one revalidation (≤ 5 min).
  6. Published reports, grouped by FY, with PDF downloads.
  7. Budget vs actual, only if `showBudgets`.
- **Never public:** identity of non-disclosed donors; any individual's donation amount; PAN, addresses, emails, phones; payment and refund ids; counterparty or vendor names; ledger attachments; bidder, buyer and payout-payee identities; unpublished months; reconciliation data. FINANCE MUST map any category that would reveal one person's pay to a broader `publicLabel`.
- **Report workflow:** FINANCE uploads the PDF (DRAFT) → `submitFinancialReport` (PENDING_APPROVAL) → `publishFinancialReport` by a different FINANCE or STAFF_ADMIN user (PUBLISHED; file copied to the public bucket) → `withdrawFinancialReport` (reason; WITHDRAWN; public copy deleted). A correction is uploaded as a new report.

### 8.8 Pages

| Route | Access | Contents |
|---|---|---|
| `/donate` | Public | §8.4.2 form. Fund header with a live provisional progress bar if `showProgress`. FAQ stating the receipt/80G status from config |
| `/donate/thank-you` | Payer session or guest token | Status polling, receipt download, share, manage-recurring link |
| `/auctions` | Public | LIVE and SCHEDULED lots grouped by AuctionEvent (image, title, credit line, current bid, time left). Filters: competition, discipline, price. A "Sold" archive with final prices. Cancelled lots hidden |
| `/auctions/[lotCode]` | Public; bidding needs eligibility | Images, title, credit line, story, award, competition, dimensions and condition, proceeds split, current bid, min next bid, countdown from `serverNow`, reserve indicator, bid and max-bid forms, pseudonymous history, terms link. Inline eligibility wizard (phone OTP → DOB → terms). A CANCELLED lot shows "withdrawn" and no bid data |
| `/dashboard` | Signed in | **Donations:** receipts, FY statement. **Recurring:** status, next charge, pause/resume/cancel, disclosure. **My bids:** leading or outbid, my max. **Won lots:** pay, address, tracking, confirm delivery, report issue. **My artwork in auctions** (participant or guardian), with acknowledgement letters |
| `/admin/payments` | FINANCE (STAFF_ADMIN read-only) | Payment search and detail (provider data), refund queue and approvals, webhook log and replay, reconciliation runs and issues, offline payment entry |
| `/admin/donations` | FINANCE (§8.4.7) | Donations, funds, receipt templates, exports, message moderation |
| `/admin/auctions` | AUCTION_MANAGER (FINANCE for payouts, STAFF_ADMIN read-only and terms) | Events; artwork picker listing only artworks that pass guards 1–4; lot editor and preview; scheduling; live monitor (bids, flags for shared-IP bidders and relatives); close and second-chance queue; fulfilment; bidder suspensions; terms versions |
| `/admin/finance` | FINANCE (STAFF_ADMIN approvals) | Ledger (filter, detail, reverse), manual entry, categories, budgets and budget vs actual, period lock/publish, reports, exports, transparency preview |

### 8.9 Server Actions

Every action validates input with zod, checks `can()` inside the service, and writes AuditLog for money, state or PII changes. "Owner" means the donor's or buyer's own user.

| Action | Input | Authorization | Effect |
|---|---|---|---|
| `confirmCheckoutReturn` | `{ paymentId, providerPaymentId, providerOrderId? \| providerSubscriptionId?, signature }` | Payer session or guest token | Verify signature, `fetchPayment`, apply transition idempotently, return status |
| `requestRefund` / `approveRefund` / `rejectRefund` | `{ paymentId, amountMinor, reason, reasonText, lineRefs? }` / `{ refundId, note? }` | FINANCE, SUPER_ADMIN. `requestRefund` also COMPETITION_MANAGER and STAFF_ADMIN, for REGISTRATION_FEE only (FINANCE approves). The approver must differ from the requester | §8.2.5 |
| `recordOfflinePayment` | `{ refType, refId, amountMinor, method, reference, receivedAt, proofFileAssetId }` | FINANCE, STAFF_ADMIN | OFFLINE Payment CAPTURED, `payment.captured` |
| `replayWebhookEvent` / `resolveReconciliationIssue` | `{ webhookEventId }` / `{ issueId, status, note }` | FINANCE, SUPER_ADMIN | Re-enqueue / resolve |
| `createDonationCheckout` | `{ fundId, amountMinor, frequency, donorType, donor, nameDisclosure, publicDisplayName?, message?, tax?, declarations, idempotencyKey }` | Public (MONTHLY needs a session) | §8.4.2 step 5 |
| `recordOfflineDonation` | `{ donor, donorType, fundId, amountMinor, method, reference, receivedAt, proofFileAssetId, nameDisclosure, tax? }` | FINANCE | Donation CAPTURED, receipt, ledger |
| `resendDonationReceipt` / `regenerateDonationReceipt` | `{ donationId }` / `{ donationId, reason, corrections? }` | Owner or FINANCE / FINANCE | §8.4.4 |
| `updateDonationDisclosure` / `pauseRecurringDonation` / `resumeRecurringDonation` / `cancelRecurringDonation` | `{ donationId \| recurringDonationId, nameDisclosure, publicDisplayName? }` / `{ recurringDonationId, reason? }` | Owner, FINANCE | Supporters wall updated / provider call, status changes on the webhook |
| `moderateDonorMessage` / `upsertFund` / `publishReceiptTemplate` | `{ donationId, approved }` / Fund fields / template fields | FINANCE or CONTENT_MANAGER / FINANCE or STAFF_ADMIN / FINANCE | |
| `exportDonations` / `exportLedgerCsv` | `{ filters, includePan, reason? }` / `{ from, to, categoryIds?, fundId? }` | FINANCE | CSV (AuditLog with the reason when PAN is included) / §8.6.3 |
| `acceptAuctionTerms` | `{ termsVersion, dateOfBirth }` | MEMBER with verified phone | Upserts AuctionBidder. Rejects under-18s |
| `placeBid` / `setMaxBid` | `{ lotCode, amountMinor, idempotencyKey }` / `{ lotCode, maxAmountMinor }` | Eligible bidder | §8.5.3 |
| `startLotPayment` / `declineSecondChance` / `confirmLotDelivery` / `reportDeliveryIssue` | `{ lotCode, shippingAddress, shareNameWithArtist }` / `{ lotCode }` / `{ lotCode, note?, photoFileAssetIds? }` | Current winner / buyer | §8.5.4, §8.5.5 |
| `upsertAuctionEvent` / `createLot` / `updateLot` | Event fields / `{ physicalArtworkId, auctionEventId }` / lot fields | AUCTION_MANAGER | `updateLot` is DRAFT only. In SCHEDULED, only copy fields can change, not prices or times |
| `scheduleLot` / `unscheduleLot` / `cancelLot` / `relistLot` | `{ lotId, reason?, opensAt?, closesAt?, startingBidMinor?, reserveMinor? }` | AUCTION_MANAGER | §8.5.6 |
| `voidBid` / `suspendBidder` / `reinstateBidder` | `{ bidId \| userId, reason }` | AUCTION_MANAGER | §8.5.3 |
| `markLotShipped` / `markLotDelivered` | `{ lotId, logisticsPartner, trackingNumber, trackingUrl? }` / `{ lotId, proofFileAssetId? }` | AUCTION_MANAGER | §8.5.5 |
| `publishAuctionTerms` / `setProceedsPolicy` | `{ bodyMarkdown }` / `{ competitionId, foaBps, creatorBps, schoolBps, payoutNote? }` | STAFF_ADMIN / FINANCE | New version, bidders re-accept / sum = 10000, applies to lots scheduled afterwards |
| `markProceedsPayoutPaid` / `waiveProceedsPayout` | `{ payoutId, reference?, paidAt? }` | FINANCE | Ledger EXPENSE on PAID |
| `createLedgerEntry` / `reverseLedgerEntry` | `{ type, categoryId, amountMinor, occurredAt, description, fundId?, competitionId?, counterpartyName?, attachmentFileAssetId }` / `{ entryId, reason }` | FINANCE | §8.6.2 |
| `upsertLedgerCategory` / `upsertBudget` / `approveBudget` | Category or budget fields / `{ budgetId }` | FINANCE / FINANCE / STAFF_ADMIN | |
| `lockPeriod` / `reopenPeriod` / `requestPeriodPublish` / `approvePeriodPublish` | `{ month, reason? }` | FINANCE / SUPER_ADMIN / FINANCE / a different FINANCE or STAFF_ADMIN user | §8.6.4 |
| `uploadFinancialReport` / `submitFinancialReport` / `publishFinancialReport` / `withdrawFinancialReport` | Report fields / `{ reportId, reason? }` | FINANCE; the publisher must differ from the uploader | §8.7 |

### 8.10 Domain Events (Outbox; §10 maps them to templates, §11 consumes all)

Payloads carry ids, amounts and codes only, never PAN, addresses or contact details.

- **Payments:** `payment.captured`, `payment.failed`, `payment.refunded` (§8.3 payloads; payer and §6). `refund.failed` and `reconciliation.issueFound` (FINANCE).
- **Donations:** `donation.captured` (thank-you message only, no attachment), `donation.receiptIssued` (after the PDF renders; signed download link valid 7 days), `donation.refunded`, `recurringDonation.activated`, `recurringDonation.charged` (each successful charge), `recurringDonation.chargeFailed`, `recurringDonation.halted` (donor and FINANCE), `recurringDonation.paused`, `recurringDonation.resumed`, `recurringDonation.cancelled`.
- **Bids:** `bid.placed` (analytics only), `bid.outbid { lotCode, currentBidMinor, minNextMinor }` (previous leader).
- **Lots:** `lot.scheduled`, `lot.opened`, `lot.extended`, `lot.won` (winner), `lot.closed` (other bidders), `lot.unsold` (bidders, "reserve not met" variant), `lot.paymentOverdue` (winner and AUCTION_MANAGER), `lot.secondChanceOffered`, `lot.paid` and `lot.sold` (buyer, AUCTION_MANAGER, FINANCE), `lot.acknowledged` (creator or guardian, institution coordinator), `lot.shipped` and `lot.delivered` (buyer), `lot.cancelled` (bidders, creator or guardian). Reminders are not emitted here: §10 handles them as `reminder.lotClosing` (T−1 h before close, to watchers and bidders) and `reminder.auctionPayment` (T−24 h and T−2 h before the payment deadline).
- **Finance:** `financialPeriod.locked`, `financialPeriod.published`, `financialReport.published`, `budget.thresholdExceeded`.

### 8.11 Security Notes

- **Amounts:** always computed server-side, from fee config, the validated donation choice or the hammer price. Client-sent prices, statuses and payment outcomes are never trusted; every capture is confirmed by `fetchPayment` or a verified webhook.
- **PCI:** card and UPI data only ever enter Razorpay Checkout, which keeps FOA in the minimal (SAQ-A-style) scope. No card data is logged or stored, and webhook payloads are redacted after 180 days. **Secrets** stay server-only (only `RAZORPAY_KEY_ID` reaches the client). Live keys (`rzp_live_`) refuse to load unless `APP_ENV=production`.
- **Webhook route:** raw body, HMAC with constant-time compare, rate-limited, outside CSRF protection, no session. Server actions keep framework CSRF protection.
- **PAN:** app-level AES-256-GCM envelope encryption with the key from the secret store (§13). The UI shows only the last 4 characters, and every decrypt (export, receipt render) is AuditLogged.
- **Files:** receipts, letters and ledger attachments live in the private bucket behind signed URLs issued after an owner or role check. Guest tokens are 32 random bytes, stored hashed, valid for 7 days.
- **Separation of duties:** four-eyes control on large refunds, period publishing, report publishing and budget approval. Staff roles require 2FA (§4). AUCTION_MANAGER and FINANCE can't bid.
- **Integrity:** the ledger is immutable at the DB level. Receipt numbers come from a locked sequence row. Bids use row locks and the DB clock. Idempotency keys apply to webhooks, bids, checkouts and ledger postings.
- **Abuse:** bid and checkout rate limits. A shill-bidding report flags shared IP hashes and creator relatives among a lot's bidders.

### 8.12 Edge Cases

| Case | Required behaviour |
|---|---|
| Webhook arrives before the Checkout redirect | The webhook captures. `confirmCheckoutReturn` finds CAPTURED and returns it with no second posting |
| Redirect arrives but the webhook never does | Signature check plus `fetchPayment` captures. The later webhook is a no-op. `healPending` covers a lost redirect too |
| Duplicate webhook, or `payment.captured` plus `order.paid` | Same event id: unique constraint, 200 no-op. Different ids: the state guard makes it a no-op, and the ledger idempotency key prevents a double posting |
| Out-of-order events, or captured amount ≠ order amount | Fetch from the provider and apply the missing transitions in order / no capture, CRITICAL issue, FINANCE refunds |
| A bid in the last second | Accepted only if DB `now() < closesAt` under the row lock. The close moves out by `antiSnipeExtendSec`. The close job re-checks under the same lock and reschedules |
| Winner doesn't pay | Reminders, then an overdue strike, then second-chance offers (max 2), then CLOSED_UNSOLD, then an optional relist. The defaulter's late capture is auto-refunded |
| Consent withdrawn after listing, before close or payment | §12's `consent.withdrawn` (AUCTION_OF_ARTWORK or PUBLIC_DISPLAY) → `cancelLot` within one job cycle. Bidders and the guardian are notified. Artwork → `statusBeforeListing` (`setAuctionState`). An in-flight capture is auto-refunded. After PAID the sale stands per the terms; only the credit can switch to ANONYMOUS |
| Partial refund of a registration-fee batch | §8.3: amount = sum of the listed `RegistrationPaymentBatchItem`s, requested by COMPETITION_MANAGER or STAFF_ADMIN and approved by FINANCE, cumulative-sum guard, PARTIALLY_REFUNDED, negative REGISTRATION_FEES posting, `lineRefs` returned to §6 |
| Refund of a donation in a PUBLISHED month | The receipt is marked cancelled. The reversal lands in the next OPEN month with `lateAdjustment` |
| Two tabs pay the same registration / a subscription charge races a cancel | Second capture: §6 puts the batch in NEEDS_REVIEW and emits `registration.paymentNeedsReview`, with no automatic refund; any refund is requested by COMPETITION_MANAGER or STAFF_ADMIN and approved by FINANCE / record the donation with a receipt (the money is real), and FINANCE refunds on request |

### 8.13 Acceptance Criteria

1. A webhook with a bad signature returns 400 and creates no rows. The same valid event delivered 3× produces exactly one transition, one LedgerEntry and one Outbox event. Capture works with the webhook only, the redirect only, and both in either order, each yielding one CAPTURED Payment and one posting.
2. A provider amount that differs from `Payment.amountMinor` never captures and opens a CRITICAL issue. No server action accepts a price for a registration or lot from the client. The app refuses to start with `rzp_live_` keys when `APP_ENV≠production`.
3. Unit tests cover every allowed and every disallowed transition of the Payment, Refund, Donation, RecurringDonation, AuctionLot, FinancialPeriod and FinancialReport machines.
4. Refunding 3 of 20 items in a `RegistrationPaymentBatch` gives PARTIALLY_REFUNDED, `refundedMinor` = the sum of the 3 items, a matching negative posting and `payment.refunded` with 3 `lineRefs`. Refunds beyond the remaining amount are rejected. A refund above the threshold can't be approved by its requester.
5. 100 concurrent captures in one FY get receipt numbers `000001`–`000100` with no gaps or duplicates. Failed and abandoned payments consume none. 31 Mar 23:59 IST → FY `2627`; 1 Apr 00:01 IST → `2728-000001`.
6. With `org.has80G=false`, `/donate` shows no PAN fields and receipts have no tax section; setting it to `true` shows both without a deploy. A guest ONE_TIME donation completes without an account. MONTHLY without a session is rejected. A signed-in minor can't donate.
7. An organisation donation with no disclosure choice fails validation. ANONYMOUS organisations and non-opted-in individuals never appear on `/transparency`; DISCLOSED ones do. An international capture with FCRA off is auto-refunded in full; the donation ends REFUNDED with no receipt number.
8. Recurring with FakePaymentProvider: two `subscription.charged` → two donations and two receipts. `pending` → PAST_DUE plus notification. `halted` → HALTED. A dashboard cancel calls `cancelSubscription`.
9. `createLot` fails with a distinct error code for each of: artwork status not in {VERIFIED, IN_EXHIBITION, RETAINED}, `auctionCandidate=false`, `allowAuction=false`, missing AUCTION_OF_ARTWORK consent, minor without guardian consent. A minor whose consent says FULL_NAME gets a FIRST_NAME_INITIAL lot. No public API or page exposes the creator's DOB, exact age, or the reserve amount.
10. Users without a verified phone, without accepted terms, under 18, suspended, or holding FINANCE or AUCTION_MANAGER can't bid.
11. 50 concurrent equal bids on one lot: exactly 1 accepted, 49 `BID_TOO_LOW`; the current price always equals the resolved highest VALID bid. A bid 30s before close sets `closesAt = now + 120s`. A bid at or after `closesAt` (DB time) gets `LOT_CLOSED`. The close job never closes a lot whose close was extended.
12. Proxy: A sets max ₹5,000, B bids ₹3,000 → A leads at ₹3,000 + increment. B bids ₹6,000 → B leads at ₹6,000 and A gets `bid.outbid`.
13. Reserve not met → CLOSED_UNSOLD and artwork → `statusBeforeListing`. A non-paying winner gets a strike after 72h and the next bidder gets a second-chance offer. The defaulter's later payment is auto-refunded (`LATE_CAPTURE`).
14. Consent withdrawal on a LIVE lot cancels it, notifies bidders and reverts the artwork. The same withdrawal after PAID leaves the sale intact.
15. PAID sets the artwork to SOLD, posts `AUCTION_PROCEEDS`, creates payouts per the snapshot, and issues an acknowledgement letter that names the buyer only if `shareNameWithArtist`.
16. UPDATE or DELETE on `LedgerEntry` fails at the DB level. A reversal nets to zero. A manual EXPENSE without an attachment, or a manual posting into a LOCKED month, is rejected.
17. `/transparency` reflects only PUBLISHED months. Self-approval of a period or report publish is rejected. An automated test asserts the snapshot JSON contains no email, phone, PAN or payment-id patterns.
18. Budget-vs-actual figures equal the ledger sums per category, and the CSV export of the same range sums to the same totals. Reconciliation turns a provider-captured, DB-CREATED payment into CAPTURED with an INFO issue and posts its gateway fee.

### 8.14 Open Questions (this section)

1. **80G / 12A / CSR-1 status.** Default applied: `org.has80G=false`. No PAN capture, generic donation receipts, Form 10BD export dormant. Templates and the config switch are ready.
2. **FCRA registration.** Default: `org.fcraEnabled=false`. INR and domestic methods only, citizenship declaration, international payments auto-refunded. FCRA mode is specified but not built.
3. **Auction proceeds split.** Default: 100% to FOA (`foaBps=10000`) for every competition, with creator and school recognised by an acknowledgement letter. Configurable per competition; payouts go to the guardian's or the school's account.
4. **Can minors' artwork be auctioned at all?** Default: yes, but only with guardian-given AUCTION_OF_ARTWORK consent plus GUARDIAN_VERIFIED, credit capped at FIRST_NAME_INITIAL, and copyright kept by the creator. Turning it off means one guard flag that blocks under-18 creators.
5. **Recurring donation default.** Default: ONE_TIME preselected, MONTHLY offered. Monthly is capped at ₹15,000, gets a receipt per charge, and requires an account.
6. **GST on registration fees and auction sales.** Default: no GST invoices; amounts are final. FOA's accountant must confirm before go-live.
7. **Auction logistics.** Default: India-only shipping, FOA absorbs the cost (`INCLUDED`), 72h payment window, up to 2 second-chance offers at the bidder's own highest bid.
8. **Disclosure depth on `/transparency`.** Default: DISCLOSED organisations with FY totals, individuals by name only, budgets hidden.

## 9. Community, Content & Animal-Welfare Ecosystem

This section owns modules 1, 2, 6–10, 13, 15–17 and 25–27, plus `EngagementMilestone` and `EngagementService` (§3.5). Other sections own these pieces:
- **§7:** stamped social exports and `/admin/social`.
- **§11:** computing the impact counters.
- **§12:** consent, safeguarding, clearance, and the minor-protection rules. Where §12 and this section differ, §12 wins.

Every status change follows §0: service → policy → the transition tables below → `AuditLog` → an `Outbox` event (§9.13).

### 9.1 Scope, Flags, Config & Dependencies

| Sub-module | Milestone (§14) | `FeatureFlag` (§13.8) |
|---|---|---|
| CMS pages (About, Impact, Awareness hub, legal), Posts/blog, awareness resources, Home, Contact + inbox, editorial calendar | M5 (MVP) | none |
| Engagement records and timeline, community membership, post-competition invitations, adult member profiles, story submissions | M6 | `COMMUNITY` (new) |
| Events & campaigns; volunteers; clubs; ambassadors | M6 | `EVENTS`; `VOLUNTEERS`; `CLUBS` (new); `AMBASSADORS` (new) |
| NGO/animal-welfare directory, then adoption (adoption needs verified orgs) | M7 | `NGO_DIRECTORY`, `ADOPTION` |

**When a flag is off:** routes return 404, nav links are hidden, actions return `FEATURE_DISABLED`, and invitations leave that item out.

**M6 launch backfill.** Engagement consumers are idempotent. At M6 launch, run `pnpm engagement:backfill`, then run `community.postCompetitionInvites` for every competition already in RESULTS_PUBLISHED, so the pilot cohort gets its history and invitations.

**Config** lives in the `Setting` table (§12/§13; SUPER_ADMIN, audited). Defaults:

```
content.fourEyes=true  contact.rateLimit={perIpPerHour:5,perEmailPerDay:5}  community.inviteDelayHours=24
volunteer.minAge=14  club.maxStudentLeaders=3  club.vacancyAutoCloseDays=90  ambassador.eligibility=(§9.7.5)
directory.reverifyDays=365  directory.defaultRadiusKm=25  directory.maxRadiusKm=200  directory.maxActiveListingsIndividual=10
adoption.minApplicantAge=18  adoption.maxActiveApplicationsPerApplicant=3  adoption.followUpDays=[30,90]  adoption.handlerSlaDays=7
adoption.listingReconfirmDays=30  adoption.listingStaleHideDays=45  adoption.inactiveAutoCloseDays=60
```

**Requests to other sections** (assumed accepted):
- **§7:** `CertificateType.VOLUNTEER_SERVICE`, `GalleryQuery.featured(limit)`, event `certificate.revoked`.
- **§6:** events `institutionMember.removed {institutionId, userId}`, `entry.disqualified`, `entry.withdrawn`.
- **§8:** `DonationQuery.totalForFund(fundId, since?)`.
- **§11:** implement the counter definitions in §9.4.5, and add `communityMembers`, `volunteerHours`, `eventAttendees`.
- **§13:** add flags `COMMUNITY`, `CLUBS`, `AMBASSADORS`.
- **§10:** templates for §9.13. Event names here follow §10's camelCase proposals.
- **§12:** no new consent types are needed. This section uses `GUARDIAN_VERIFIED`, `COMMUNICATION`, `PUBLIC_DISPLAY`, `SOCIAL_MEDIA`, `PARTICIPANT_PHOTO_VIDEO`, `SafeguardingService.assertCleared`, `ModerationReview` and the `/safeguarding` form.

**Age resolution.** `isAdult(userId)` means age ≥ 18 (§12 `MAJORITY_AGE`). The DOB comes from the user's own `ParticipantProfile.dateOfBirth`, or else from `MemberProfile.dateOfBirth`, which is declared and required before any age-gated action. When both exist, the ParticipantProfile value wins. If no DOB is known, the user is prompted and treated as a minor until they answer.

**New codes** (extend §3.1, Crockford base32):

| Field | Format |
|---|---|
| `Organization.orgCode` | `FOA-O-{5}` |
| `AdoptableAnimal.listingCode` | `FOA-AN-{YY}{6}` |
| `AdoptionApplication.applicationCode` | `FOA-AA-{YY}{6}` |
| `ContactMessage.ticketCode` | `FOA-T-{YY}{6}` |

`EventRegistration.checkInToken` is a 128-bit random base64url string.

### 9.2 Section Enums

```ts
enum ContentStatus { DRAFT, IN_REVIEW, SCHEDULED, PUBLISHED, ARCHIVED } // shared by Page, Post, AwarenessResource (one workflow; deliberate naming exception)
enum PageTemplate { STANDARD, HOME, ABOUT, IMPACT, AWARENESS_HUB, LEGAL }   enum AwarenessResourceKind { ARTICLE, DOWNLOAD, VIDEO, LESSON_PLAN }
enum AgeBand { AGE_5_8, AGE_9_12, AGE_13_17, AGE_18_PLUS, EDUCATORS }
enum ContactTopic { GENERAL, SCHOOLS, NGOS, ADOPTION, VOLUNTEERING, DONATIONS, MEDIA }   enum ContactMessageStatus { NEW, OPEN, RESOLVED, SPAM }
enum EditorialChannel { WEBSITE, INSTAGRAM, FACEBOOK, X, YOUTUBE, LINKEDIN, WHATSAPP, EMAIL }
enum EditorialItemStatus { IDEA, DRAFTING, IN_REVIEW, APPROVED, PUBLISHED, CANCELLED }
enum EventType { EVENT, WORKSHOP, WEBINAR, CAMPAIGN, DRIVE }   enum EventMode { ONLINE, VENUE, HYBRID }   enum EventStatus { DRAFT, PUBLISHED, CANCELLED, COMPLETED }
enum EventRegistrationStatus { CONFIRMED, WAITLISTED, CANCELLED, ATTENDED, NO_SHOW }
enum CampaignStatus { DRAFT, ACTIVE, ENDED, ARCHIVED }   enum CampaignGoalType { PLEDGES, PARTICIPANTS, FUNDS }
enum EngagementKind { MILESTONE, REGISTERED, ENTRY_SUBMITTED, CERTIFICATE_EARNED, EVENT_ATTENDED, CAMPAIGN_PLEDGED, VOLUNTEER_HOURS, CLUB_JOINED, STORY_PUBLISHED }
enum CommunityMembershipStatus { PENDING_GUARDIAN, ACTIVE, LEFT, SUSPENDED }
enum ClubStatus { PENDING_ADVISOR, PENDING_APPROVAL, ACTIVE, ADVISOR_VACANT, REJECTED, CLOSED }
enum ClubRole { MEMBER, STUDENT_LEADER }   enum ClubMemberStatus { PENDING_ADVISOR, ACTIVE, LEFT, REMOVED }
enum AmbassadorNominationStatus { SUBMITTED, APPROVED, REJECTED, WITHDRAWN }   enum AmbassadorStatus { ACTIVE, EXPIRED, REVOKED }
enum VolunteerSkill { TECHNOLOGY, CONTENT_CREATION, OUTREACH, COMPETITION_MANAGEMENT, SOCIAL_MEDIA, COMMUNITY_BUILDING, EVENTS, ANIMAL_CARE, OTHER }
enum VolunteerApplicationStatus { SUBMITTED, SCREENING, INTERVIEW, APPROVED, REJECTED, WITHDRAWN }   enum VolunteerProfileStatus { ACTIVE, PAUSED, REMOVED }
enum VolunteerOpportunityStatus { DRAFT, OPEN, FILLED, CLOSED, CANCELLED }   enum VolunteerHourLogStatus { SUBMITTED, APPROVED, REJECTED }
enum VolunteerAssignmentStatus { INTERESTED, ASSIGNED, DECLINED, WITHDRAWN, COMPLETED, NO_SHOW }
enum OrganizationType { NGO, RESCUE_ORGANIZATION, SHELTER, INDEPENDENT_RESCUER, FOSTER_CAREGIVER, VETERINARY_CLINIC }
enum OrganizationStatus { PENDING_VERIFICATION, VERIFIED, REJECTED, VERIFICATION_EXPIRED, SUSPENDED }
enum OrgServiceKind { RESCUE, SHELTER, ADOPTION, FOSTERING, VETERINARY_CARE, STERILIZATION_ABC, VACCINATION, FEEDING, AMBULANCE, CRUELTY_RESPONSE, WILDLIFE_RESCUE, EDUCATION }
enum Species { DOG, CAT, BIRD, CATTLE, EQUINE, RABBIT, SMALL_MAMMAL, REPTILE, WILDLIFE, OTHER }
enum ContactVisibility { PUBLIC, RELAY_ONLY }   // RELAY_ONLY: "Contact via FOA" relay form; details never rendered
enum ListingReportReason { INCORRECT_INFO, UNREACHABLE_OR_CLOSED, DUPLICATE, FRAUD_SUSPECTED, WELFARE_CONCERN, OTHER }   enum ListingReportStatus { OPEN, RESOLVED, DISMISSED }
enum AdoptableAnimalStatus { DRAFT, AVAILABLE, ON_HOLD, ADOPTED, WITHDRAWN }
enum AdoptionApplicationStatus { SUBMITTED, UNDER_REVIEW, HOME_CHECK, APPROVED, COMPLETED, REJECTED, WITHDRAWN }
enum TriState { YES, NO, UNKNOWN }   enum AnimalSex { MALE, FEMALE, UNKNOWN }   enum AnimalSize { SMALL, MEDIUM, LARGE, XLARGE }
```

### 9.3 Permissions (refines §4.2)

| Capability | Public | Member | Participant / Guardian | ORG_REP | VOLUNTEER | CONTENT_MANAGER | COMMUNITY_MANAGER | ADOPTION_COORDINATOR | STAFF_ADMIN |
|---|---|---|---|---|---|---|---|---|---|
| Read published content, events, directory, listings | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Contact form, report a listing | ✓ | ✓ | ✓ | ✓ | ✓ | | | | |
| Draft pages, posts, awareness, editorial items | | | | | | ✓ | | | ✓ |
| Approve/publish content (approver ≠ last editor; LEGAL template: STAFF_ADMIN only) | | | | | | ✓ | | | ✓ |
| Contact inbox (by topic) | | | | | | MEDIA | NGOS, VOLUNTEERING | ADOPTION | all |
| Manage events and campaigns; QR check-in | | | | | check-in only (assigned and cleared) | | ✓ | | ✓ |
| Register for events, pledge, join the community, submit a story | | ✓ | ✓ (guardian acts for linked minors) | | | | | | |
| Approve clubs, ambassadors, volunteers, hours | | | | | | | ✓ | | ✓ |
| Verify or suspend organizations; resolve listing reports | | | | | | | ✓ | ✓ (animal listings) | ✓ |
| Register an organization (adult, verified phone) | | ✓ | ✓ | | | | | | |
| Edit own org; list animals; handle own applications (org VERIFIED) | | | | ✓ | | | | | |
| FOA listings; all applications; questionnaires | | | | | | | | ✓ | ✓ |
| Apply to adopt (adult) / volunteer (age ≥ 14) | | ✓ | ✓ | | | | | | |
| View an engagement timeline | | own | own + linked minors | | | | ✓ | | ✓ |

**Inbox routing for the remaining topics:** SCHOOLS → COMPETITION_MANAGER, DONATIONS → FINANCE, GENERAL → STAFF_ADMIN.

**Clearance.** Staff who see minors' PII must pass `SafeguardingService.assertCleared` (§12.9). Institution roles act on clubs as described in §9.7.4.

### 9.4 CMS & Public Content (M5)

#### 9.4.1 Models

```prisma
model Page { id, slug String, locale String @default("en-IN"), systemKey String? /* home|about|impact|awareness|privacy|terms|safeguarding|child-protection-policy|adoption-terms|directory-terms */,
  template PageTemplate, title, body Json /* Block[] */, seoTitle?, seoDescription?, ogImageAssetId?, noIndex Boolean @default(false),
  status ContentStatus, publishAt DateTime?, publishedAt?, publishedRevisionId?, pendingRevisionId?, lastEditedById, approvedById?, deletedAt?
  @@unique([slug, locale]) @@unique([systemKey, locale]) }
model Post { id, slug, locale, title, excerpt /* ≤300 */, body Json, coverAssetId, coverAlt, categoryId, tags Tag[], authorUserId, bylineName,
  relatedCompetitionId?, relatedEventId?, relatedCampaignId?, featured Boolean @default(false), sourceStoryId?, /* seo, status, publish, revision fields as Page */
  searchVector Unsupported("tsvector") /* generated: title A, excerpt B, body text C */  @@unique([slug, locale]) }
model PostCategory { id, slug @unique, name, sortOrder Int }   // seed: news, stories, blog, community-stories, impact
model Tag { id, slug @unique, name }
model AwarenessResource { id, slug, locale, kind AwarenessResourceKind, title, summary, body Json?, fileAssetId? /* PDF ≤25 MB, private bucket */,
  videoUrl? /* YouTube/Vimeo */, ageBands AgeBand[], species Species[], institutionsOnly Boolean @default(false), downloadCount Int @default(0),
  /* seo, status, publish, revision fields as Page */ }
model ContentRevision { id, contentType PAGE|POST|AWARENESS, contentId, version Int, snapshot Json, editorUserId, createdAt }
model StorySubmission { id, submittedByUserId, subjectParticipantId?, title, body /* ≤5000 */, photoAssetIds String[] /* ≤5 */,
  status SUBMITTED|ACCEPTED|DECLINED, moderationReviewId?, reviewedById?, declineReason?, postId?, createdAt }
```

**Block bodies.** `Block` is a zod discriminated union over: `richText{html}`, `heading`, `image{assetId,alt,caption?}`, `gallery`, `quote`, `callout`, `cta{label,href}`, `embed{provider:YOUTUBE|VIMEO,url}`, `faq`, `impactCounters{keys[]}`, `competitionList{statuses[],limit}`, `eventList`, `postList{categorySlug?,limit}`, `downloadList{resourceIds[]}`, `homeLayout` (HOME template only).
- `html` goes through the §3.2 sanitizer on save and again on render.
- Images must be public WEB derivatives, and `alt` is required.
- Unknown block types are rejected on save and skipped on render.
- Every save writes a `ContentRevision`. Editing PUBLISHED content creates a `pendingRevisionId`; the site keeps rendering `publishedRevisionId` until the pending revision is approved, and the status stays PUBLISHED.
- Content is per locale, falling back to `en-IN` (§13).

#### 9.4.2 Content Workflow (Page, Post, AwarenessResource)

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| (new) → DRAFT | CONTENT_MANAGER, STAFF_ADMIN | slug matches `^[a-z0-9-]{3,80}$`, unique per locale | revision v1 |
| DRAFT → IN_REVIEW | editor | title, ≥1 block, `seoDescription`; Post also needs cover + alt + category | `content.submitted` → approvers |
| IN_REVIEW → DRAFT | approver | comment required | `content.changesRequested` |
| IN_REVIEW → PUBLISHED | approver | approver ≠ `lastEditedById` when `content.fourEyes`; LEGAL template: STAFF_ADMIN only | set `publishedAt` and `publishedRevisionId`; cache tags revalidated (§2.2); `content.published` |
| IN_REVIEW → SCHEDULED | approver | same guards, and `publishAt` ≥ now + 5 min | job enqueued at `publishAt` |
| SCHEDULED → PUBLISHED | system job | revision unchanged since approval (if changed → IN_REVIEW) | as for PUBLISHED |
| SCHEDULED → DRAFT | editor or approver | none | job cancelled |
| PUBLISHED → ARCHIVED | approver | pages with a `systemKey` cannot be archived | removed from lists, search and sitemap; URL returns 410 |
| ARCHIVED → DRAFT | editor | none | none |

**Legal pages.** `/privacy`, `/terms`, `/safeguarding` and `/child-protection-policy` (routes owned by §12) are LEGAL-template Pages. Text that users consent to stays in §12's `ConsentDocument`, and the page links to it. `adoption-terms` and `directory-terms` are LEGAL Pages that §9 owns. When a user accepts one, the system stores its `publishedRevisionId`.

#### 9.4.3 Home and Public Pages

Home is `Page(systemKey='home', template=HOME)`. It has a single `homeLayout` block containing:
- `hero {heading, subheading, imageAssetId, alt, primaryCta, secondaryCta?}`
- `announcement? {text, href, expiresAt}`
- `counterKeys` (4 keys from §9.4.5)
- an ordered `sections` list with a visibility toggle per section.

Home edits go through §9.4.2. The page is cached with `cacheTag` (`home`, `posts`, `competitions`, `gallery`, `events`, `impact`), revalidated on those tags (§2.2), with `cacheLife({ revalidate: 300 })` as the fallback.

| Section | Source | Rules |
|---|---|---|
| Hero (+ announcement bar) | `homeLayout` | announcement hidden after `expiresAt` |
| Live & upcoming competitions | §6 `Competition` in PUBLISHED, REGISTRATION_OPEN, REGISTRATION_CLOSED, IN_PROGRESS | REGISTRATION_OPEN first, by registration close ascending; max 3; section hidden if none |
| Featured gallery | §7 `GalleryQuery.featured(8)` | stamped derivatives and only the fields §7/§12.7 allow |
| Impact counters | §11 `/api/v1/impact`, keys from `counterKeys` | counters §11 suppresses are skipped |
| Latest stories | `Post` PUBLISHED | featured first, then `publishedAt` descending; 3 items |
| Donate CTA | copy plus link to `/donate` (§8) | progress bar shown if an ACTIVE `Campaign` has a `fundId` |
| Upcoming events | `Event` PUBLISHED, `startsAt` > now | max 3; only when `EVENTS` is on |

Other public pages:
- **`/about`:** the ABOUT Page.
- **`/awareness`:** the AWARENESS_HUB Page plus resources filtered by `ageBand`, `kind`, `species` and `locale`.
- **`/awareness/[slug]/download`:** checks access (`institutionsOnly` needs an INSTITUTION_ADMIN or INSTITUTION_COORDINATOR role), increments `downloadCount`, then 302s to a 10-minute signed URL.
- **`/blog`:** filters by category and tag, `?q=` full-text search on `searchVector`, 12 per page, and `/blog/rss.xml`.
- **Related posts:** §6 shows Posts whose `relatedCompetitionId` matches on the competition page.

#### 9.4.4 Contact Us

```prisma
model ContactMessage { id, ticketCode @unique, topic ContactTopic, name, email, phone?, organizationName?, subject /* ≤150 */, message /* ≤5000 */,
  userId?, status ContactMessageStatus, assignedToUserId?, spamReason?, ipHash /* sha256(ip + secret) */, userAgent, createdAt, firstRespondedAt?, resolvedAt? }
model ContactNote { id, messageId, authorUserId, kind INTERNAL|REPLY_SENT, body, createdAt }
```

- **Safeguarding concerns** never use this form. The topic picker's "Safeguarding concern" option routes to §12's `/safeguarding` form, and no `ContactMessage` is stored.
- **Spam protection.** §13 public-form protection applies (Turnstile, honeypot, 10/min per IP), plus `contact.rateLimit` by IP hash and by email (429 when exceeded). Submissions made < 3 s after render are rejected. A message with more than 3 URLs or a blocklisted term becomes SPAM; SPAM is purged after 30 days.
- **Lifecycle.** NEW → OPEN (on assignment or first reply) → RESOLVED, with RESOLVED → OPEN to reopen. NEW/OPEN → SPAM, and SPAM → NEW to undo.
- **Notifications and replies.** The sender gets `contactMessage.received` with the `ticketCode`. Replies go out through §10 email with Reply-To set to the shared mailbox. Inbound replies are not parsed.
- **Inbox** (`/admin/inbox`): filters by topic, status and assignee; SLA badge with a first-response target of 2 business days. Messages are purged after 24 months.

#### 9.4.5 Impact Metrics

§11 computes the counters (MVs) and applies suppression: counters < 10 are omitted, and values ≥ 10 are floored to 10 and shown as "1,240+". This section defines what each counter means, and §11 MUST implement these definitions. Soft-deleted rows are always excluded.

| §11 counter | Definition |
|---|---|
| `participants` | distinct `ParticipantProfile` with ≥1 confirmed §6 registration |
| `institutions` | VERIFIED `Institution` with ≥1 confirmed `InstitutionRegistration` |
| `competitions` | `Competition` in RESULTS_PUBLISHED or ARCHIVED |
| `statesReached` | distinct `state` over the counted participants |
| `artworksShowcased` / `certificatesIssued` | items live in §7's public gallery / non-revoked `Certificate` |
| `volunteers` / `volunteerHours`* | `VolunteerProfile` ACTIVE / floor(Σ APPROVED `VolunteerHourLog.minutes` / 60) |
| `ngosListed` / `adoptionsFacilitated` | `Organization` VERIFIED / `AdoptableAnimal` ADOPTED with `adoptedViaPlatform = true` |
| `communityMembers`* / `eventAttendees`* | `CommunityMembership` ACTIVE / `EventRegistration` ATTENDED |
| `fundsRaisedMinor` | Σ ledger INCOME in the donation categories over PUBLISHED months, read from §8's `TransparencySnapshot` (the same figure as the `/transparency` donations total) |

\* New counters requested from §11.

**Manual overrides** are §11 `ImpactAdjustment` rows (delta + note, audited), entered by STAFF_ADMIN in `/admin/content/impact`. That screen shows the computed value and the adjusted value side by side, so figures are never hand-typed.

**`/impact` page.** It is the IMPACT Page with an `impactCounters` block. The methodology footnote is generated from the table above and shows "as of {asOf}", plus "includes offline activity" whenever a shown counter has an adjustment. Counters for flag-disabled modules are hidden.

#### 9.4.6 Story Submissions (M6, `COMMUNITY`)

Stories are the only member-generated text that can become public.
1. A member submits a story, or a guardian submits one about a linked minor.
2. The system creates a §12.8 `ModerationReview`. Its checklist includes:
   - `PUBLIC_DISPLAY` for any participant named.
   - `PARTICIPANT_PHOTO_VIDEO` for any participant pictured.
   - no third-party faces or PII.
3. Once the review is APPROVED, a CONTENT_MANAGER accepts the story. This creates a Post DRAFT in the `community-stories` category with `sourceStoryId` set. The byline follows §12.7 display rules, and the Post then goes through §9.4.2.
4. Photos are stripped of EXIF/GPS. If declined, the submitter is told the reason.

### 9.5 Editorial Calendar (module 27, M5)

```prisma
model EditorialItem { id, title, channel EditorialChannel, plannedAt DateTime, ownerUserId, status EditorialItemStatus, caption?, hashtags String[],
  postId?, socialExportIds String[] /* §7 stamped exports */, assetIds String[], competitionId?, eventId?, campaignId?,
  approvedById?, approvedAt?, publishedAt?, publishedUrl?, reach Int?, engagements Int?, notes?, createdAt }
```

**Lifecycle.** IDEA → DRAFTING → IN_REVIEW → APPROVED → PUBLISHED. IN_REVIEW → DRAFTING sends an item back for changes, and any status except PUBLISHED can go to CANCELLED. The approver must differ from the owner when `content.fourEyes` is on.

**Participant artwork.** An item that depicts participant artwork MUST use §7 stamped exports. Before APPROVED and again before PUBLISHED, each depicted participant must pass `ConsentService.has(participantId, 'SOCIAL_MEDIA', competitionId)` and `has(…, 'PUBLIC_DISPLAY', competitionId)`. If either fails, the transition is blocked and the owner is alerted.

**Publishing.** WEBSITE items publish automatically when their Post does. Other channels are posted manually, unless §7's `SOCIAL_PUBLISHING` covers them. Staff then call `markEditorialPublished` with the URL, and later with `reach`/`engagements`, which feed §11.

**UI** (`/admin/content/calendar`): month, week and list views, filtered by channel, owner, status and campaign. Unpublished items can be dragged to reschedule. Overdue items are highlighted.

### 9.6 Events & Campaigns (module 15, M6, `EVENTS`)

```prisma
model Event { id, slug @unique, type EventType, title, summary, body Json, coverAssetId, mode EventMode, venueName?, address?, city?, state?, pinCode?,
  lat Float?, lng Float?, onlineJoinUrl? /* CONFIRMED registrants only */, startsAt, endsAt, registrationOpensAt, registrationClosesAt,
  capacity Int? /* seats; null = unlimited */, waitlistEnabled Boolean @default(true), minAge Int?, maxAge Int?, guardianMustAttend Boolean @default(false),
  audience PUBLIC|MEMBERS|INSTITUTION|CLUB, institutionId?, clubId?, organizerOrgId?, campaignId?, status EventStatus, cancelledReason?, createdById, publishedAt? }
model EventRegistration { id, eventId, registrantUserId, attendeeKey /* 'U:'+userId | 'P:'+participantProfileId */, attendeeUserId?, attendeeParticipantId?,
  attendeeName, seats Int @default(1), status EventRegistrationStatus, waitlistPosition Int?, checkInToken String @unique, checkedInAt?, checkedInById?,
  noPhoto Boolean /* no PARTICIPANT_PHOTO_VIDEO for this event */, createdAt, cancelledAt?  @@unique([eventId, attendeeKey]) }
model EventMedia { id, eventId, fileAssetId, caption?, taggedParticipantIds String[], status DRAFT|PUBLISHED|WITHDRAWN, moderationReviewId }
model Campaign { id, slug @unique, title, summary, body Json, coverAssetId, startsAt, endsAt, goalType CampaignGoalType, goalTarget Int, pledgeText?,
  fundId? /* §8 */, status CampaignStatus, createdById }
model CampaignPledge { id, campaignId, pledgerKey, userId?, participantId?, showOnWall Boolean, wallName?, city?, createdAt  @@unique([campaignId, pledgerKey]) }
```

An Event of type CAMPAIGN or DRIVE is a dated activity, such as an adoption drive. It may link to a `Campaign`, which holds the goal and the pledges.

**Registration rules.**
- **Window:** `registrationOpensAt ≤ now < min(registrationClosesAt, startsAt)`.
- **Audience:** MEMBERS needs an ACTIVE membership; INSTITUTION needs a matching `institutionId`; CLUB needs an ACTIVE `ClubMember`.
- **Age:** the attendee's age at `startsAt` must fall within [minAge, maxAge].
- **Minors:** a minor attendee is registered only by a linked guardian (`GUARDIAN_VERIFIED`), or by the coordinator for INSTITUTION events. A minor's own login shows "ask your guardian". If `guardianMustAttend` is set, `seats = 2`.

**Capacity and waitlist.**
- Registration locks the Event row (`SELECT … FOR UPDATE`). If CONFIRMED + ATTENDED seats plus the new seats fit within `capacity`, the registration is CONFIRMED. Otherwise it is WAITLISTED, or rejected with `EVENT_FULL` when the waitlist is off.
- Capacity can never be set below the seats already confirmed.
- After a cancellation or a capacity increase, the waitlist is promoted in `waitlistPosition` order while seats fit, until `startsAt − 2h`. Each promotion emits `eventRegistration.promoted`.
- Anything still WAITLISTED at `startsAt` becomes CANCELLED.

**Check-in.**
- The ticket's QR code encodes `https://{host}/admin/events/check-in?t={checkInToken}` and contains no PII.
- Scanning requires COMMUNITY_MANAGER, STAFF_ADMIN, or an assigned VOLUNTEER who passes `assertCleared` (attendee lists include minors).
- Check-in works from `startsAt − 2h` to `endsAt + 2h` and is idempotent; a re-scan shows the original time. Staff can also check in by name search.
- At `endsAt + 24h`, CONFIRMED registrations become NO_SHOW and the event becomes COMPLETED.

**Notifications.** Reminders go out 24 h and 2 h before the start (§10 `reminder.eventStarting`). A change of date or venue notifies all registrants. Cancelling the event cancels every CONFIRMED and WAITLISTED registration (`event.cancelled`). All events are free.

**Event media.** Media is published only after a §12.8 review. Every tagged participant needs `PARTICIPANT_PHOTO_VIDEO` with the `eventId` scope. Withdrawing that consent unpublishes the item within 24 h (§12.6).

**Campaigns.**
- **Activation and pledges:** `publishCampaign` sets the campaign ACTIVE. Pledges are accepted only between `startsAt` and `endsAt`, and a job sets ENDED afterwards. Pledging requires login; a minor pledges via a guardian.
- **Progress:** PLEDGES counts pledges. PARTICIPANTS counts pledges plus ATTENDED registrations at linked events. FUNDS uses `DonationQuery.totalForFund(fundId, startsAt)`.
- **Pledge wall:** shows only adults who set `showOnWall`. Minors are counted but never named.

### 9.7 Community & Engagement (M6)

#### 9.7.1 Engagement Records & `EngagementService`

```prisma
model EngagementRecord { id, subjectKey /* 'P:'+participantProfileId | 'U:'+userId */, participantProfileId?, userId?, kind EngagementKind,
  milestone EngagementMilestone?, sourceType String, sourceId String, occurredAt, meta Json?, revokedAt?, createdAt,
  dedupeKey String @unique /* `${subjectKey}|${kind}|${milestone ?? '-'}|${sourceType}|${sourceId}` */ }
model EngagementSummary { subjectKey @id, highestMilestone EngagementMilestone?, milestones EngagementMilestone[], competitionsCount Int,
  approvedVolunteerMinutes Int, eventsAttended Int, updatedAt }   // recomputed in the same transaction as every write/revoke
```

```ts
type Subject = { participantId: string } | { userId: string }
type Source  = { type: string; id: string; occurredAt?: Date; meta?: Json }
EngagementService.recordMilestone(subject, milestone: EngagementMilestone, source): Promise<{ created: boolean; firstTime: boolean }>
EngagementService.recordActivity(subject, kind: Exclude<EngagementKind,'MILESTONE'>, source): Promise<{ created: boolean }>
EngagementService.revokeBySource(sourceType, sourceId, reason): Promise<number>   // sets revokedAt, recomputes summaries
EngagementService.timeline(viewerUserId, subject, { cursor?, limit /* ≤50 */ }): Promise<TimelineItem[]>
EngagementService.summary(subject): Promise<EngagementSummary>
```

- **Idempotency.** Calls are idempotent on `dedupeKey`. `engagement.milestoneReached` is emitted only when `firstTime` is true.
- **Badges, not a ladder.** Milestones are independent badges, not a strict sequence: an individual-route participant can be FOA_FINALIST without ever being SCHOOL_WINNER. `highestMilestone` is the maximum in enum order.
- **Timeline merge.** A user's timeline merges their `U:` records with the `P:` records of profiles where `ParticipantProfile.userId` is that user. Guardians can view each linked child's timeline.
- **Visibility.** Only the subject, their guardian, COMMUNITY_MANAGER and STAFF_ADMIN can see a timeline. Nothing is public except badges on adult profiles.

**Wiring.** Outbox handlers in `server/jobs/engagement/`.

| Trigger (owner) | Record | Subject |
|---|---|---|
| `registration.confirmed` (§6) | MILESTONE `PARTICIPANT` + REGISTERED | participant |
| `entry.submitted` (§6) | ENTRY_SUBMITTED | participant |
| `certificate.issued` type `SCHOOL_MERIT` (§7) | MILESTONE `SCHOOL_WINNER` (source: Certificate) | participant |
| `certificate.issued`, any type (§7) | CERTIFICATE_EARNED | participant |
| `results.published` (§7): each Entry with status FINALIZED and `finalOutcome` ∈ {WINNER, RUNNER_UP, FINALIST, SPECIAL_MENTION} (not SPECIAL_MENTION on an ELIMINATED entry) | MILESTONE `FOA_FINALIST` (source: Entry) | participant |
| `certificate.revoked`, `entry.disqualified`, `entry.withdrawn` (§6/§7) | `revokeBySource` | n/a |
| `community.joined` / `volunteerApplication.statusChanged` (to APPROVED) / `ambassador.appointed` (§9) | MILESTONE `COMMUNITY_MEMBER` / `VOLUNTEER` / `AMBASSADOR` | member / user / user |
| `eventRegistration.checkedIn`, `campaign.pledged`, `volunteerHours.approved`, `club.memberAdded`, `content.published` with `sourceStoryId` (§9) | matching activity kind | attendee / pledger / volunteer / member / story subject |

#### 9.7.2 Membership & Member Profiles (`COMMUNITY`)

```prisma
model CommunityMembership { id, subjectKey @unique, userId?, participantProfileId?, joinedByUserId, status CommunityMembershipStatus,
  source INVITATION|SELF|EVENT|ADMIN, invitationId?, interests String[], city?, joinedAt?, leftAt? }
model MemberProfile { userId @id, displayName, dateOfBirth DateTime?, city?, bio? /* ≤500 */, avatarAssetId?,
  publicProfile Boolean @default(false), publicSlug String? @unique, showBadges Boolean @default(true) }
```

**Joining (login required).**
- Adults join directly and become ACTIVE.
- A minor's join request, made from their own login, is PENDING_GUARDIAN until the linked guardian approves in a guardian OTP session. A guardian can also join on a managed child's behalf.
- Activation for a minor requires `COMMUNICATION` granted by the guardian (§12.4). The guardian receives all engagement messages.
- On activation, `community.joined` is emitted.

**Leaving** sets LEFT. History is kept.

**Benefits:** digest emails (§10, category G), member-only events, stories, clubs, and eligibility to volunteer or become an ambassador.

**Public profiles** live at `/community/members/[publicSlug]` (an extension of §5). The page renders only when `publicProfile && isAdult(userId)`, evaluated at request time. It shows name, city, bio, avatar, badges and published stories, with no contact details, followers or comments. For a minor the toggle is never shown and the server rejects it. If a DOB change makes the user a minor, the profile is unpublished (§12.7: no participant pages).

#### 9.7.3 Post-Competition Invitations

`results.published` for competition C schedules `community.postCompetitionInvites(C)` at +`community.inviteDelayHours`.

**Recipients.** For an adult, the participant's own user. For a minor, the guardian only, because §10 never sends category G to a minor's own contact or inbox. Each recipient gets one consolidated message per competition, covering all their linked children. Recipients without `COMMUNICATION` consent are skipped. §10's frequency caps apply.

**Items** (only for enabled flags):

| Item | Included for |
|---|---|
| Join the FOA community (one-click token link) | participants not already ACTIVE members |
| Upcoming competitions (≤3, age-eligible, PUBLISHED or REGISTRATION_OPEN) | all |
| Share the story behind your work | SCHOOL_WINNER or FOA_FINALIST in C |
| Volunteer with FOA | age ≥ `volunteer.minAge`, not already a volunteer |
| Join your school's FOA club / start one | participants whose institution has an ACTIVE club / INSTITUTION_ADMIN and COORDINATOR of participating institutions with no club (never students) |
| Events & campaigns near you | events within 50 km of the pin-code centroid, or online, in the next 60 days |
| Become an FOA Ambassador | users for whom `AmbassadorService.evaluate` returns eligible |

```prisma
model CommunityInvitation { id, subjectKey, recipientUserId?, competitionId, items String[], token String @unique, sentAt, openedAt?,
  acceptedItems String[], expiresAt /* +90 d */   @@unique([subjectKey, competitionId]) }   // re-runs are idempotent
```

The link `/community?invite={token}` pre-fills the join form, but acceptance still requires login. A token alone never creates a membership. §11 reports the conversion rate.

#### 9.7.4 Clubs (`CLUBS`)

```prisma
model Club { id, slug @unique, name, institutionId, description?, logoAssetId?, status ClubStatus, facultyAdvisorUserId?, pendingAdvisorEmail?,
  requestedByUserId, approvedById?, approvedAt?, rejectionReason?, advisorVacantSince?, closedAt?, createdAt }
  // partial unique (institutionId) WHERE status NOT IN ('REJECTED','CLOSED')
model ClubMember { id, clubId, participantProfileId, role ClubRole, status ClubMemberStatus, addedByUserId, joinedAt?, leftAt?  @@unique([clubId, participantProfileId]) }
model ClubAnnouncement { id, clubId, authorUserId, body /* plain text ≤2000 */, createdAt, deletedAt? }
```

**Constraints.** The institution is VERIFIED. The advisor is an adult `InstitutionMember` (AUTHORISED_PERSON or COORDINATOR) of that institution. Members are `ParticipantProfile`s of that institution. There are at most `club.maxStudentLeaders` STUDENT_LEADERs.

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| (new) → PENDING_ADVISOR | participant of the institution (with login) | no live club | invite sent to `pendingAdvisorEmail` (`club.advisorInvited`) |
| (new) → PENDING_APPROVAL | INSTITUTION_ADMIN or COORDINATOR acting as advisor | no live club | COMMUNITY_MANAGER notified |
| PENDING_ADVISOR → PENDING_APPROVAL / REJECTED | invited advisor accepts / declines, or 14 days pass (system) | advisor eligible | notify COMMUNITY_MANAGER / requester |
| PENDING_APPROVAL → ACTIVE / REJECTED | COMMUNITY_MANAGER | reason required to reject | requester becomes STUDENT_LEADER; `club.approved` / `club.rejected` |
| ACTIVE → ADVISOR_VACANT | system on `institutionMember.removed` for the advisor | none | joins and announcements frozen; INSTITUTION_ADMIN and COMMUNITY_MANAGER notified |
| ADVISOR_VACANT → ACTIVE | INSTITUTION_ADMIN or COMMUNITY_MANAGER assigns an advisor | eligible advisor | `club.advisorChanged` |
| ADVISOR_VACANT → CLOSED | system after `club.vacancyAutoCloseDays` | none | members set LEFT; guardians notified |
| ACTIVE → CLOSED | INSTITUTION_ADMIN or COMMUNITY_MANAGER | reason | members set LEFT |

**Adding members.**
- The advisor adds students in bulk from the institution's participants. Alternatively, a student with a login requests to join (PENDING_ADVISOR) and the advisor approves.
- Every minor already holds `GUARDIAN_VERIFIED` (§12.4). The guardian is notified of the membership (`club.memberAdded`) and can remove the child in one click.
- A change of `institutionId` sets the membership to LEFT.

**Communication.** The only club channel is `ClubAnnouncement`, posted by the advisor or COMMUNITY_MANAGER. It is one-to-many with no replies, visible at `/dashboard/club`, and guardians are notified. `/community` lists ACTIVE clubs with name, institution, city and member count, never member names.

#### 9.7.5 Ambassadors (`AMBASSADORS`)

```json
"ambassador.eligibility": { "minAge": 14, "requireCommunityMember": true,
  "anyOf": [ { "competitionsParticipated": 2 }, { "milestone": "FOA_FINALIST" } ], "allOf": [ { "approvedVolunteerHours": 10 } ], "termMonths": 12 }
```

`AmbassadorService.evaluate(userId) → { eligible, unmet: [{ rule, current, required }] }` reads `EngagementSummary`.
- Supported atoms: `competitionsParticipated`, `milestone`, `approvedVolunteerHours`, `eventsAttended`, `communityMemberMonths`. An unknown atom fails validation when the config is saved.
- `/dashboard/engagement` shows progress toward eligibility.

```prisma
model AmbassadorNomination { id, userId, nominatedByUserId, statement /* ≤1000 */, status AmbassadorNominationStatus, eligibilitySnapshot Json,
  overrideReason?, reviewedById?, reviewedAt?, reason?, createdAt }   // partial unique (userId) WHERE status='SUBMITTED'
model Ambassador { id, userId @unique, status AmbassadorStatus, since, termEndsAt, nominationId, revokedReason? }
```

**Nominations.**
- Self-nomination is allowed only when eligible. COMMUNITY_MANAGER, a club advisor or INSTITUTION_ADMIN may also nominate.
- SUBMITTED → APPROVED (COMMUNITY_MANAGER; approving an ineligible nominee requires an `overrideReason`). This creates an ACTIVE `Ambassador` with `termEndsAt = since + termMonths`, records the `AMBASSADOR` milestone, emits `ambassador.appointed`, and shows the badge on the dashboard and on adult public profiles.
- SUBMITTED → REJECTED (reason required) or → WITHDRAWN (by the nominee).
- For a minor nominee, the guardian is notified and must approve.
- **Term end:** a job sets EXPIRED at `termEndsAt`, and renewal requires a new nomination. Revocation (with a reason) sets REVOKED, removes the badge, and revokes the milestone record.

#### 9.7.6 Child-Safety Constraints (binding through M8)

**Not allowed:** forums, comments, chat, DMs, a member directory, follower graphs, or any user-to-user messaging (§12.7).

**The only channels allowed:**
1. Moderated story submissions.
2. One-to-many `ClubAnnouncement`s from vetted adults, with no replies.
3. The organization contact relay (adult senders only).
4. Status notes from an adoption handler to an adult applicant (§9.10).

Every channel is logged and retained per §12.

### 9.8 Volunteers (modules 9, 26, M6, `VOLUNTEERS`)

```prisma
model VolunteerApplication { id, userId, fullName, dateOfBirth, phone, email, city, state, pinCode, institutionId?, skills VolunteerSkill[], skillNotes?,
  hoursPerWeek Int, availableDays String[] /* MON..SUN */, mode REMOTE|IN_PERSON|BOTH, languages String[], motivation /* ≤1000 */, experience?,
  wantsMinorFacingWork Boolean, codeOfConductAcceptedAt, guardianApprovedAt?, status VolunteerApplicationStatus, reviewerUserId?, interviewAt?,
  decisionReason?, decidedAt?, createdAt }   // partial unique (userId) WHERE status NOT IN (APPROVED, REJECTED, WITHDRAWN)
model VolunteerProfile { userId @id, applicationId, status VolunteerProfileStatus, skills VolunteerSkill[], mode, city, hoursPerWeek Int,
  approvedMinutes Int @default(0), approvedAt, pausedReason? }   // clearance lives in §12 SafeguardingClearance
model VolunteerOpportunity { id, title, description, skills VolunteerSkill[], mode, city?, eventId?, competitionId?, campaignId?, startsAt?, endsAt?,
  slots Int, estimatedHours Int, involvesMinors Boolean /* minor-facing or minors' data */, adultsOnly Boolean, coordinatorUserId, status VolunteerOpportunityStatus }
model VolunteerAssignment { id, opportunityId, volunteerUserId, status VolunteerAssignmentStatus, assignedById?, assignedAt?, completedAt?  @@unique([opportunityId, volunteerUserId]) }
model VolunteerHourLog { id, volunteerUserId, assignmentId?, date, minutes Int /* 15–720 */, description, status VolunteerHourLogStatus, reviewedById?, reviewedAt?, reason? }
```

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| (new) → SUBMITTED | MEMBER | age ≥ `volunteer.minAge`; one open application; minor: login + `GUARDIAN_VERIFIED` | `volunteerApplication.submitted`; minor's guardian asked to approve |
| SUBMITTED → SCREENING → INTERVIEW | COMMUNITY_MANAGER | minor: `guardianApprovedAt` set (hidden from the queue until then); INTERVIEW needs `interviewAt` | `volunteerApplication.statusChanged` |
| SCREENING / INTERVIEW → APPROVED | COMMUNITY_MANAGER | none | `VolunteerProfile` ACTIVE; `VOLUNTEER` UserRole granted; if adult and `wantsMinorFacingWork`, §12 clearance starts; `statusChanged` |
| SUBMITTED / SCREENING / INTERVIEW → REJECTED | COMMUNITY_MANAGER | reason | `statusChanged` |
| non-terminal → WITHDRAWN | applicant | none | none |

**Profile.** ACTIVE ↔ PAUSED (the volunteer or the manager). → REMOVED (COMMUNITY_MANAGER, with a reason) revokes the VOLUNTEER role and withdraws open assignments.

**Assignments.**
- INTERESTED (set by the volunteer) → ASSIGNED (by the coordinator). Assignment requires:
  - an ACTIVE profile and free slots.
  - an adult volunteer if `adultsOnly`.
  - if `involvesMinors`: an adult who passes `SafeguardingService.assertCleared(userId, 'MINOR_FACING')` (POLICE_VERIFICATION, §12.9). Minors therefore never get minor-facing tasks or access to minors' data (§12.7).
- From ASSIGNED: COMPLETED or NO_SHOW (coordinator), or WITHDRAWN (volunteer). From INTERESTED: DECLINED (coordinator) or WITHDRAWN (volunteer).
- The opportunity becomes FILLED when ASSIGNED reaches `slots`.
- If clearance expires, the volunteer's `involvesMinors` assignments are flagged for reassignment.

**Hours.**
- Logs may be dated up to 60 days back, never in the future, with at most 16 h per day.
- SUBMITTED → APPROVED/REJECTED by the coordinator or COMMUNITY_MANAGER, never by the volunteer themselves.
- APPROVED updates `approvedMinutes` and `EngagementSummary` and emits `volunteerHours.approved`.
- Only COMMUNITY_MANAGER can reverse an approval (→ REJECTED with a reason), which decrements both totals.

**Certificates.** `issueVolunteerCertificate({ userId, periodFrom, periodTo })` (COMMUNITY_MANAGER) needs ≥ 5 approved hours in the period. It calls §7's engine with `VOLUNTEER_SERVICE` (data: hours, period, skills), with the same QR verification. Volunteers request a certificate from the dashboard, which creates an admin task.

### 9.9 Animal-Welfare Directory (module 10, M7, `NGO_DIRECTORY`)

```prisma
model Organization { id, orgCode @unique, slug @unique, type OrganizationType, name, legalName?, registrationNumber?, darpanId?, awbiRecognitionNo?,
  description /* ≤3000 */, services OrgServiceKind[], species Species[], addressLine?, city, state, pinCode, country @default("IN"), lat Float?, lng Float?,
  publicPhone?, publicEmail?, whatsapp?, website?, socials Json?, contactVisibility ContactVisibility, showStreetAddress Boolean, emergency24x7 Boolean,
  logoAssetId?, photoAssetIds String[], status OrganizationStatus, verifiedAt?, verifiedById?, verificationExpiresAt?, rejectionReason?, suspendedReason?,
  pendingChanges Json?, needsReview Boolean @default(false), termsRevisionId, createdByUserId, searchVector Unsupported("tsvector"), createdAt, updatedAt, deletedAt? }
  // GiST on ll_to_earth(lat,lng); GIN on searchVector; GIN trgm on name; unique registrationNumber WHERE NOT NULL
model OrganizationServiceArea { id, organizationId, pinCode?, city, state }   // ≤50 per org
model OrganizationDocument { id, organizationId, kind REGISTRATION_CERTIFICATE|PAN|TAX_12A|TAX_80G|DARPAN|AWBI|VET_COUNCIL_REGISTRATION|ID_PROOF|REFERENCE|OTHER,
  fileAssetId /* private bucket */, expiresAt?, uploadedById, createdAt }
model OrganizationVerification { id, organizationId, kind INITIAL|ANNUAL|CHANGE, checklist Json, decision VERIFIED|REJECTED, reviewerId, notes?, decidedAt }
model ListingReport { id, targetType ORGANIZATION|ADOPTABLE_ANIMAL, targetId, reason ListingReportReason, details /* ≤2000 */, reporterUserId?, reporterEmail?,
  reporterIpHash, status ListingReportStatus, resolvedById?, resolution?, createdAt }
model OrganizationContactRequest { id, organizationId, senderUserId, message /* ≤1500 */, createdAt }   // relayed by email; sender's email shown to the org
model PinCode { pinCode @id, district, state, lat Float, lng Float }   // seeded from the India Post / data.gov.in open dataset
```

**Registration** (`/ngos/register`): an adult with a verified phone (§12.7).
- **Steps:** type → details → services, species and areas (Leaflet/OSM map pin, defaulting to the pin-code centroid) → documents → contact visibility → declaration. The declaration states: not a breeder, pet shop or seller; information accurate; `directory-terms` accepted.
- **Required documents by type:**

| Type | Required |
|---|---|
| NGO, RESCUE_ORGANIZATION, SHELTER | `registrationNumber` + REGISTRATION_CERTIFICATE |
| VETERINARY_CLINIC | VET_COUNCIL_REGISTRATION |
| INDEPENDENT_RESCUER, FOSTER_CAREGIVER | ID_PROOF + one REFERENCE |

- **Individuals** (rescuers and fosters) default to RELAY_ONLY contact with `showStreetAddress = false` forced, and their public coordinates are rounded to 2 decimals (~1 km). They may opt in to a public phone or email.
- **Reps:** an org has 1–5 ORG_REPs, each a `UserRole` scoped to the ORGANIZATION. The last rep cannot remove themselves.

| From → To | Actor | Guard | Side effects |
|---|---|---|---|
| (new) → PENDING_VERIFICATION | adult MEMBER | documents for the type; Turnstile; `registrationNumber` unique; name + pin similarity > 0.8 sets `needsReview` | scoped ORG_REP granted; `organization.registered` |
| PENDING_VERIFICATION → VERIFIED / REJECTED | COMMUNITY_MANAGER, STAFF_ADMIN | checklist complete (documents match name and number, Darpan/AWBI checked, phone call made) / reason | expiry = +`directory.reverifyDays`; listed publicly; `organization.verified` / `.rejected` |
| REJECTED → PENDING_VERIFICATION | ORG_REP | data or documents changed | none |
| VERIFIED → VERIFIED (ANNUAL or CHANGE) | reviewer | re-verification submitted, or `pendingChanges` exist | expiry extended from the approval date; `pendingChanges` applied |
| VERIFIED → VERIFICATION_EXPIRED | system | now > `verificationExpiresAt` | hidden; listings suspended (§9.14); `organization.verificationExpired` |
| VERIFICATION_EXPIRED → VERIFIED | reviewer | re-verification approved | listings suspended for ORG_NOT_VERIFIED are restored |
| VERIFIED / VERIFICATION_EXPIRED → SUSPENDED → VERIFIED | COMMUNITY_MANAGER, STAFF_ADMIN / STAFF_ADMIN | reason / new verification record | hidden; listings suspended; open applications moved to FOA; `organization.suspended` / `.reinstated` |

**Re-verification and edits.** Reminders go out 30 and 7 days before expiry (§10 `reminder.orgReverification`). On a VERIFIED org, edits to `name`, `legalName`, `type` or `registrationNumber` wait in `pendingChanges` for a CHANGE review. Other edits apply immediately and are audited.

**Search** (`/ngos?q=&type=&service=&species=&city=&pin=&lat=&lng=&radiusKm=&emergency=`). Results include VERIFIED, non-deleted orgs only.
- **Text:** `websearch_to_tsquery('simple', q)` on `searchVector` (name A, service/species labels B, description C), OR `similarity(name, q) > 0.3`.
- **Location:** the origin is the `PinCode` centroid or opt-in browser geolocation; the radius defaults to `directory.defaultRadiusKm` and is capped at `directory.maxRadiusKm`. Filter: `earth_box(ll_to_earth(:lat,:lng), :r) @> ll_to_earth(lat,lng) AND earth_distance(…) <= :r` (extensions `cube` + `earthdistance`). Orgs with a service area on the searched pin or city are also included.
- **Sort and pagination:** by distance when a location is given, otherwise by rank, then name. 20 per page, with a list/map toggle. A "Find a vet" preset sets `type=VETERINARY_CLINIC`.

**Detail page** (`/ngos/[slug]`): profile, services, areas, contact or the relay form, current adoption listings, and events. It shows the badge "Documents verified by FOA on {date}" with the caveat that verification covers documents only.

**Listing reports.** Anyone can report (Turnstile; 5 per day per IP).
- ORG_REPs are told about INCORRECT_INFO and UNREACHABLE_OR_CLOSED reports, never who reported them.
- Three OPEN reports from distinct reporters set `needsReview`; there is no auto-hide.
- FRAUD_SUSPECTED and WELFARE_CONCERN alert staff immediately, and the reporter is pointed to local authorities and the AWBI helpline.
- Child-safety concerns go through §12 `ContentReport`.

**Relay contact.** Logged-in adults only, 3 per day per user.

### 9.10 Adoption Facilitation (modules 6, 25, M7, `ADOPTION`)

```prisma
model AdoptableAnimal { id, listingCode @unique, organizationId? /* null = FOA-listed */, listedByUserId, name, species Species, breed?, mixedBreed Boolean,
  ageEstimateMonths Int, ageIsEstimate Boolean @default(true), sex AnimalSex, size AnimalSize, colour?, sterilized TriState, vaccinated TriState,
  vaccinationNotes?, dewormed TriState, healthNotes?, specialNeeds Boolean, temperament?, goodWithKids TriState, goodWithDogs TriState, goodWithCats TriState,
  story?, requirements?, photoAssetIds String[] /* 1–10 WEB derivatives, EXIF/GPS stripped, alt required */, videoUrl?, city, state, pinCode,
  lat?, lng? /* rounded 2 dp */, adoptionContributionMinor Int?, currency?, status AdoptableAnimalStatus, adoptedViaPlatform Boolean?, withdrawnReason?,
  lastConfirmedAt, listingSuspendedAt?, listingSuspendedReason ORG_NOT_VERIFIED|STALE|STAFF_HOLD?, questionnaireId?, createdAt, updatedAt, deletedAt? }
model AdoptionQuestionnaire { id, organizationId? /* null = FOA default */, version Int, title, active Boolean,
  fields Json /* [{key,label,type:TEXT|TEXTAREA|SINGLE|MULTI|BOOLEAN|NUMBER,required,options?}]; zod built at runtime */ }
model AdoptionApplication { id, applicationCode @unique, animalId, applicantUserId, handlerType ORGANIZATION|FOA, organizationId?, assignedToUserId?,
  applicantDob, phone /* verified */, email, addressLine, city, state, pinCode, homeType APARTMENT|INDEPENDENT_HOUSE|FARM|OTHER,
  homeOwnership OWNED|RENTED|FAMILY, landlordPermits TriState, adultsInHome Int, childrenInHome Int, otherPets Json, hoursAlonePerDay Int,
  priorPetExperience?, questionnaireId, answers Json, shareConsentAt DateTime, termsRevisionId, termsAcceptedAt, status AdoptionApplicationStatus,
  homeCheckAt?, homeCheckOutcome PASSED|FAILED|WAIVED?, homeCheckNotes?, decisionReasonCode?, noteToApplicant?, contactRevealedAt?, handoverAt?,
  followUpDueAt?, followUpOutcome WELL|CONCERN|RETURNED?, followUpNotes?, lastStatusChangeAt, createdAt }
  // partial unique (animalId) WHERE status='APPROVED'; partial unique (animalId, applicantUserId) WHERE status IN (SUBMITTED,UNDER_REVIEW,HOME_CHECK,APPROVED)
```

- **Listers.**
  - ORG_REPs of a VERIFIED org of any type except VETERINARY_CLINIC (vets appear only as directory entries), or an ADOPTION_COORDINATOR for FOA listings.
  - Individuals may have at most `directory.maxActiveListingsIndividual` AVAILABLE listings.
  - Every listing carries a declaration: the lister has custody or authority to rehome, it is not a sale, and the health information is accurate.
  - FOA collects no money. Any contribution is paid to the org off-platform and shown as "Adoption contribution set by {org}".
- **Handlers.** The listing org's ORG_REPs, or ADOPTION_COORDINATORs for FOA listings. ADOPTION_COORDINATOR can see and act on every application.
- **Public visibility.** A listing is public when status ∈ {AVAILABLE, ON_HOLD}, it is not suspended, and the org (if any) is VERIFIED. An ADOPTED listing shows "Adopted" for 90 days, then returns 410.
- **Stale listings.** The handler is reminded after `adoption.listingReconfirmDays` without confirmation (§10 `reminder.animalStale`). After `adoption.listingStaleHideDays` the listing is suspended as STALE until `confirmAnimalAvailability` is called.

| AdoptableAnimal: From → To | Actor | Guard | Side effects |
|---|---|---|---|
| (new) → DRAFT → AVAILABLE | lister | ≥1 photo with alt; required fields; declaration | `lastConfirmedAt` set; `animal.listed` |
| AVAILABLE ↔ ON_HOLD | handler; system on APPROVED, and back when the APPROVED application is rejected or withdrawn | → AVAILABLE only if no APPROVED application exists | "On hold" badge; backup applications still accepted |
| ON_HOLD → ADOPTED | system on application COMPLETED (`adoptedViaPlatform = true`); handler for an off-platform adoption | none | other active applications → REJECTED `ANIMAL_ADOPTED` |
| AVAILABLE → ADOPTED | handler (off-platform) | no APPROVED application | `adoptedViaPlatform = false`; active applications → REJECTED |
| DRAFT / AVAILABLE / ON_HOLD → WITHDRAWN | handler | reason: DECEASED, RETURNED_TO_OWNER, ADOPTED_ELSEWHERE, NO_LONGER_AVAILABLE, OTHER | active applications → REJECTED `LISTING_WITHDRAWN` |
| ADOPTED → AVAILABLE | ADOPTION_COORDINATOR | reason (adoption failed or animal returned) | relisted; history kept |

| AdoptionApplication: From → To | Actor | Guard | Side effects |
|---|---|---|---|
| (new) → SUBMITTED | MEMBER | `isAdult` and age ≥ `adoption.minApplicantAge`; phone verified; animal publicly visible; no duplicate; ≤ `maxActiveApplicationsPerApplicant` active; answers valid; share consent; `adoption-terms` accepted | `adoptionApplication.submitted` → handler and applicant |
| SUBMITTED → UNDER_REVIEW → HOME_CHECK | handler | `homeCheckAt` optional | `adoptionApplication.statusChanged` (+ `noteToApplicant`) |
| HOME_CHECK → APPROVED, or UNDER_REVIEW → APPROVED | handler | outcome PASSED, or WAIVED with notes; no other APPROVED application (animal row lock + partial unique index); animal ∈ {AVAILABLE, ON_HOLD} | animal → ON_HOLD; `contactRevealedAt` set; `statusChanged` |
| APPROVED → COMPLETED | handler | `handoverAt` ≤ now | animal → ADOPTED; others → REJECTED; `followUpDueAt = handoverAt + 30 d`; follow-ups at `adoption.followUpDays`; `adoption.completed` |
| SUBMITTED / UNDER_REVIEW / HOME_CHECK / APPROVED → REJECTED | handler or system | reason code: NOT_SUITABLE, HOME_CHECK_FAILED, NO_RESPONSE, ANIMAL_ADOPTED, LISTING_WITHDRAWN, OTHER | polite templated notice; if the application was APPROVED, animal → AVAILABLE |
| same → WITHDRAWN | applicant | none | handler notified; if the application was APPROVED, animal → AVAILABLE |

**SLAs and auto-close.**
- SUBMITTED with no handler action for `adoption.handlerSlaDays` → reminder to the handler.
- After twice that, `adoptionApplication.slaBreached` alerts ADOPTION_COORDINATOR, who may reassign the application to FOA.
- No status change for `adoption.inactiveAutoCloseDays` → auto-REJECTED `NO_RESPONSE`, with a warning 7 days before.

**Communication** (no chat, per §9.7.6).
- The handler sees the applicant's contact details from SUBMITTED, under the share consent, which covers only the listing org.
- The handler sends updates as `noteToApplicant` (≤1000 characters) attached to transitions, or through `requestApplicantInfo`. The applicant may then edit their answers while the application is SUBMITTED or UNDER_REVIEW.
- The handler's direct contact, including a RELAY_ONLY rescuer's, is revealed to the applicant only at APPROVED.

**Follow-up.** On each follow-up date (§10 `reminder.adoptionFollowUp`), the adopter gets a check-in form at `/dashboard/applications/[id]/follow-up` (wellbeing, an optional photo, concerns), and the handler is notified.
- CONCERN alerts the handler and ADOPTION_COORDINATOR.
- RETURNED lets the coordinator relist the animal.

**Disclaimer** (on `/adopt`, every listing, and the apply form): "FOA facilitates connections between adopters and independent organizations. FOA does not own, house or guarantee the health or temperament of animals listed by partners; the adoption agreement is between the adopter and the listing organization." Applying requires accepting `adoption-terms`. Each listing links to "Vets near {city}" (directory, `type=VETERINARY_CLINIC`).

**Retention.** REJECTED and WITHDRAWN applications are purged after 12 months; COMPLETED ones are kept for 3 years (§12 confirms).

### 9.11 Pages & Dashboards

| Route | Access | Content |
|---|---|---|
| `/`, `/about`, `/impact`, `/contact` | public | §9.4.3–§9.4.5 |
| `/awareness`, `/awareness/[slug]`, `/blog`, `/blog/[slug]` | public | §9.4.3 |
| `/events`, `/events/[slug]`, `/campaigns/[slug]` (extends §5) | public; registration requires login | filters: type, city, online, age; registration/waitlist; campaign progress and pledge wall |
| `/community`, `/community/members/[slug]` (extends §5) | public | how engagement works, join, clubs, adult ambassadors, stories; adult profiles only |
| `/volunteer`, `/volunteer/apply` | public; applying requires login | skills, open opportunities, application form |
| `/ngos`, `/ngos/[slug]`, `/ngos/register` | public; registering requires an adult | search and map, detail, multi-step registration |
| `/adopt`, `/adopt/[id]` (`id` = `listingCode`), `/adopt/[id]/apply` | public; applying requires an adult | filters: species, age, size, sex, good-with, city/radius |
| `/dashboard/engagement`, `/dashboard/events`, `/dashboard/volunteer`, `/dashboard/applications`, `/dashboard/club` | self / guardian | timeline, badges, ambassador progress, membership, stories; tickets with QR; volunteer status, assignments, hours, certificates; adoption applications and follow-ups; club announcements |
| `/institution/club` (tab in §6's dashboard) | INSTITUTION_ADMIN/COORDINATOR, advisor | request a club, members, join requests, leaders, announcements |
| `/org` (`/profile`, `/documents`, `/team`, `/listings`, `/applications`, `/contact-requests`, `/reverify`) | ORG_REP (org picker if several) | status and expiry alerts, editing (sensitive fields go to `pendingChanges`), listings, application pipeline per animal |
| `/admin/content` (`/calendar`, `/home`, `/impact`, `/stories`) | CONTENT_MANAGER, STAFF_ADMIN (`/impact`: STAFF_ADMIN) | pages, posts, awareness, taxonomy, review queue, revisions |
| `/admin/events` (`/check-in`) | COMMUNITY_MANAGER, STAFF_ADMIN; VOLUNTEER for check-in only | events, registrations (CSV export), media, campaigns, QR scanner (BarcodeDetector with zxing fallback) |
| `/admin/community`, `/admin/volunteers`, `/admin/ngos`, `/admin/adoption`, `/admin/inbox` | per §9.3 | members, invitation conversion, clubs, nominations; volunteer pipeline, opportunities, hours; verification and re-verification queues, reports, pending changes; all listings and applications, SLA breaches, questionnaires, follow-ups; contact inbox |

### 9.12 Server Actions

All actions live in `server/domain/{content,community,events,volunteers,directory,adoption}`, validate input with zod, and enforce the transition tables above.

| Action | Input | Authorization | Effect |
|---|---|---|---|
| `saveContent` | `{type: PAGE\|POST\|AWARENESS, id?, locale, fields, body}` | CONTENT_MANAGER, STAFF_ADMIN | creates or updates a DRAFT or pending revision, plus a `ContentRevision` |
| `submitContentForReview` / `requestContentChanges` / `approveContent` | `{type, id, comment?, publishAt?}` | editor / approver / approver (§9.4.2) | DRAFT ↔ IN_REVIEW → PUBLISHED or SCHEDULED |
| `archiveContent` / `restoreRevision` | `{type, id}` / `{revisionId}` | approver / editor | → ARCHIVED / new revision from a snapshot |
| `addImpactAdjustment` | `{counterKey, delta, note}` | STAFF_ADMIN | §11 `ImpactAdjustment` (audited) |
| `submitContactMessage` | `{topic, name, email, phone?, subject, message, captchaToken}` | public | `ContactMessage` + `contactMessage.received` |
| `assignContactMessage` / `replyToContactMessage` / `setContactMessageStatus` | `{id, userId}` / `{id, body}` / `{id, status}` | inbox role for the topic | assign; email + `ContactNote`; transition |
| `submitStory` / `moderateStory` | `{title, body, photos, subjectParticipantId?}` / `{id, accept, reason?}` | member, guardian / CONTENT_MANAGER | `StorySubmission` + `ModerationReview` / Post DRAFT |
| `saveEditorialItem` / `transitionEditorialItem` / `markEditorialPublished` | `{…}` / `{id, to}` / `{id, publishedUrl, reach?, engagements?}` | CONTENT_MANAGER, STAFF_ADMIN | §9.5 lifecycle |
| `saveEvent` / `publishEvent` / `cancelEvent` / `publishEventMedia` | `{…}` / `{id}` / `{id, reason}` / `{mediaId}` | COMMUNITY_MANAGER, STAFF_ADMIN | event lifecycle; cancellation cascades; media consent check |
| `registerForEvent` / `cancelEventRegistration` / `checkInAttendee` | `{eventId, attendeeParticipantId?}` / `{registrationId}` / `{token}` | member or guardian / registrant / §9.6 check-in roles | CONFIRMED or WAITLISTED; waitlist promotion; ATTENDED (idempotent) |
| `saveCampaign` / `publishCampaign` / `pledgeToCampaign` | `{…}` / `{id}` / `{campaignId, participantId?, showOnWall}` | COMMUNITY_MANAGER / COMMUNITY_MANAGER / member or guardian | campaign lifecycle; `CampaignPledge` |
| `joinCommunity` / `approveMinorMembership` / `leaveCommunity` | `{participantId?, interests, city, inviteToken?}` / `{membershipId}` / `{subjectKey}` | self or guardian / guardian (OTP session) / self or guardian | PENDING_GUARDIAN or ACTIVE / ACTIVE / LEFT |
| `updateMemberProfile` | `{displayName, bio, avatar, dateOfBirth?, publicProfile}` | self | `publicProfile` rejected unless adult |
| `requestClub` / `respondClubAdvisorInvite` / `decideClub` | `{institutionId, name, advisorEmail?}` / `{clubId, accept}` / `{clubId, approve, reason?}` | §9.7.4 actors | club lifecycle |
| `addClubMembers` / `requestToJoinClub` / `decideClubJoin` / `setClubLeader` | `{clubId, participantIds}` / `{clubId}` / `{memberId, approve}` / `{memberId, leader}` | advisor / participant with login / advisor / advisor | `ClubMember` changes |
| `assignClubAdvisor` / `closeClub` / `postClubAnnouncement` | `{clubId, userId}` / `{clubId, reason}` / `{clubId, body}` | INSTITUTION_ADMIN or COMMUNITY_MANAGER (first two); advisor or COMMUNITY_MANAGER (announcement) | club lifecycle; announcement + notifications |
| `nominateAmbassador` / `decideAmbassadorNomination` / `revokeAmbassador` | `{userId, statement}` / `{id, approve, reason?, overrideReason?}` / `{id, reason}` | eligible self or a nominator / COMMUNITY_MANAGER / COMMUNITY_MANAGER | §9.7.5 |
| `applyToVolunteer` / `approveMinorVolunteer` / `reviewVolunteerApplication` / `withdrawVolunteerApplication` | `{…}` / `{applicationId}` / `{id, to, notes?, interviewAt?, reason?}` / `{id}` | member / guardian / COMMUNITY_MANAGER / applicant | §9.8 lifecycle |
| `setVolunteerStatus` / `saveOpportunity` / `expressInterest` / `assignVolunteer` / `transitionAssignment` | `{userId, status, reason?}` / `{…}` / `{opportunityId}` / `{opportunityId, userId}` / `{id, to}` | COMMUNITY_MANAGER / COMMUNITY_MANAGER / VOLUNTEER / coordinator / coordinator or volunteer | profile and assignment lifecycle |
| `logVolunteerHours` / `reviewVolunteerHours` / `issueVolunteerCertificate` | `{date, minutes, description, assignmentId?}` / `{logId, approve, reason?}` / `{userId, periodFrom, periodTo}` | VOLUNTEER / coordinator or COMMUNITY_MANAGER (not self) / COMMUNITY_MANAGER | hour logs; §7 certificate |
| `registerOrganization` / `updateOrganization` / `uploadOrganizationDocument` / `submitReverification` | `{…}` / `{orgId, fields}` / `{orgId, kind, fileAssetId}` / `{orgId}` | adult MEMBER / ORG_REP / ORG_REP / ORG_REP | org lifecycle; `pendingChanges` |
| `reviewOrganization` / `suspendOrganization` / `reinstateOrganization` | `{orgId, decision, checklist, reason?}` / `{orgId, reason}` / `{orgId}` | COMMUNITY_MANAGER or STAFF_ADMIN / same / STAFF_ADMIN | §9.9 transitions |
| `inviteOrgRep` / `removeOrgRep` | `{orgId, email}` / `{orgId, userId}` | ORG_REP, COMMUNITY_MANAGER | scoped `UserRole` grant or revoke; ≥1 rep kept |
| `reportListing` / `resolveListingReport` / `contactOrganization` | `{targetType, targetId, reason, details, captchaToken}` / `{id, status, resolution}` / `{orgId, message}` | public / COMMUNITY_MANAGER or ADOPTION_COORDINATOR / adult MEMBER | `ListingReport` / relay email |
| `saveAnimalListing` / `transitionAnimal` / `confirmAnimalAvailability` | `{…}` / `{id, to, reason?}` / `{id}` | ORG_REP (VERIFIED org), ADOPTION_COORDINATOR | §9.10 animal table |
| `submitAdoptionApplication` / `transitionAdoptionApplication` / `withdrawAdoptionApplication` | `{animalId, …, answers, shareConsent, termsRevisionId}` / `{id, to, reasonCode?, noteToApplicant?, homeCheck?, handoverAt?}` / `{id}` | adult MEMBER / handler / applicant | §9.10 application table |
| `requestApplicantInfo` / `recordAdoptionFollowUp` / `reassignApplication` / `saveAdoptionQuestionnaire` | `{id, note}` / `{id, outcome, notes}` / `{id, to: FOA\|ORGANIZATION}` / `{orgId?, fields}` | handler / adopter or handler / ADOPTION_COORDINATOR / ORG_REP or ADOPTION_COORDINATOR | notice; follow-up; handover; new questionnaire version |

### 9.13 Domain Events (for §10 and §11)

Every payload includes the entity id and the actor. The recipients column is guidance for §10's routing; for a minor, §10 sends to the guardian.

| Events | Typical recipients |
|---|---|
| `content.submitted`, `content.changesRequested`, `content.published`, `content.archived` | approvers / editor / none (cache, §11) |
| `contactMessage.received`, `contactMessage.assigned`, `contactMessage.replied` | sender (with `ticketCode`) / assignee / sender |
| `story.submitted`, `story.accepted`, `story.declined` | CONTENT_MANAGER / submitter |
| `event.published`, `event.updated`, `event.cancelled` | members (digest) / registrants |
| `eventRegistration.confirmed`, `.waitlisted`, `.promoted`, `.cancelled`, `.checkedIn` | registrant |
| `campaign.published`, `campaign.pledged`, `campaign.ended` | members (digest) / pledger / COMMUNITY_MANAGER |
| `engagement.milestoneReached {subjectKey, milestone}`, `community.joined`, `community.joinRequested`, `community.invited` | subject / guardian (join request) / invitee |
| `club.advisorInvited`, `.approved`, `.rejected`, `.advisorVacant`, `.advisorChanged`, `.closed`, `.memberAdded`, `.announcementPosted` | advisor / requester, INSTITUTION_ADMIN / COMMUNITY_MANAGER / members' guardians |
| `ambassador.nominated`, `.appointed`, `.rejected`, `.revoked` | COMMUNITY_MANAGER / nominee |
| `volunteerApplication.submitted`, `.statusChanged {from,to}`, `.guardianApprovalRequested`, `volunteerAssignment.assigned`, `volunteerHours.approved`, `volunteerHours.rejected` | applicant or volunteer / guardian / COMMUNITY_MANAGER |
| `organization.registered`, `.verified`, `.rejected`, `.verificationExpired`, `.suspended`, `.reinstated`, `listing.reported` | COMMUNITY_MANAGER / ORG_REPs |
| `animal.listed`, `animal.suspended`, `animal.statusChanged` | handler / active applicants |
| `adoptionApplication.submitted`, `.statusChanged {from,to,note?}`, `.infoRequested`, `.slaBreached`, `adoption.completed`, `adoption.followUpConcern` | handler, applicant / ADOPTION_COORDINATOR |

**Reminders** are not emitted by this section. §10 owns them as `reminder.<name>` keys (§10.3):
- `reminder.eventStarting`: 24 h and 2 h before `startsAt` (CONFIRMED registrants).
- `reminder.orgReverification`: 30 and 7 days before `verificationExpiresAt` (ORG_REPs).
- `reminder.animalStale`: after `adoption.listingReconfirmDays` without confirmation (handler).
- `reminder.adoptionFollowUp`: on each `adoption.followUpDays` date after handover (adopter; handler notified).
- `reminder.ambassadorExpiring`: 30 days before `termEndsAt` (ambassador).

### 9.14 Edge Cases

- **Org de-verified, expired or suspended with live listings.**
  - Listings get `listingSuspendedAt` (ORG_NOT_VERIFIED) and disappear.
  - SUBMITTED, UNDER_REVIEW and HOME_CHECK applications move to `handlerType = FOA`, and ADOPTION_COORDINATORs are notified. APPROVED applications continue under coordinator oversight.
  - Applicants are told "FOA's adoption coordinator is now handling your application".
  - Re-verification (but not a reinstatement after SUSPENDED) restores the listings. Applications stay with FOA until `reassignApplication`.
- **Two approvals for one animal.** The animal row lock plus the partial unique index let exactly one succeed. The other gets `ANIMAL_ALREADY_RESERVED` and stays a backup.
- **A minor tries to adopt.** The server returns 403 `ADULTS_ONLY` before rendering the form, and nothing is stored. The UI says "Ask a parent or guardian to apply".
- **A minor tries to volunteer.** Below `volunteer.minAge` is blocked. Ages 14–17 wait for guardian approval and never get `adultsOnly` or `involvesMinors` work.
- **Missing or conflicting DOB.** A missing DOB prompts for a declaration. When a declared DOB conflicts, the ParticipantProfile DOB wins.
- **A club advisor leaves the school.** The club becomes ADVISOR_VACANT: joins and announcements freeze. If no advisor is appointed within 90 days the club auto-closes. Members and history are kept. A student who changes institution leaves the club automatically.
- **Milestone source revoked.** If a certificate is revoked or an entry disqualified after a milestone, the record is revoked and the summary recomputed. An existing ambassador is flagged for review, not auto-revoked.
- **A minor turns 18.** The public-profile toggle becomes available but is never switched on automatically.
- **Edits after approval and event changes.** A SCHEDULED item edited after approval returns to IN_REVIEW. Event capacity can't drop below the seats already confirmed. A date change re-notifies registrants and flags attendees who become age-ineligible (it does not cancel them).
- **SOCIAL_MEDIA consent withdrawn** after an editorial item was approved. Publishing is blocked. If the item is already live, CONTENT_MANAGER gets a takedown task (§12.6).
- **Duplicate orgs and report spam.** A duplicate `registrationNumber` is rejected, and a near-duplicate name + pin sets `needsReview`. Only distinct reporters count toward review. A guardian of several participants receives one invitation per competition.

### 9.15 Acceptance Criteria

1. Every allowed and disallowed transition in the content, club, volunteer, organization, animal and application tables has a Vitest test (§2).
2. With `content.fourEyes` on, the last editor cannot publish their own Post, but another CONTENT_MANAGER or a STAFF_ADMIN can. LEGAL pages publish only by STAFF_ADMIN.
3. A SCHEDULED Post is live within 1 minute of `publishAt`. If it was edited after approval, it returns to IN_REVIEW instead.
4. A `richText` block containing `<script>` or `onerror=` renders sanitized. An `image` block without `alt` fails validation.
5. Home renders all 7 sections from seed data. DRAFT and ARCHIVED competitions never appear, and the events section is absent when `EVENTS` is off.
6. `/impact` shows §11's counters. Adding an `ImpactAdjustment` changes the displayed value, writes an audit row, and adds the "offline activity" note.
7. The contact form rejects a missing Turnstile token. The 6th message from one IP in an hour returns 429. Choosing "Safeguarding concern" opens `/safeguarding` and stores no `ContactMessage`.
8. An editorial item that depicts artwork without a §7 stamped export, or whose participant lacks SOCIAL_MEDIA or PUBLIC_DISPLAY consent, cannot reach APPROVED.
9. Calling `recordMilestone` twice with the same source creates one record and one `engagement.milestoneReached` event. Results publication gives every FINALIZED WINNER, RUNNER_UP, FINALIST and SPECIAL_MENTION entry's participant `FOA_FINALIST`, and an ELIMINATED entry with SPECIAL_MENTION gets none.
10. Revoking the only SCHOOL_MERIT certificate removes `SCHOOL_WINNER` from the summary.
11. Each recipient gets exactly one invitation per competition. A guardian of two participants gets one message, and nothing goes to a minor's own contact or inbox. Re-running the job sends nothing, and recipients without COMMUNICATION consent get nothing.
12. A minor's membership stays PENDING_GUARDIAN until the guardian approves. `/community/members/{slug}` returns 404 for a minor, even if `publicProfile` was set directly in the database.
13. 50 concurrent registrations for 10 seats yield exactly 10 CONFIRMED and 40 WAITLISTED. Cancelling one promotes waitlist position 1.
14. A check-in token works only for authorized, cleared roles inside the time window. A second scan leaves `checkedInAt` unchanged.
15. A minor with a login cannot register for an event themselves; their guardian can. `seats = 2` when `guardianMustAttend` is set.
16. A club can't be approved for an unverified institution, and a second live club per institution is rejected. Removing the advisor's `InstitutionMember` row sets ADVISOR_VACANT and blocks announcements.
17. `AmbassadorService.evaluate` lists the correct unmet rules for seed users. Self-nomination by an ineligible user is rejected, and approval records `AMBASSADOR`.
18. Volunteering: under-14 applications are rejected, and a 16-year-old's application is hidden from review until the guardian approves. `involvesMinors` assignments require `assertCleared`. Approved hours update the summary, and self-approval is rejected.
19. A volunteer certificate is issued by §7's engine with type `VOLUNTEER_SERVICE` and verifies at `/verify/[certificateNumber]`.
20. Org registration grants a scoped ORG_REP, and the org is not listed until VERIFIED. At `verificationExpiresAt`, the org and its listings disappear from `/ngos` and `/adopt`.
21. A search for pin `560001` with a 10 km radius returns only VERIFIED orgs within 10 km (or with a service area on that pin), sorted by distance. Individual rescuers' coordinates are rounded to 2 decimals, and their contact details are absent from the response.
22. An ORG_REP of an unverified org cannot publish a listing, and a VETERINARY_CLINIC cannot list at all.
23. A user who is 17 by ParticipantProfile DOB gets 403 `ADULTS_ONLY` on adoption, even when their declared DOB says 25.
24. Two concurrent approvals for one animal yield exactly one APPROVED. Completing it sets the animal ADOPTED and rejects the others with `ANIMAL_ADOPTED`.
25. The handler's direct contact is hidden from the applicant before APPROVED and shown after. `followUpDueAt = handoverAt + 30 d`, and the follow-up notification fires then.
26. Suspending an org moves its open applications to FOA, revokes the ORG_REP's access to them, and hides its listings.
27. A route-inventory test confirms that no route or action offers comments, forums, chat or member-to-member messaging.

### 9.16 Open Questions (this section)

1. **Should engagement recording and post-competition invitations ship in M5 so the pilot cohort is invited when its results come out?** *Default:* M6 per §14, with a backfill and a retroactive invitation run at M6 launch.
2. **Content approval.** *Default:* `content.fourEyes = true`; LEGAL pages require STAFF_ADMIN.
3. **Minimum volunteer age.** *Default:* 14. Ages 14–17 need guardian approval and `GUARDIAN_VERIFIED`, and get no minor-facing tasks.
4. **Ambassador thresholds.** *Default:* community member, age ≥ 14, (≥ 2 competitions OR FOA finalist) AND ≥ 10 approved volunteer hours, for a 12-month renewable term.
5. **Clubs per institution: one, or several (for example per campus or level)?** *Default:* one live club per institution.
6. **Club membership for minors: notify the guardian with an opt-out, or require opt-in?** *Default:* notify with a one-click removal, relying on the existing `GUARDIAN_VERIFIED`.
7. **Paid events?** *Default:* free only; fees would be added later through §8.
8. **Minimum adopter age.** *Default:* 18, configurable (some partners require 21).
9. **Re-verification cadence and grace period.** *Default:* every 365 days with no grace period; expired orgs are hidden.
10. **Can independent rescuers and fosters list animals?** *Default:* yes, capped at 10 active listings.
11. **Geo stack.** *Default:* `cube` + `earthdistance` with a seeded `PinCode` table and no runtime geocoding. Move to PostGIS only if polygon service areas are needed.
12. **Applicant–handler messaging inside adoption.** *Default:* none; notes on transitions only, with contact revealed at APPROVED.
13. **Adoption follow-up schedule.** *Default:* 30 and 90 days after handover.

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

## 12. Privacy, Consent & Safeguarding

Owns: `ConsentType`, `ConsentService`, all consent, safeguarding and data-rights entities, the legal pages (`/privacy`, `/terms`, `/safeguarding`, `/child-protection-policy`) and `/admin/consents`, `/admin/safeguarding`, `/admin/data-requests`, `/dashboard/privacy`. A **minor** is a person whose age, computed on the current date from `dateOfBirth`, is under `MAJORITY_AGE = 18`. `isMinor` is always computed and never stored.

### 12.1 Legal Basis (verify with counsel)

Status as checked on 17 Nov 2026. This is engineering guidance, not legal advice. Every row is a design input that counsel MUST confirm before launch.

| Topic | What the platform builds to | Src |
|---|---|---|
| Commencement | The DPDP Act 2023 commences in three tranches (G.S.R. 843(E), 13 Nov 2025). Definitions and the Data Protection Board start on publication. Consent Manager registration (s.6(9), Rule 4) starts one year later and has been in force since 13 Nov 2026. Notice, consent, children's data, rights, security, breach, retention and penalties start 18 months after publication, which works out to **13 May 2027**. FOA goes live before that date, so it MUST be built to the DPDP standard from day one. Until then, IT Act s.43A and the SPDI Rules 2011 may apply, depending on FOA's legal form. | 1, 2, 7 |
| Child | Anyone under 18 (s.2(f)). s.9(1): verifiable consent of a parent or lawful guardian is required before processing a child's data. s.9(2): no processing likely to harm a child's well-being. s.9(3): no tracking, behavioural monitoring or targeted advertising directed at children. These rules hold even when a parent consents. S.O. 5458(E) (in force 6 Oct 2026) only corrected the wording of s.9(1) for persons with disability who have a lawful guardian. | 1, 3 |
| Rule 10 (verifiable parental consent) | The fiduciary must use due diligence to check that the person claiming to be the parent is an identifiable adult. It does so by reference to (a) reliable identity and age details it already holds, or (b) details the person provides voluntarily, or a virtual token from an authorised entity (DigiLocker included). The Rule names no specific technology. | 1 |
| Exemptions | Rule 12 and Fourth Schedule Part A exempt educational institutions from s.9(1) and s.9(3) **only** for tracking and behavioural monitoring for their own educational activities or for the safety of enrolled children. FOA is not an educational institution, and a partner school's exemption does not extend to FOA. There is **no non-profit exemption**. Part B permits processing to confirm that a person is not a child, which covers our age gate. | 1, 5, 6 |
| Rights | s.11 access (a summary of the data, the processing, and other fiduciaries it was shared with). s.12 correction, completion, updating and erasure. s.13 grievance redressal, which the person must exhaust before going to the Board. s.14 nomination. Rule 14(3): a published grievance response period of **no more than 90 days**. Rule 9: publish a contact for data questions and name it in every response. s.6(4): withdrawing consent must be as easy as giving it. s.8(7): erase data once consent is withdrawn or the purpose is served, unless the law requires retention. | 1 |
| Breach | Rule 7: tell each affected Data Principal and the Board **without delay**, then send the Board a detailed report **within 72 h** of becoming aware. CERT-In Directions (2022) require specified cyber incidents to be reported within **6 h** and ICT logs to be kept for 180 days in India. Whether these Directions apply to FOA is to be confirmed. | 1, 4 |
| Retention and security | Rule 8(3) and Rule 6(1)(e): keep personal data, traffic data and processing logs for **at least 1 year**. The Rule 8(1) 3-year inactivity erasure applies only to large e-commerce, gaming and social platforms; FOA adopts it voluntarily. Rule 6 safeguards: encryption, masking, access control, logging, backups and processor contracts. | 1 |
| Consent Managers | Board-registered intermediaries through which a person can give, manage and withdraw consent (s.6(7)–(9), Rule 4). FOA is not required to integrate with one. `ConsentService.record` MUST stay adapter-friendly so that one can be added later. | 1, 2 |
| Notice language | s.5(3): the notice must be available in English or in any language of the Eighth Schedule. Launch with en-IN and hi-IN consent documents. | 1 |
| Penalties | Up to ₹250 cr for failed security safeguards, ₹200 cr for failing to notify a breach, ₹200 cr for breaching the children's-data duties. | 6 |
| Child sexual abuse | POCSO s.19 makes it mandatory to report any knowledge or apprehension of an offence to the SJPU or local police. Under s.21(2), the person in charge of an institution who fails to report is punishable. POCSO Rules 2020 r.11 requires child sexual abuse material (CSAM) to be reported to the SJPU, the police or cybercrime.gov.in. | 8, 9 |
| Global | GDPR (EU/UK child-consent age 13–16) and COPPA (US, under 13) may apply if FOA expands abroad. Not designed for here. | — |

**Not confirmed:** (i) the calendar dates are computed, because the notifications state periods, not dates; (ii) whether guardian OTP plus self-declared adult details meets Rule 10 "due diligence" (untested); (iii) whether the DigiLocker age-token APIs are open to private or non-profit fiduciaries, and at what cost; (iv) whether a "verifiably safe" age under s.9(5) has been notified (none found); (v) whether the CERT-In Directions and SPDI Rules apply to FOA's legal form; (vi) whether the Data Protection Board is operational (secondary sources reported in Oct 2026 that it was not yet functional); (vii) a reported early-2026 proposal to shorten the 18-month window, which had not been notified as of Nov 2026.

Sources: [1] DPDP Rules 2025, G.S.R. 846(E), meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf · [2] Commencement notification G.S.R. 843(E), meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf · [3] Removal of Difficulties Order S.O. 5458(E), egazette.gov.in/WriteReadData/2026/276885.pdf · [4] CERT-In Directions 28 Apr 2022, cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf · [5] juriseagle.com/insights/dpdp-children-data-educational-institutions · [6] edzola.com/post/dpdp-act-for-ngos-plain-english-guide · [7] dpdprules.org/timeline · [8] POCSO Act 2012, indiacode.nic.in/bitstream/123456789/2079/1/AA2012-32.pdf · [9] POCSO Rules 2020 r.11, thc.nic.in (Central Governmental Rules).

### 12.2 Principles and Data Minimization

- **Purpose limitation.** Every personal-data column is declared with the `pii({ purpose, category, enc, publicForMinor })` marker from `src/server/db/pii.ts`, which records it in the PII registry. A CI test walks the Drizzle schema and fails on any column that matches the PII name list (name, phone, email, dob, address, pin, pan, ip) but is not in the registry. The export and erasure jobs (§12.10) are driven by this registry.
- **Privacy by default.** `PUBLIC_DISPLAY`, `SOCIAL_MEDIA`, `AUCTION_OF_ARTWORK`, `PARTICIPANT_PHOTO_VIDEO` and `COMMUNICATION` are OFF until granted. Checkboxes are never pre-ticked. "No" is as prominent as "Yes". Declining an optional consent never blocks registration or judging.
- **Minimization per actor.** Fields marked "enc" are encrypted at field level (§13.1).

| Actor | Collected (source mapping) | Why | Never collected |
|---|---|---|---|
| Participant (both routes) | fullName, displayName, dateOfBirth (enc), pinCode, city, state, country, schoolNameText or institutionId (Phase 2B: name, age/DOB, pin, city/state/country, school) | Certificate identity, eligibility and age category, City/State rankings (Phase 9), linking to the school route | Gender (unless §6 competition config `collectsGender`, default false), the child's photo, Aadhaar or any ID, full address |
| Participant contact | Adult: own phone (required) and email (optional). Minor: none required, because the guardian's contact is used. Minor aged 13–17 with a login: own phone or email, used only for OTP | Phase 2B "Phone"; login | Minor's contact used for any non-transactional message |
| Guardian | fullName, relationship (PARENT or LEGAL_GUARDIAN), phone (enc), email (enc, optional), yearOfBirth, adult declaration | Rule 10 verification; all communication about a minor (Phase 2B "parent/guardian information") | ID documents (unless the DigiLocker flag is on) |
| Institution / coordinator | Phase 2A list: name, pin, address, contact phone/email, principal name/email/phone, authorised person email/phone, expected participants; coordinator name, designation, phone, email | Verification, coordination | Personal phones where official ones exist |
| Judge | name, email, phone, conflict-of-interest declarations, clearance (§12.9); bio and photo only if opted in for public display | Jury management (§7) | Any participant PII (blind judging) |
| Donor / bidder / adopter / volunteer | As specified in §8 and §9. PAN and address only when a tax receipt is requested. Shipping address only after a win or prize. Volunteer DOB for the age gate | Receipts, tax law, delivery, eligibility | Anything not in the §8/§9 forms |
| Visitor | Nothing. Analytics are cookieless and aggregate | — | Third-party cookies, pixels, fingerprints |

Shipping addresses for prizes and auction lots are deleted `RETENTION_SHIPPING_ADDRESS_DAYS` after delivery (§12.11).

### 12.3 Consent Model

```prisma
model ConsentDocument {
  id              String      @id                 // UUIDv7
  type            ConsentType
  version         Int                             // increases per (type, locale)
  locale          String                          // "en-IN", "hi-IN", …
  title           String
  bodyHtml        String                          // sanitized; MUST open with a child-friendly "short version" block
  material        Boolean     @default(true)      // true: older grants become STALE_VERSION once effectiveAt is reached
  effectiveAt     DateTime
  retiredAt       DateTime?
  createdByUserId String                          // SUPER_ADMIN only; publishing requires step-up auth
  @@unique([type, locale, version])
}

model Consent {                                   // append-only history
  id                   String         @id
  subjectParticipantId String?                    // CHECK: exactly one of subjectParticipantId / subjectUserId
  subjectUserId        String?
  grantedByUserId      String?                    // adult self, or the coordinator who recorded a form/declaration
  grantedByGuardianId  String?                    // the guardian who consented (GUARDIAN_OTP, GUARDIAN_SIGNED_FORM_UPLOAD)
  institutionId        String?                    // set for GUARDIAN_SIGNED_FORM_UPLOAD and INSTITUTION_DECLARATION
  type                 ConsentType
  documentId           String                     // the exact ConsentDocument version shown
  competitionId        String?                    // required for competition-scoped types
  eventId              String?                    // §9 events; PARTICIPANT_PHOTO_VIDEO only
  granted              Boolean                    // false = explicit refusal or withdrawal row
  method               ConsentMethod              // CHECKBOX_SELF | GUARDIAN_OTP | GUARDIAN_SIGNED_FORM_UPLOAD | INSTITUTION_DECLARATION
  evidenceFileAssetId  String?                    // scan of the signed form, stored in the evidence bucket
  evidenceStatus       EvidenceStatus @default(NOT_REQUIRED) // NOT_REQUIRED | PENDING_REVIEW | ACCEPTED | REJECTED
  supersedesConsentId  String?
  metadata             Json?                      // type-specific choices, e.g. AUCTION_OF_ARTWORK: { creditMode: FULL_NAME|FIRST_NAME_INITIAL|ANONYMOUS } (read by §8.5)
  ip                   String
  userAgent            String
  grantedAt            DateTime       @default(now())
  withdrawnAt          DateTime?
  @@index([subjectParticipantId, type, competitionId])
  @@index([subjectUserId, type])
}
```

**Append-only rules.** A DB trigger rejects any `DELETE`. It rejects any `UPDATE` except two: `withdrawnAt` going from null to a value, and `evidenceStatus` going from `PENDING_REVIEW` to `ACCEPTED` or `REJECTED`. Each insert writes `AuditLog(action="consent.recorded")`.

**Effective state.** The effective row is the latest row by `grantedAt` for the key (subject, type, scope), where scope = `competitionId ?? eventId ?? GLOBAL`. It is valid only if: `granted` is true and `withdrawnAt` is null; no newer `material` ConsentDocument of the same type and locale has `effectiveAt` at or before now; `evidenceStatus` is not `REJECTED`; and, for a minor, a valid `GUARDIAN_VERIFIED` row exists and the row's method is accepted for that type (§12.4).

**Scope.** `TERMS`, `DATA_PROCESSING`, `COMMUNICATION` and `GUARDIAN_VERIFIED` are global. `PARTICIPATION`, `PUBLIC_DISPLAY`, `SOCIAL_MEDIA`, `AUCTION_OF_ARTWORK` and `PARTICIPANT_PHOTO_VIDEO` are per competition (or per `eventId`). Omitting the scope for a per-competition type throws `ConsentScopeError`. A scope passed for a global type is ignored.

```ts
type SubjectRef = string /* participantId */ | { userId: string };
type ConsentAction = 'CREATE_PROFILE' | 'REGISTER' | 'SUBMIT' | 'JUDGE' | 'PUBLISH_GALLERY' | 'POST_SOCIAL'
  | 'LIST_AUCTION' | 'SEND_MARKETING' | 'PUBLISH_EVENT_MEDIA';   // one per row of §12.4
ConsentService.has(subject, type, competitionId?): Promise<boolean>
ConsentService.require(subject, type, competitionId?): Promise<void>
  // throws ConsentRequiredError { subject, type, competitionId, reason:
  //   'MISSING'|'WITHDRAWN'|'STALE_VERSION'|'GUARDIAN_UNVERIFIED'|'EVIDENCE_REJECTED'|'METHOD_INSUFFICIENT' }
ConsentService.requireFor(subject, action: ConsentAction, competitionId?): Promise<void> // checks the §12.4 table
ConsentService.record(input: { subject, type, competitionId?, eventId?, granted, method, documentId,
  grantedByUserId?, grantedByGuardianId?, institutionId?, evidenceFileAssetId?, ip, userAgent }): Promise<Consent>
ConsentService.withdraw({ subject, type, competitionId?, actorUserId, reason? }): Promise<Consent>
  // inserts a granted=false row, sets withdrawnAt on the prior row, runs the §12.6 cascade, emits consent.withdrawn
ConsentService.status(subject, competitionId?): Promise<Record<ConsentType, ConsentState>>
ConsentService.currentDocument(type, locale): Promise<ConsentDocument>  // falls back to en-IN
```

**Who may record a grant** (enforced by `record`). An adult grants their own consent through `CHECKBOX_SELF`; a coordinator can never consent for an adult (for example a college student), who gets an invite instead. A minor's grant MUST come from the guardian (`GUARDIAN_OTP`, in a session authenticated by guardian OTP or a `GuardianInvite`) or from the coordinator of the subject's institution (`GUARDIAN_SIGNED_FORM_UPLOAD` with evidence, or `INSTITUTION_DECLARATION`). A minor can **withdraw** their own optional consents but can never grant one. `STAFF_ADMIN` can record a withdrawal on someone's behalf, with a reason, but never a grant.

**Stale versions.** `has()` and `require()` guard *new* uses. A `STALE_VERSION` result blocks new publications, posts and lots but does not take down existing ones. Affected users get a re-consent prompt.

**Capture UX.** Only the types relevant to the competition's config are shown (§6 `allowPublicDisplay`, `allowAuction`). Each checkbox is separate, links to the document in the viewer's locale, and shows the short version.

**ConsentDocument content (MUST).** Every document contains the itemised data, the purpose, how to withdraw, how to exercise rights, how to complain to the Board, and the grievance officer contact. In addition:
- `AUCTION_OF_ARTWORK` states: ownership of the physical work passes to FOA on dispatch; copyright stays with the creator, who grants FOA a non-exclusive licence to reproduce the work for the listing and campaigns; proceeds fund FOA's charitable purposes and are recorded in the ledger (§8); the creator is acknowledged and thanked, and receives no payment unless the competition's proceeds policy sets a creator share, which this form states; withdrawal has no effect once a lot closes with a winning bid.
- `PUBLIC_DISPLAY` lists the fields shown (§12.7) and says that withdrawal unpublishes within 24 h.
- `SOCIAL_MEDIA` lists the channels, says only stamped images are used, and says FOA cannot recall third-party reshares.

### 12.4 Consents Required per Action

| Action (owner §) | Required types | Scope | Methods accepted for a minor | Enforced at |
|---|---|---|---|---|
| Create account or participant profile (§6) | TERMS, DATA_PROCESSING, GUARDIAN_VERIFIED (minor) | global | GUARDIAN_OTP; school route also GUARDIAN_SIGNED_FORM_UPLOAD or INSTITUTION_DECLARATION | profile creation |
| Register for a competition (§6) | + PARTICIPATION | competition | as above | registration confirm |
| Submit an entry, including the shortlist upload (§6) | PARTICIPATION | competition | as above | submit and shortlist upload (Phase 7 "required declarations") |
| Judging (§7) | PARTICIPATION | competition | as above | round assignment |
| Gallery, or name on the public results page (§7) | PUBLIC_DISPLAY | competition | GUARDIAN_OTP, or GUARDIAN_SIGNED_FORM_UPLOAD with evidence ACCEPTED | publish |
| Social media post (§7, `/admin/social`) | PUBLIC_DISPLAY + SOCIAL_MEDIA | competition | as gallery | schedule and send |
| Auction lot (§8) | PUBLIC_DISPLAY + AUCTION_OF_ARTWORK | competition | as gallery | lot create and lot open |
| Marketing and engagement messages (§9, §10) | COMMUNICATION | global | GUARDIAN_OTP; messages go to the guardian | every send (suppression check) |
| Photo or video of the participant at an event (§9) | PARTICIPANT_PHOTO_VIDEO | competition or event | as gallery | upload of tagged event media |

Transactional messages (OTP, confirmations, results, certificates, replies to rights requests and safeguarding reports) do not need `COMMUNICATION`. Without `PUBLIC_DISPLAY`, the public results page shows the entry code and "Name withheld". Certificates are private documents and are not gated by consent. A nightly job, `consent.reconcile`, re-checks every public item (gallery, lots, scheduled posts). It unpublishes any item whose consent reason is `MISSING`, `WITHDRAWN` or `EVIDENCE_REJECTED` and alerts `SUPER_ADMIN`. The expected count is 0.

### 12.5 Guardian Verification for Minors

**Individual route (MVP, mandatory):**
1. The flow asks for DOB before any other personal data. If the person is under 18, it switches to "Ask your parent or guardian". The child may enter only the guardian's phone or email. Anything already typed is held encrypted in `PendingRegistration` and purged after `RETENTION_PENDING_REGISTRATION_DAYS`.
2. The guardian receives an OTP or link on the guardian's own contact. That contact MUST differ from the child's: the blind indexes are compared, and a match is rejected.
3. The guardian signs in or signs up as a `User` with the `GUARDIAN` role. They enter fullName, relationship and yearOfBirth, and tick "I am 18 or older and the parent or lawful guardian of this child". The guardian then creates the **managed** `ParticipantProfile` (`userId` null, `guardianId` set) and owns it.
4. In the same transaction: record `GUARDIAN_VERIFIED` and the chosen consents with method `GUARDIAN_OTP`, set `Guardian.verifiedAt`, and emit `guardian.verified`.
5. Minors aged `MINOR_LOGIN_MIN_AGE` (13) to 17 MAY get a login, but only through an invite from the guardian. Under-13s have managed profiles only. Feature flag `DIGILOCKER_GUARDIAN_VERIFICATION` (post-MVP) adds a DigiLocker age token (Rule 10(1)(b)(ii)).

**School route:**
1. When an institution registers for a competition (§6), the platform generates a consent form PDF at `/institution/competitions/[code]/consent-form.pdf`, in en-IN plus each enabled locale. The form shows the competition code, the IDs of the printed ConsentDocument versions, required and optional tick boxes, the child's name and class, and the guardian's name, relationship, phone, signature and date.
2. The coordinator adds students (§6). The guardian's name and phone are required for every minor; this creates an unverified `Guardian`.
3. For each student, the coordinator records the options ticked on the form, then either (a) uploads the signed scan (`GUARDIAN_SIGNED_FORM_UPLOAD`, evidence `PENDING_REVIEW`), or (b) records an `INSTITUTION_DECLARATION` in bulk: "The institution holds signed guardian forms for every listed student, with the options recorded, and will produce them on FOA's request." Staff review 10% of uploads at random, plus every upload a public use relies on. Staff also sample 5% of declarations by asking the school for the forms.
4. A guardian confirmation SMS is sent by default (`SCHOOL_ROUTE_GUARDIAN_CONFIRM=true`). It is a DLT SMS carrying a `GuardianInvite` link that shows the child's first name, the competition and the recorded options. The guardian can **confirm** (new `GUARDIAN_OTP` rows), **change** them, or answer **"I did not consent"**. The last answer withdraws everything optional, flags the registration and opens a staff task. The page also offers "Create an account to manage this profile".
5. **MVP default:** `INSTITUTION_DECLARATION` is enough for TERMS, DATA_PROCESSING, PARTICIPATION and GUARDIAN_VERIFIED, which covers judging but no public use. Every public use by a minor needs `GUARDIAN_OTP` or an ACCEPTED signed form. **This is a legal question (OQ-2).**

```prisma
model GuardianInvite { id String @id; tokenHash String @unique; guardianId String; participantId String?; competitionId String?
  purpose InvitePurpose /* CREATE_PROFILE | CONFIRM_SCHOOL_CONSENT | CLAIM_AT_MAJORITY */; channel String; expiresAt DateTime /* 7 days */; consumedAt DateTime? }
model PendingRegistration { id String @id; competitionId String; participantDraft Json /* enc */; guardianId String; accountHolderUserId String?; consentRequestId String
  expiresAt DateTime; status PendingRegistrationStatus /* AWAITING_GUARDIAN | COMPLETED | EXPIRED */; createdAt DateTime }  // holds an individual minor's registration until guardian verification; §6 converts it to a Registration on guardian.verified
// Additions to Guardian (§3.4): yearOfBirth Int?, adultDeclaredAt DateTime?, phoneHash String, emailHash String?  (phone/email stored encrypted)
// Addition to ParticipantProfile: majorityStatus (NOT_APPLICABLE | AWAITING_CLAIM | CLAIMED), managedByLawfulGuardian Boolean @default(false) (s.9(1) persons with disability; post-MVP UI)
```

### 12.6 Withdrawal Effects

`ConsentService.withdraw` emits `consent.withdrawn { subject, type, competitionId }`. The owning sections handle it idempotently. Withdrawal does not undo processing that was lawful before it, but processing MUST stop, and processors must also stop.

| Withdrawn | Effect | Owner | SLA |
|---|---|---|---|
| PUBLIC_DISPLAY | Cascade-withdraws SOCIAL_MEDIA and AUCTION_OF_ARTWORK for the same competition. Unpublishes gallery items. Results page shows "Name withheld". Deletes public WEB and STAMPED objects and purges the CDN. Removes the work from exhibition lists | §7 | ≤ 24 h (target 15 min) |
| SOCIAL_MEDIA | Cancels scheduled posts immediately. Creates a takedown task for each past post, assigned to `CONTENT_MANAGER` | §7 | Takedown within 72 h |
| AUCTION_OF_ARTWORK | A lot not yet open is cancelled. An open lot is cancelled, bidders are notified and holds released. A lot closed but unpaid is cancelled. A paid or sold lot is unaffected, and the reason is explained to the requester. On a cancelled lot, the artwork reverts to its pre-listing status (`statusBeforeListing`) via §8 → `setAuctionState` | §8 | ≤ 1 h |
| COMMUNICATION | Added to the suppression list; queued marketing messages are dropped | §10 | ≤ 1 h |
| PARTICIPANT_PHOTO_VIDEO | Tagged event media is unpublished; a "no photo" flag goes on the event attendee list | §9 | ≤ 24 h |
| PARTICIPATION | Before RESULTS_PUBLISHED, the entries become WITHDRAWN. After it, the outcome is kept and the name is withheld publicly. Refunds follow the §8 policy | §6 | Immediate |
| TERMS or DATA_PROCESSING | Treated as account closure: a `DataRequest(ERASURE)` is created automatically and all optional consents are withdrawn | §12.10 | Per §12.10 |
| GUARDIAN_VERIFIED | Cannot be withdrawn on its own. A guardian who withdraws it is treated as withdrawing DATA_PROCESSING for that child | — | — |

### 12.7 Minor-Specific Protections

| Public field | Minor default | Guardian opt-in (per field) | Adult |
|---|---|---|---|
| Name | First name and last initial ("Aarav S.") | `showFullName` | Their chosen displayName |
| Age | Age category only ("Group B, 9–12") | — | Age category |
| School | Hidden | `showSchool` | `showSchool` (default off) |
| Location | State and country | `showCity` | `showCity` (default off) |
| DOB, exact age, address, pin, phone, email, participantCode, photo of the participant | Never | Never | Never |

```prisma
model ParticipantDisplayPrefs { participantId String @id; showFullName Boolean @default(false); showSchool Boolean @default(false)
  showCity Boolean @default(false); updatedByUserId String; updatedAt DateTime }  // every change writes an AuditLog row
```

- **Display names.** The display name is generated from fullName. Edits must be 2–30 characters, using only letters, spaces and `.'-`. Digits, URLs and `@` are rejected, a profanity filter applies, and a minor's display name cannot contain the surname unless `showFullName` is on. Every change goes through moderation.
- **Metadata.** Every derivative is re-encoded with `sharp` and stripped of EXIF, GPS, XMP and IPTC. Video derivatives are run through `ffmpeg -map_metadata -1`. Essays are converted to PDF in the worker with author and producer metadata cleared. Originals keep their metadata but stay private.
- **Faces and identity.** The photography and videography rules (§6 content) say: no identifiable faces of other people without their consent, no faces of other minors, and no uniforms, name tags, house numbers or vehicle plates. Moderation checks this (§12.8). An entry that fails can still be judged but never goes public.
- **No public profiles or aggregation.** There is no participant page. A minor's entry page has no "more by this creator" link, is served with `noindex, noimageindex`, and is left out of the sitemap.
- **No user-to-user contact.** There are no DMs, comments, follows or public reactions between users. An adult reaches a minor only through `NotificationService` messages from staff, or from the coordinators of the minor's own institution. Those messages go to the guardian, and to a minor with a login only as a copy. Judges never contact participants. Judge feedback is released only after staff review.
- **Blind judging.** Judges see the entry code, category, age group and the work, per §4. Gallery attribution is never shown in the judging UI.
- **No tracking or ads (site-wide).** No third-party ad or remarketing pixels, no session replay, no personalisation or recommendations for minors. §11 reports on minors only as aggregates (minimum cell size 10).
- **Age gating.** Bidding (§8), adoption applications (§9) and creating NGO listings require an adult, shown by a declared DOB of 18 or more plus a verified phone. Minors cannot donate or bid (§8). A volunteer under 18 needs `GUARDIAN_VERIFIED` and gets only tasks that involve no minors' data.

### 12.8 Content Moderation

- **Automated checks (worker, before any human sees the upload).** Magic-byte type check, size and dimension caps (§13.1), then a ClamAV scan that sets `FileAsset.scanStatus`. INFECTED files are quarantined and staff alerted. Feature flag `IMAGE_SAFETY_CLASSIFIER` (default OFF, OQ-5) runs an NSFW/violence classifier through a vendor contracted as a processor with no retention or training. Text fields (title, description, statement, displayName) go through a PII detector (phone, email, URL, pin code, address patterns) and a profanity list. Results are written to `autoFlags`.
- **Pre-publication review.** No user-generated content goes public without an APPROVED review. This covers gallery items, results attribution, lots, event media, stories that mention participants, and display-name changes. §7 and §9 own their own publication states but MUST record this checklist:

```prisma
model ModerationReview { id String @id; targetType String; targetId String; status ModerationStatus /* PENDING | APPROVED | REJECTED | CHANGES_REQUESTED */
  checklist Json /* consentValid, noThirdPartyFaces, noPiiInImageOrText, ageAppropriate, matchesEntry */; autoFlags Json; reviewerUserId String?; reviewedAt DateTime?; reason String? }
model ContentReport { id String @id; targetType String; targetId String; reason ReportReason /* CHILD_SAFETY | PRIVACY | INAPPROPRIATE | COPYRIGHT | SPAM | OTHER */
  details String?; reporterUserId String?; reporterContact String?; status String /* OPEN | ACTIONED | DISMISSED */; createdAt DateTime }
```

- **Report flow.** Every public page that shows user content has a "Report" link that creates a `ContentReport`. The item is hidden automatically on a `CHILD_SAFETY` report or on 3 open reports from distinct reporters. A `CHILD_SAFETY` report also opens a CRITICAL `SafeguardingReport`. The moderation queue SLA is 24 h.

### 12.9 Safeguarding

```prisma
model SafeguardingReport { id String @id; reference String @unique /* SG-{YY}-{6 base32} */
  reporterUserId String?; reporterName String?; reporterContact String? /* enc */; reporterIsChild Boolean @default(false); anonymous Boolean
  subjectParticipantId String?; subjectUserId String?; relatedTargetType String?; relatedTargetId String?   // entry, lot, message, user
  category SafeguardingCategory /* CHILD_SAFETY_CONCERN | SUSPECTED_ABUSE | SUSPECTED_CSAM | INAPPROPRIATE_CONTACT | PRIVACY_EXPOSURE | BULLYING | ADULT_CONDUCT | OTHER */
  description String /* enc */; severity Severity /* CRITICAL | HIGH | MEDIUM | LOW */; status SafeguardingStatus
  assignedDslUserId String?; escalatedTo String?; escalationRef String?; legalHold Boolean @default(false)
  createdAt DateTime; triagedAt DateTime?; resolvedAt DateTime?; outcome String? }
model SafeguardingCaseNote { id String @id; reportId String; authorUserId String; body String /* enc */; createdAt DateTime }  // append-only
model SafeguardingDesignation { userId String @id; kind String /* DSL | DEPUTY_DSL */; appointedBy String; appointedAt DateTime; revokedAt DateTime? }
model SafeguardingClearance { userId String @id; codeOfConductVersion String?; codeOfConductAcceptedAt DateTime?; trainingCompletedAt DateTime?
  backgroundCheckType String? /* POLICE_VERIFICATION | SELF_DECLARATION | REFERENCE */; backgroundCheckStatus String /* NOT_STARTED | PENDING | CLEARED | FAILED | EXPIRED */
  evidenceFileAssetId String?; checkedAt DateTime?; expiresAt DateTime?; verifiedByUserId String? }
```

- **State machine.** `NEW → TRIAGED → INVESTIGATING → RESOLVED | ESCALATED`. `TRIAGED → RESOLVED` is allowed when no action is needed, and `ESCALATED → RESOLVED` when the external authority closes the matter. No other transitions are allowed. Every transition writes an `AuditLog` row with `before` and `after` limited to status, severity and assignee, never the case content.
- **Public form at `/safeguarding`.** Works without login, with an optional anonymous mode, a child-friendly version, Turnstile and rate limiting. A banner shows 112 (emergency), Childline 1098 and cybercrime.gov.in.
- **SLA.** CRITICAL: the DSL and deputy are paged by SMS and email at once; acknowledge within 1 h, 24×7, and triage within 4 h. HIGH: triage within 24 h. MEDIUM and LOW: triage within 72 h. Resolution target: 30 days. When an SLA is breached, the case escalates to the deputy DSL and then to `SUPER_ADMIN`.
- **Escalation.** SUSPECTED_ABUSE: the DSL reports to the SJPU or local police (POCSO s.19) and records `escalationRef`. SUSPECTED_CSAM: quarantine at once (public copies deleted, original moved to the evidence bucket under a `legalHold`, no further views), then report to the police or cybercrime.gov.in. Accounts involved are suspended pending review.
- **Confidential access.** Only `SUPER_ADMIN` and active `SafeguardingDesignation` holders can see `/admin/safeguarding` or case data. Case content is excluded from exports, analytics and search. Each view is logged (`safeguarding.viewed`).
- **Clearance gate.** `SafeguardingService.assertCleared(userId, purpose)` runs inside every service that returns minors' PII or enables contact with minors:

| Roles | Code of conduct (current version) | Background check | Refresh |
|---|---|---|---|
| SUPER_ADMIN, STAFF_ADMIN, COMPETITION_MANAGER, CONTENT_MANAGER, COMMUNITY_MANAGER, VOLUNTEER with minor-facing tasks | Required | POLICE_VERIFICATION CLEARED | 3 years |
| JUDGE (blind, remote) | Required | SELF_DECLARATION; POLICE_VERIFICATION for in-person judging | 3 years |
| INSTITUTION_ADMIN, INSTITUTION_COORDINATOR | Required | Vouched for by the institution under the Institution Terms | Each academic year |
| FINANCE, AUCTION_MANAGER, ADOPTION_COORDINATOR, ORG_REP | Required | — (no access to minors' PII) | 3 years |

### 12.10 Data-Principal Rights

```prisma
model DataRequest { id String @id; requestNumber String @unique /* DR-{YY}-{6 base32} */
  type DataRequestType /* ACCESS | EXPORT | CORRECTION | ERASURE | GRIEVANCE | NOMINATION */
  status DataRequestStatus /* RECEIVED | VERIFYING_IDENTITY | IN_PROGRESS | COMPLETED | PARTIALLY_COMPLETED | REJECTED | CANCELLED */
  subjectUserId String?; subjectParticipantId String?; requestedByUserId String?; requesterRelation String /* SELF | GUARDIAN | NOMINEE | STAFF_ON_BEHALF */
  requesterContact String? /* enc */; description String; correctionPayload Json?; dueAt DateTime; assignedToUserId String?
  resolutionNote String?; retainedCategories Json? /* [{category, reason, until}] */; exportFileAssetId String?
  createdAt DateTime; verifiedAt DateTime?; completedAt DateTime? }
model Nominee { id String @id; principalUserId String; name String; phone String /* enc */; relationship String; createdAt DateTime; revokedAt DateTime? }
model ErasureLedger { id String @id; subjectType String; subjectId String; dataRequestId String?; erasedAt DateTime }  // replayed after any backup restore
model LegalHold { id String @id; subjectType String; subjectId String; reason String; placedBy String; placedAt DateTime; releasedAt DateTime? }
```

- **Workflow.** `RECEIVED → VERIFYING_IDENTITY → IN_PROGRESS → COMPLETED | PARTIALLY_COMPLETED | REJECTED`. The requester may move it to CANCELLED before IN_PROGRESS. A request from an authenticated session skips VERIFYING_IDENTITY. Others are verified by OTP to a contact on file. Every response carries the grievance officer contact (Rule 9).
- **SLAs** (config): ACCESS and EXPORT are self-service in `/dashboard/privacy`, with the ZIP ready within 24 h; manual requests are answered within 15 days. CORRECTION: self-service fields are immediate, others within 7 days. A name or DOB change after certificates are issued triggers a §7 reissue. ERASURE: a 7-day cancellable cooling-off period, then execution within 30 days of the request. GRIEVANCE: acknowledged within 48 h and resolved within **30 days** (published; the legal cap is 90). NOMINATION: immediate.
- **Export.** A ZIP containing `data.json` (the subject's records as listed in the `pii()` registry, plus consents with document versions), the subject's entry originals, certificate PDFs and receipts. It excludes other people's data, judges' identities and raw scores, and safeguarding case content. The ZIP sits in the private bucket, behind a signed URL valid for 72 h, and is deleted after `RETENTION_EXPORT_ZIP_DAYS`.
- **Erasure.**
  1. **Preview.** The registry classifies each record as DELETE, ANONYMIZE or RETAIN (with reason and end date).
  2. **Execute** (idempotent job). Withdraw all consents (§12.6 cascade). Delete originals and derivatives in every bucket. Delete profile and guardian PII and set `User.status=DELETED`. Replace the participant link on registrations and entries with an "Erased participant" tombstone that keeps codes and outcomes. Reduce certificates to minimal form (number, competition, type, outcome, issuedAt, holder initials). Keep payments, donations and receipts until `RETENTION_FINANCIAL_YEARS` ends, then anonymize. Keep `AuditLog` rows (minimum 1 year) with PII keys inside `before`/`after` redacted. Keep consent rows as proof (§12.11). Call the processors' deletion and suppression APIs (SES, MSG91).
  3. **Record.** Write the `ErasureLedger` row and tell the requester which categories were retained and why. A `LegalHold` or open safeguarding case blocks erasure of the records it covers.
- **Guardians** exercise every right for a minor. A minor with a login can request ACCESS, and can request restriction or withdrawal; the guardian is notified.
- **Coming of age.** A daily job notifies the guardian (and the participant, if they have a login) 30 days before the 18th birthday. On the birthday it sets `majorityStatus=AWAITING_CLAIM`, sends a `CLAIM_AT_MAJORITY` invite, emits `participant.reachedMajority`, and makes guardian access read-only. On **claim**, the new adult verifies their own contact by OTP, the guardian link is archived, and the adult must re-confirm or withdraw each optional consent. Existing public uses continue; new uses wait for the re-confirmation. If the profile is unclaimed after `MAJORITY_CLAIM_GRACE_DAYS` (180), COMMUNICATION is suppressed and no new public uses are allowed.

### 12.11 Retention Schedule (config defaults; confirm every number with counsel)

| Data | Config key | Default |
|---|---|---|
| Abandoned minor sign-ups, unconfirmed drafts | `RETENTION_PENDING_REGISTRATION_DAYS` | 7 days |
| Originals and derivatives of entries never made public (NOT_SHORTLISTED, ELIMINATED, plain participants) | `RETENTION_UNSUCCESSFUL_ORIGINALS_MONTHS` | 12 months after RESULTS_PUBLISHED; minimal entry row kept for certificates |
| Originals of entries made public or auctioned | `RETENTION_PUBLISHED_ORIGINALS_YEARS` | 5 years after results; public derivatives only while consent is valid |
| Inactive accounts (no login and no participation) | `RETENTION_INACTIVE_ACCOUNT_YEARS` | 3 years; warn 30 days and again 48 h before erasure (mirrors Rule 8(2)) |
| Payments, donations, receipts, ledger, auction sales, PAN | `RETENTION_FINANCIAL_YEARS` | 8 years from the end of the financial year (tax and accounting law; confirm with the CA) |
| Consent rows and evidence files | `RETENTION_CONSENT_YEARS_AFTER_DATA` | 7 years after the data they cover is erased |
| `AuditLog` | `RETENTION_AUDIT_LOG_YEARS` | 3 years (legal minimum 1) |
| App, access and security logs | `RETENTION_APP_LOG_DAYS` | 365 days (Rule 8(3); CERT-In 180 days) |
| Certificate verification records | — | Indefinitely, in minimal form |
| Safeguarding reports and notes | `RETENTION_SAFEGUARDING_YEARS` | 7 years after closure, or until the subject turns 25, whichever is later; legal hold overrides |
| DataRequests | `RETENTION_DATA_REQUEST_YEARS` | 3 years after closure |
| Clearance evidence files | `RETENTION_CLEARANCE_EVIDENCE_MONTHS` | 12 months after the engagement ends; status row kept 3 years |
| Notification and message logs | `RETENTION_NOTIFICATION_LOG_DAYS` | 365 days |
| Shipping addresses (prizes, lots) | `RETENTION_SHIPPING_ADDRESS_DAYS` | 90 days after delivery |
| Losing bids; rejected volunteer and adoption applications | `RETENTION_MISC_MONTHS` | 12 months |
| Export ZIPs | `RETENTION_EXPORT_ZIP_DAYS` | 7 days |
| Backups | — | PITR window plus 35-day dumps; `ErasureLedger` replayed on any restore |

The nightly job `retention.sweep` skips any `LegalHold` and writes an `AuditLog` summary. Every week it emails `SUPER_ADMIN` a dry-run report of the next week's deletions. Defaults live in `src/server/config/privacy.ts`. `SUPER_ADMIN` can override them in the `Setting` table (§13.9), and each override is audited.

### 12.12 Breach Response

```prisma
model SecurityIncident { id String @id; title String; awareAt DateTime; severity Severity; personalDataInvolved Boolean; minorsAffected Boolean
  affectedCount Int?; status String /* OPEN | CONTAINED | NOTIFIED | CLOSED */; certInReportedAt DateTime?; boardInitialAt DateTime?
  boardDetailedAt DateTime?; principalsNotifiedAt DateTime?; summary String; rootCause String?; leadUserId String }
```

| By | Step |
|---|---|
| T0 | Record `awareAt`. The `SUPER_ADMIN` on call leads the incident. The DSL joins if minors are affected. Counsel is informed. |
| ≤ 1 h | Contain: rotate secrets, revoke sessions and keys, disable accounts, pull public assets. |
| ≤ 6 h | CERT-In report, if the incident type is listed (applicability per counsel). |
| Without delay (internal target ≤ 24 h) | Initial notice to the Board. Notify affected people (the guardian, for a minor) by email, SMS and dashboard with the Rule 7(1) contents: what happened, the likely consequences, the mitigation, steps they can take, and a contact. The bulk send uses `NotificationService` with a transactional template and ignores `COMMUNICATION` suppression. |
| ≤ 72 h | Detailed report to the Board under Rule 7(2)(b). |
| ≤ 14 days | Post-incident review, with remediation tracked. Notice templates are pre-approved by counsel. A tabletop exercise runs once a year. |

### 12.13 Pages

| Route | Access | Features |
|---|---|---|
| `/admin/consents` | STAFF_ADMIN, COMPETITION_MANAGER (read), SUPER_ADMIN | Search by participant code, registration number or institution. Per-subject consent timeline. Per-competition consent matrix with CSV export (for gallery, social and auction decisions). Evidence review queue (accept or reject). Declaration sampling queue. ConsentDocument editor with versioning and locale; only SUPER_ADMIN can publish, with step-up auth. |
| `/admin/safeguarding` | SUPER_ADMIN, DSL / deputy DSL | Queue sorted by severity with SLA timers. Case view with append-only notes. Escalation log. Clearance management. Designations (SUPER_ADMIN). |
| `/admin/data-requests` | STAFF_ADMIN, SUPER_ADMIN (execute erasure) | Queue with due dates. Identity verification. Export generation. Erasure preview and execute (step-up). Legal holds. |
| `/dashboard/privacy` | Self; guardian for each managed child | Consent toggles per child and competition, with an effect explanation and confirm dialog. Display preferences. Download my data. Correction and erasure requests. Nominee. Grievance form and officer contact. Claim my account at 18. |
| `/privacy`, `/terms`, `/child-protection-policy`, `/safeguarding` | Public | CMS-managed and versioned per locale. `/privacy` shows the grievance officer and the published response periods. |

§12 emits these domain events: `consent.requested` (when a §12.5 guardian link or OTP request is sent), `consent.granted`, `consent.refused`, `consent.withdrawn`, `guardian.verified`, `dataRequest.received`, `dataExport.ready`, `dataErasure.completed`, `safeguardingReport.submitted`, `safeguardingReport.escalated`, `content.reported`, `participant.reachedMajority`, `user.contactChanged`, `incident.declared`.

### 12.14 Acceptance Criteria

1. With no consent rows, `has()` returns false for every type, and a gallery publish for that participant fails with `ConsentRequiredError(MISSING)`.
2. A minor's PUBLIC_DISPLAY recorded by `INSTITUTION_DECLARATION` fails `require()` with `METHOD_INSUFFICIENT`. The same consent through GUARDIAN_OTP passes.
3. Any UPDATE or DELETE on `Consent` other than the two allowed transitions is rejected by the DB (integration test).
4. Withdrawing PUBLIC_DISPLAY removes the public gallery page (HTTP 404/410) and the CDN object within 15 min in staging. A SOCIAL_MEDIA takedown task exists for each past post. An OPEN lot ends up cancelled.
5. Guardian OTP sent to the same phone as the child's is rejected. A minor cannot record a grant but can withdraw.
6. Publishing a material ConsentDocument version blocks new uses (STALE_VERSION) and leaves existing published items untouched.
7. A minor's public entry page shows "First L.", the age category and state/country, and no school or city. It is served with `X-Robots-Tag: noindex, noimageindex` and is absent from `sitemap.xml`.
8. A downloaded public derivative contains no EXIF or GPS tags (checked with `exiftool` in CI on a fixture).
9. A user who has not accepted the code of conduct gets a 403 from every service returning minors' PII. Judges never receive name, school or city in any API payload.
10. `/safeguarding` accepts anonymous reports. A CRITICAL report pages the DSL within 1 min. A STAFF_ADMIN without a designation gets a 403 on `/admin/safeguarding`.
11. An export ZIP contains only the subject's data. Erasure leaves payments, minimal certificate rows and audit rows, removes every PII column in the registry, and writes `ErasureLedger`. A restore drill that replays the ledger re-erases the subject.
12. Every PII column is in the `pii()` registry (the CI test passes). Guardian phone and email and DOB are ciphertext in the DB.
13. The `consent.reconcile` job reports 0 public items without valid consent after the E2E suite runs.
14. A participant turning 18 gets AWAITING_CLAIM. After the claim, the guardian has no access and optional consents need re-confirmation.

### 12.15 Open Questions

- **OQ-1** Does guardian OTP plus self-declared name, relationship and year of birth satisfy Rule 10 due diligence? *Default: yes for MVP; DigiLocker token behind a flag after MVP.*
- **OQ-2** Is FOA's duty met by an institution declaration or school-collected forms? *Default: a declaration allows judging only; public uses need a guardian OTP or an accepted signed form.*
- **OQ-3** Is the school a joint fiduciary or a processor acting for FOA when it enters student data? *Default: FOA is the Data Fiduciary, and the Institution Terms bind the school as acting on FOA's instructions.*
- **OQ-4** What is the minimum age for a minor's own login? *Default: 13; under-13s are managed only.*
- **OQ-5** Should minors' images go to a third-party image-safety classifier? *Default: OFF; manual moderation only.*
- **OQ-6** What background check do judges need? *Default: self-declaration plus code of conduct for remote blind judging; police verification for in-person judging.*
- **OQ-7** Are the retention periods in §12.11 right, especially financial (8 years) and consent (+7 years)? *Default: as in the table.*
- **OQ-8** Do guardian-given consents survive the participant turning 18? *Default: existing uses continue; new uses need the adult's re-confirmation; 180-day grace.*
- **OQ-9** What is the donation cap for logged-in minors? *Resolved: minors cannot donate or bid online; a guardian donates on their behalf (§8).*
- **OQ-10** Is the auction consent irrevocable once a lot closes with a winning bid, and does physical ownership pass to FOA on dispatch? *Default: yes to both.*
- **OQ-11** Should the DSL be a `Role` enum value? *Default: no; use a `SafeguardingDesignation` that only SUPER_ADMIN can grant.*
- **OQ-12** How does a lawful guardian of an adult with a disability get verified (s.9(1), Rule 11)? *Default: post-MVP, using the `managedByLawfulGuardian` flag and the guardian flow.*

## 13. Non-Functional Requirements

### 13.1 Security

- **Target:** OWASP ASVS 5.0 Level 2. An external penetration test against that scope MUST pass before the pilot launch, with no open high or critical findings.
- **Authentication.** OTPs are 6 digits, valid 10 min, with at most 5 verify attempts per code. Sending is limited to 1 per 60 s, 5 per hour and 10 per day per identifier, and 30 per hour per IP; ten failed verifications in an hour lock the identifier for 15 min. OTP inputs use `autocomplete="one-time-code"` and allow paste. Passwords are optional; if set, at least 12 characters, checked against a breached-password list.
- **Sessions and 2FA.** Lifetimes: MEMBER, PARTICIPANT and GUARDIAN 30 days sliding; INSTITUTION_* and JUDGE 7 days; staff roles 12 h absolute and 30 min idle. Cookies are `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, rotated on login and on any role change. Staff roles must use 2FA (TOTP or passkey). Step-up 2FA no older than 10 min is required for role changes, ConsentDocument publish, erasure execution, exporting another person's data, safeguarding case access, results publish and refunds.
- **Authorization.** `can()` is checked inside domain services and denies by default. Every query is scoped by owner, institution or assignment, so a guessed ID never returns data. Unit tests cover every row of the §4 permission matrix. Signed URLs are issued only after the check.
- **CSRF.** Server Actions rely on Next.js origin checks. Mutating Route Handlers verify `Origin`. Webhooks verify the provider's signature or secret (Razorpay HMAC with `RAZORPAY_WEBHOOK_SECRET`; the SNS message signature for SES; MSG91 per §10.7) and are idempotent. `/api/internal/revalidate` checks its HMAC instead of `Origin` (§2.2).
- **Headers.** Strict nonce-based CSP: `default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic' https://checkout.razorpay.com https://challenges.cloudflare.com; frame-src https://api.razorpay.com https://checkout.razorpay.com https://challenges.cloudflare.com; img-src 'self' data: blob: {PUBLIC_CDN_URL}; connect-src 'self' {storage upload host} {Sentry ingest}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. Also send `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")` and `Cross-Origin-Opener-Policy: same-origin`.
- **Input.** zod validates at every boundary. Rich text passes through a single allowlist sanitizer. Raw SQL is allowed only as Drizzle's tagged `sql` template; `sql.raw` never takes input.
- **Uploads.** Presigned uploads are constrained to the declared size and MIME type and land under a `quarantine/` prefix. The worker verifies magic bytes, size and pixel count (≤ 50 MP, which blocks decompression bombs), runs ClamAV, and promotes only CLEAN files. Allowed: JPEG, PNG, WebP and HEIC (converted) up to 20 MB; PDF and DOCX (converted to PDF in the worker) up to 10 MB for user uploads, while staff-uploaded AwarenessResource PDFs may be up to 25 MB; MP4, MOV and WebM up to 500 MB and 5 min. §6 may set lower limits per competition.
- **Originals.** Never public. Served only through signed URLs (≤ 5 min) with `Content-Disposition: attachment`. Public files are always re-encoded derivatives.
- **Secrets.** Vercel encrypted env vars, per environment. VPS worker secrets live in root-only Compose env files on the VPS. gitleaks runs in CI and GitHub secret scanning is on. API tokens are least-privilege (one storage token per bucket). Secrets rotate every 12 months and whenever a staff member leaves.
- **Dependencies.** Renovate runs weekly. `pnpm audit --audit-level high` blocks CI. CodeQL runs on every PR. Critical vulnerabilities are patched within 72 h and high ones within 7 days.
- **Encryption.** TLS 1.2+ everywhere (1.3 preferred), including PgBouncer. R2 encrypts objects at rest (AES-256). Backups are encrypted before they leave the VPS (pgBackRest repository encryption; `age` for the daily dumps). Whether the VPS disk is encrypted at rest is a question for Hostinger. A separate evidence bucket (`foa-evidence`) holds consent forms, clearance documents and safeguarding files, with no public access and R2 bucket locks.
- **PII field-level encryption.** `Guardian.phone`, `Guardian.email`, `ParticipantProfile.dateOfBirth` and the fields marked enc in §12 are encrypted with AES-256-GCM in the repository layer (an encrypted Drizzle `customType` in `src/server/db/pii.ts` encrypts on write and decrypts on read), stored as `v1:{kid}:{iv}:{ct}:{tag}` with keys from `PII_ENCRYPTION_KEYS` and `PII_ENCRYPTION_ACTIVE_KID`. Exact-match lookups use HMAC-SHA256 blind indexes (`phoneHash`, `emailHash`, keyed by `PII_HASH_KEY`) over normalized values (E.164 phone, lowercased email). DOB is decrypted only in the app; the age group is computed there and snapshotted by §6, so no SQL filters on DOB. The `pii.rekey` job re-encrypts after a key rotation.
- **Audit.** `AuditLog` per §3.3, plus `pii.viewed` rows whenever a minor's PII, an original file or an evidence file is opened.
- **Admin protection.** `/admin` is limited to 300 requests/min per user. `ADMIN_IP_ALLOWLIST` is optional and applies to SUPER_ADMIN. A sign-in from a new device emails the user.
- **Public forms.** Turnstile, a 10 requests/min per IP limit (stored in Postgres, §2), and a honeypot field.
- **Backups.** pgBackRest archives WAL to an encrypted R2 repository at least every 60 s (`archive_timeout = 60`), with 30 days of PITR. A daily `age`-encrypted `pg_dump` goes to a separate, locked R2 bucket and is kept 35 days. R2 has no object versioning, so originals are never overwritten: keys are UUIDs or content hashes, and every write uses `If-None-Match: *`. RPO ≤ 5 min, RTO ≤ 4 h. Every quarter, a restore drill restores into `pg-nonprod`, replays `ErasureLedger`, runs smoke tests, and records the time taken.

### 13.2 Performance

- **Core Web Vitals.** Measured at p75 on a mid-range Android phone over 4G (Lighthouse mobile with 4× CPU throttling): LCP < 2.5 s, INP < 200 ms, CLS < 0.1. Lighthouse CI must score ≥ 85 for performance on `/`, `/competitions/[slug]`, `/gallery`, `/donate` and `/verify/[n]` in previews.
- **Budgets.** Initial JS ≤ 170 KB gzipped on public pages. Gallery thumbnails ≤ 60 KB.
- **Images.** sharp pre-generates derivatives (THUMB 400 px, WEB 2,048 px long edge) in AVIF and WebP with a JPEG fallback. `next/image` uses a custom loader pointing at the CDN. Below-the-fold images lazy-load. Fonts are self-hosted and subset with `font-display: swap`; Devanagari loads only for `hi`.
- **Caching.**
  - Public pages are cached with `'use cache'` and `cacheTag`: competitions use `cacheLife({ revalidate: 300 })`, plus tag revalidation on publish (§2.2).
  - Gallery and results revalidate on demand at moderation, publish and withdrawal (§2.2), with the CDN purge finishing within 15 min.
  - Stamped assets use content-hashed keys with `Cache-Control: public, max-age=31536000, immutable`.
- **Server latency (p95).** Cached reads < 100 ms; DB-backed pages < 300 ms; Server Action mutations < 500 ms (excluding third-party calls); presigned upload URL < 300 ms; Razorpay order creation < 1.5 s; DB queries < 50 ms. Server p99 < 1.5 s. Drizzle on postgres.js runs through PgBouncer in transaction mode (`prepare: false`, a small pool per function instance), every FK and filter column is indexed, and N+1 queries are checked in review.
- **Load profile (assumption, to confirm).** Pilot scale: 100 schools and 20,000 participants. Peak in the 2 h before a submission deadline: 2,000 concurrent users, 500 concurrent image uploads (5 MB average) and 20 video multipart uploads, about 100 server requests/s. Results day: 5,000 certificate downloads per hour. The image pipeline must process ≥ 1,000 images in 10 min. Each competition deadline is preceded by a k6 load test on staging at 2× this profile.

### 13.3 Availability and Observability

- **SLOs.** 99.5% monthly availability for the public site, auth and submission. 99.9% during critical windows (the 48 h before a submission deadline, and results day). No deploys in the 24 h before a deadline. Razorpay webhooks are processed within 5 min (p99). Notification dispatch p95 < 2 min. Consent-withdrawal unpublish < 15 min.
- **Sentry.** Errors plus 10% performance tracing from the app (`@sentry/nextjs`) and the worker (`@sentry/node`), with `sendDefaultPii: false`. Every pg-boss schedule has a Sentry cron monitor. `beforeSend` scrubs name, phone, email and DOB keys. Session Replay is off.
- **Logs.** Structured JSON (pino) with `requestId`, `userId` and `route`, and no PII values. Drained to a log store with 365-day retention. The log region is a CERT-In question for counsel.
- **Uptime and queues.** Checks every 1 min from at least 2 regions on `/`, `/api/health` (DB, queue and worker heartbeat), `/verify/{fixture}` and the webhook endpoint. Job queue monitoring tracks depth, failures, the dead-letter queue and the age of the oldest job.
- **Alerts.** SEV1 (SMS or phone, on-call): two consecutive uptime failures, error rate > 2% for 5 min, webhook failures 3 times in a row, oldest job > 10 min, worker heartbeat stale, backup failure, a CRITICAL safeguarding SLA breach. SEV2 (email or Slack): p95 > 2 s for 10 min, DB CPU > 80% for 15 min, a `consent.reconcile` count above 0.

### 13.4 Accessibility and Child-Friendly UX

- **Standard.** WCAG 2.2 AA. Playwright plus axe-core on every key page must show 0 serious or critical violations.
- **Keyboard.** Every flow works by keyboard alone: visible focus that is never hidden (2.4.11), and a skip link.
- **Screen readers.** NVDA with Chrome and TalkBack with Chrome are tested on the register, consent, submit, donate and safeguarding flows.
- **Contrast and targets.** Text contrast ≥ 4.5:1 and UI contrast ≥ 3:1. Targets ≥ 24×24 px (2.5.8), and primary actions ≥ 44×44 px.
- **Forms.** Visible labels, errors linked through `aria-describedby`, and an error summary. No redundant entry (3.3.7). Accessible authentication (3.3.8). A non-drag alternative for uploads (2.5.7). No time limits except OTP, which can be resent.
- **Media and motion.** Gallery alt text is the title plus an optional participant-provided description. FOA-produced video is captioned. `prefers-reduced-motion` is honoured.
- **Child-friendly UX.** Participant-facing copy aims for a Flesch-Kincaid grade of 6 or below (checked in CI on the message files for those flows). Each consent shows its "short version" first. Icons are always paired with text. One primary action per screen, with progress steps in multi-step flows. No dark patterns: no pre-ticked boxes, no confirm-shaming, and "No" as prominent as "Yes".

### 13.5 Internationalization

- **Locales.** next-intl with `localePrefix: 'as-needed'`. Launch with `en-IN`. `hi-IN` comes next (legal pages and ConsentDocuments at launch, §12.1). Then bn, mr, ta, te, kn, ml, gu, pa and or.
- **Strings.** Every string lives in `messages/{locale}.json`. oxlint `react/jsx-no-literals` blocks hard-coded UI strings.
- **Content and templates.** Email, SMS and PDF templates exist per locale. SMS templates are DLT-registered per language. CMS content is per locale with an `en-IN` fallback. `User.locale` decides the notification language.
- **Formatting.** `Intl` APIs throughout. Display timezone `Asia/Kolkata` by default. Dates in `dd MMM yyyy`. Currency through `Intl.NumberFormat('en-IN', {style:'currency', currency})`, which gives Indian grouping (₹1,23,456). No RTL at launch, but layouts use logical CSS properties.

### 13.6 SEO

- **Metadata.** `generateMetadata` on every public page: title ≤ 60 characters, description ≤ 160, a canonical URL, and `hreflang` per locale.
- **Sitemap and robots.** `sitemap.xml` lists competitions, results, blog, events, NGOs and gallery entries **of adults only**. `robots.txt` disallows `/admin`, `/dashboard`, `/institution`, `/judge`, `/api` and `/verify`.
- **Open Graph images.** Taken only from `StampService.stamp(…, {variant:'SOCIAL'})` derivatives, with a default branded image as fallback.
- **Structured data.** JSON-LD for `NGO`/`Organization` (site-wide), `Event` (competitions and events), `Article` (blog), `BreadcrumbList` and `DonateAction`. No `Person` data for minors.

### 13.7 Browser and Device Support

| Tier | Targets |
|---|---|
| Full support | Chrome Android, Samsung Internet, Safari iOS 16+, and Chrome, Edge, Firefox and Safari desktop (last 2 major versions) |
| Devices | Android 9+ with 2 GB RAM, viewports from 320 px |
| Degraded but usable | Older evergreen browsers; core flows work over 3G (multipart uploads resume) |
| Not supported | IE, Opera Mini extreme mode, KaiOS |

### 13.8 Environments, CI/CD, Seed and Feature Flags

- **Environments** (hosting and databases: §2.4). **local**: Mailpit for email, Razorpay mocked. **preview** per PR: Razorpay test mode, email only to an allowlist, SMS logged rather than sent. **staging**: production-like, Razorpay test mode, SMS only to allowlisted numbers. **production**: SES out of sandbox, Razorpay live. Production data is never copied to another environment.
- **CI on each PR (GitHub Actions).** Install, then oxlint and `oxfmt --check`, then `tsc --noEmit`, then Vitest (≥ 80% coverage on `server/domain`, 100% of state-machine transitions), then `drizzle-kit check` plus a migration drift check (`drizzle-kit generate` must produce no new migration), then build. The PR then deploys a preview, whose `vercel-build` creates `foa_pr_<n>` from the seeded `foa_seed` template and applies the `drizzle/` migrations through `DIRECT_URL`. GitHub Actions runs Playwright E2E, axe and Lighthouse CI against it. gitleaks, `pnpm audit` and CodeQL also run.
- **Release.** A merge to `main` auto-deploys staging. Production needs a manual promotion with approval. Migrations run in `vercel-build` under a Postgres advisory lock (§2.3), before the traffic switch, and MUST be expand/contract (backward compatible). Worker images deploy from GitHub Actions (§2.3). Rollback uses Vercel instant rollback for the app and redeploys the previous GHCR image tag for the worker; DB problems get a forward fix.
- **Seed (`scripts/seed.ts`, idempotent, synthetic only; previews are cloned from a `foa_seed` database built from it).** Beyond the §2.1 baseline (1 competition, 3 schools, 30 participants, 2 judges): participants under 13, aged 13–17 and adults across both routes; guardians with consents of every `ConsentMethod`, one withdrawn and one stale-version consent; ConsentDocuments in en-IN and hi-IN; one DataRequest of each type; one synthetic SafeguardingReport; one user per `Role`. Phone numbers come from a reserved test range. OTP uses `DEV_OTP_BYPASS_CODE`, which is ignored when `APP_ENV=production`.
- **Feature flags.** Stored in a `FeatureFlag { key, enabled, rolloutPercent?, updatedBy, updatedAt }` table that SUPER_ADMIN edits, with env overrides. Flags: `AUCTIONS`, `ADOPTION`, `VOLUNTEERS`, `NGO_DIRECTORY`, `EVENTS`, `COMMUNITY`, `CLUBS`, `AMBASSADORS`, `SOCIAL_PUBLISHING` (API posting to social networks, post-MVP, §7.11; MVP is manual export), `SMS_CHANNEL`, `WHATSAPP_CHANNEL`, `MINOR_LOGIN`, `IMAGE_SAFETY_CLASSIFIER`, `DIGILOCKER_GUARDIAN_VERIFICATION`, `LOCALE_HI`. Post-MVP modules (§1) ship dark behind their flags.

### 13.9 Configuration (required environment variables)

| Variable | Envs | Purpose |
|---|---|---|
| `APP_ENV`, `APP_URL` | all | `local`, `preview`, `staging` or `production`; canonical base URL |
| `DATABASE_URL`, `DIRECT_URL` | all | `DATABASE_URL`: PgBouncer, transaction mode (in the worker: Postgres directly on the Compose network, §2.2). `DIRECT_URL`: PgBouncer session-mode entry with the migrator role, for migrations |
| `AUTH_SECRET` | all | Session and token signing (≥ 32 bytes) |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | all | Cloudflare R2 S3 API (`https://<account-id>.r2.cloudflarestorage.com`, region `auto`); local: RustFS or the in-memory driver (§2.4) |
| `STORAGE_BUCKET_PRIVATE`, `STORAGE_BUCKET_PUBLIC`, `STORAGE_BUCKET_EVIDENCE`, `PUBLIC_CDN_URL` | all | Production values: `foa-private`, `foa-public`, `foa-evidence`; CDN host `media.<foa-domain>`. Preview and staging use separate non-production buckets, never the production ones (§13.8); local: RustFS or the in-memory driver (§2.4) |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_PURGE_TOKEN` | deployed | CDN purge by URL (§7.10, §12.6) on the zone that serves `PUBLIC_CDN_URL`; the token can only purge cache on that zone |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | all except local (mocked) | Payments (§8) |
| `SES_REGION` (`ap-south-1`), `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_CONFIGURATION_SET`, `SES_SNS_TOPIC_ARN`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | all except local (Mailpit) | Email through Amazon SES (§10). `/api/webhooks/ses` accepts messages only from `SES_SNS_TOPIC_ARN` |
| `SMS_PROVIDER_API_KEY`, `SMS_DLT_SENDER_ID`, `SMS_DLT_ENTITY_ID` | staging, production | DLT-compliant SMS (template IDs live on `NotificationTemplate.dltTemplateId`) |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ENVIRONMENT` | all except local | Errors and cron monitors (app and worker); source-map upload from CI |
| `PII_ENCRYPTION_KEYS` (JSON kid→base64 32 B), `PII_ENCRYPTION_ACTIVE_KID`, `PII_HASH_KEY` | all | Field-level encryption and blind index (§13.1) |
| `REVALIDATE_SECRET` | deployed | HMAC key for `/api/internal/revalidate`, shared by the app and the worker (§2.2) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | deployed | Bot protection on public forms |
| `MALWARE_SCAN_URL` | all (worker only) | `clamd` TCP address on the Compose network (e.g. `tcp://clamav:3310`) |
| `GOTENBERG_URL` | all (worker only) | Gotenberg on the Compose network (DOCX→PDF) |
| `SAFEGUARDING_ALERT_EMAILS`, `SAFEGUARDING_ALERT_PHONES` | production, staging | Paging for CRITICAL reports |
| `ADMIN_IP_ALLOWLIST` | optional | CIDR list for SUPER_ADMIN |
| `DEV_OTP_BYPASS_CODE` | local, preview | Test OTP; ignored in production |
| `IMAGE_SAFETY_API_KEY`, `DIGILOCKER_CLIENT_ID`, `DIGILOCKER_CLIENT_SECRET` | optional (flags) | Post-MVP integrations |

Env is validated at boot with zod (`src/env.ts`), in the app and in the worker: the app validates it in `register()` (`src/instrumentation.ts`), so a missing required variable fails the start. `next build` needs no required variable; the Vercel build still fails without `DIRECT_URL`, because `vercel-build` runs the migrations through it. Backup credentials (pgBackRest and dump-bucket R2 tokens, the repository cipher passphrase) live only on the VPS, never in Vercel.

**Runtime settings.** `Setting { key String @id, value Json, updatedBy String, updatedAt DateTime }` is the runtime configuration table that SUPER_ADMIN edits. Each section's config keys live here, and changes are audit-logged.

### 13.10 Acceptance Criteria

1. securityheaders.com grades production A or better. The CSP has no `unsafe-inline` for scripts.
2. OTP limits are enforced: the 6th send within an hour returns 429, and the 6th verify attempt invalidates the code.
3. A staff account without 2FA cannot reach `/admin`. Step-up actions fail if the last 2FA is older than 10 min.
4. Uploading an EICAR test file ends INFECTED and is never promoted. A `.exe` renamed to `.jpg` is rejected by the magic-byte check. An original's URL is never present in public HTML.
5. Lighthouse CI on the preview meets the §13.2 CWV and budget thresholds on the listed pages.
6. A k6 run at 2× the load profile on staging holds p95 Server Action latency < 500 ms with an error rate < 1%.
7. axe reports 0 serious or critical violations. Keyboard-only E2E completes register, consent, submit and donate.
8. Every UI string comes from the message files (lint passes). Switching the locale to `hi-IN` renders the legal pages and consent documents in Hindi.
9. `sitemap.xml` contains no minor's entry. Every public page has a title, description, canonical URL and OG image.
10. A preview deploy creates its own database `foa_pr_<n>` on `pg-nonprod` from `foa_seed`, migrates it, and the E2E suite passes against it. The database is dropped when the PR closes. A missing env variable fails the boot.
11. The quarterly restore drill completes within the 4 h RTO, and its report is filed in `/admin/reports`.
12. Sentry events contain no email, phone, name or DOB values (fixture test of the scrubber).

## 14. Build Milestones & Acceptance Criteria

The order follows the source's 6-month objectives: get one pilot competition running end to end first, then fundraising and transparency, then the wider ecosystem. Each milestone ends with a deployable build on staging and a passing E2E suite for its criteria.

| Milestone | Theme | Sections | Target |
|---|---|---|---|
| **M0** | Foundations | §2, §3, §4, §12 (core), §13 | Weeks 1–2 |
| **M1** | Institutions & registration | §6.1–§6.6 (registration, fees), §8 payments core, §12 consent | Weeks 3–5 |
| **M2** | Submissions & school-level judging | §6 submission, §7 rubrics and school round, §10 core | Weeks 6–8 |
| **M3** | Physical artwork & FOA judging | §6 physical track, §7 FOA rounds, judge dashboard | Weeks 9–11 |
| **M4** | Results, certificates, gallery | §7 results/certificates/stamping/gallery/social export | Weeks 12–14 |
| **M5** | Donations & transparency, CMS | §8 donations/ledger/transparency, §9 CMS/blog/home/contact, §11 basic reports | Weeks 15–18 |
| — | **Pilot competition live** | | ~Month 4–5 |
| **M6** | Community & volunteers | §9 community, engagement ladder, clubs, ambassadors, volunteers, events | Post-pilot |
| **M7** | Ecosystem | §9 NGO directory, adoption facilitation | Post-pilot |
| **M8** | Auctions & advanced analytics | §8 auctions, §11 full analytics, feedback surveys | After physical artwork from the pilot is verified |

### M0 — Foundations
- Next.js + TypeScript strict + Tailwind/shadcn scaffold matching the §2.1 layout. Drizzle connected to the VPS Postgres through PgBouncer (§2.3). CI in GitHub Actions runs lint, typecheck, Vitest, and Playwright E2E against preview deployments.
- Auth: email OTP and phone OTP login. Sessions. `UserRole` with scoped roles. `can()` policy helper. Staff 2FA.
- `AuditLog`, `Outbox`, job worker, `FileAsset` with presigned upload, the `Setting` runtime-configuration table (§13.9; changes audit-logged), `lib/ids` (§3.1 code generators with tests), `lib/money`.
- `ConsentDocument`/`Consent` tables and `ConsentService` skeleton. Legal pages served from CMS stubs.
- Seed script (§2.1).
- **Accept when:** a user can sign up and log in by OTP; a SUPER_ADMIN can grant a scoped role; every mutation in the demo writes an AuditLog row; a file uploads directly to the bucket and is retrievable only through a signed URL by an authorized user; the VPS Compose services (`pg-prod`, `pgbouncer`, `worker`, `clamav`, `gotenberg`) are healthy; a backup and a restore drill pass; a preview database can be created from `foa_seed` and dropped; CI is green.

### M1 — Institutions & Registration
- `/schools/register`, admin institution verification, institution competition registration, coordinator student management including CSV import.
- Competition admin CRUD with categories, age groups, dates, fees, scope flags, and a status machine driven by scheduled jobs.
- Individual registration with guardian capture and verification (§12). A minor's individual registration is held as a `PendingRegistration` (§12.5) and becomes a Registration on `guardian.verified`. Registration status machine. `PaymentService` with Razorpay (test mode) for individual and bulk institution fees: one order per `RegistrationPaymentBatch` (a batch of one for an individual, of N for an institution). Offline payments via `recordOfflinePayment` (FINANCE, STAFF_ADMIN). Webhooks are idempotent.
- **Accept when:** an institution registers → is verified → registers for a competition → imports 30 students from CSV (with an error report for bad rows) → pays a bulk fee (one `RegistrationPaymentBatch` order) → all 30 registrations become CONFIRMED with registration numbers. A minor registering individually stays a `PendingRegistration` until guardian verification, so can't reach CONFIRMED without it. A replayed webhook doesn't double-confirm. A capture for a registration that is no longer payable puts the batch in NEEDS_REVIEW and refunds nothing automatically. A competition's status flips automatically at its registration-open/close instants.

### M2 — Submissions & School-Level Judging
- Entry submission per discipline with file rules, derivatives, EXIF strip and scan gate. Entry codes. Confirmation notifications.
- Phase 3 announcements to registrants. Conduct certification by the coordinator.
- §7.1 rubrics: the competition can't enter SCHOOL_JUDGING until a PUBLISHED rubric resolves for every enabled discipline (§6.3.4).
- School round: opens when the competition enters SCHOOL_JUDGING (both scopes); coordinator enters panel, positions and shortlist; certifies; finalizes. `finalizeSchoolRound` calls `EntryService.applySchoolShortlist` once per category and is the sole emitter of `schoolShortlist.finalized`. Entries move to SCHOOL_SHORTLISTED / NOT_SHORTLISTED (under SHORTLIST_ONLY, `createShortlistedEntry` creates them). There is no auto-finalise: at `shortlistSubmissionClosesAt` an unfinished round becomes OVERDUE; the school can still finalize, otherwise staff close it on its behalf (§7.15 E5). A reopened round reverts its shortlist through `EntryService.revertSchoolShortlist`. Shortlisted entries are uploaded in hi-res with declarations → SUBMITTED_TO_FOA. FOA verification → FOA_VERIFIED.
- NotificationService with email + SMS adapters, templates, and an in-app inbox.
- **Accept when:** both `DigitalSubmissionScope` modes work end to end for the school route; the individual route reaches FOA_VERIFIED; an upload over the size limit or of the wrong type is rejected client- and server-side; shortlisted and not-shortlisted families each receive the correct message; a school round unfinished at `shortlistSubmissionClosesAt` becomes OVERDUE, is never auto-finalised, and blocks SCHOOL_JUDGING → FOA_JUDGING until it is finalized (by the school or on its behalf); reopening a finalized school round reverts its shortlist only while none of its entries is FOA_VERIFIED or later; the full EntryStatus transition test table passes.

### M3 — Physical Artwork & FOA Judging
- PhysicalArtwork track: request → dispatch (tracking) → receive → verify/discrepancy, with condition photos and storage location.
- FOA rounds with rubric, judge assignment, conflict-of-interest declaration, blind scoring UI, aggregation, tie-break, round lock. Multi-level rounds (at least SCHOOL → NATIONAL in the pilot; others configurable).
- **Accept when:** a judge sees only assigned entries with no participant PII; a round can't be locked while an assigned entry is unscored, unless an admin overrides it with a reason; a round with `requiresPhysicalVerified` doesn't expose entries for which `ArtworkService.physicalReady(entryId)` is false (artwork required for judging and not VERIFIED, IN_EXHIBITION or RETAINED); aggregate rankings match a hand-computed fixture.

### M4 — Results, Certificates, Gallery
- Results approval (two-person rule), scheduled publish, public results page.
- Certificate generation for all types, QR verification page, revoke/reissue, participant download, institution bulk ZIP.
- StampService (GALLERY / SOCIAL / CERT_SHARE). Gallery with consent gating and moderation. Admin social export queue.
- **Accept when:** publishing results issues the correct certificate type to every registrant (participation for everyone, merit/finalist/winner as earned); scanning a certificate QR shows VALID, and after revocation shows REVOKED; no public URL ever resolves to an ORIGINAL asset (automated test crawls gallery and results pages); withdrawing PUBLIC_DISPLAY consent unpublishes the gallery item within the §12 SLA.

### M5 — Donations, Transparency, CMS
- Donations (one-time + recurring; adults only, so a guardian donates on a minor's behalf), receipts (delivered as a signed download link valid 7 days, never an attachment), donor wall opt-in, corporate disclosure choice, offline donation entry.
- Ledger with automatic postings, manual entries, budgets, period lock. `/transparency` page computed from published periods.
- CMS pages, blog, home composition, contact inbox, impact counters. Basic reports and the admin home queues (§11).
- **Accept when:** a captured donation produces exactly one ledger entry and one receipt with the next sequential number for the FY; a signed-in minor can't donate; a refund creates a reversal entry; the transparency page totals equal the ledger totals for published periods and expose no donor PII; `fundsRaisedMinor` on `/impact` equals the `/transparency` donations total for the same period; Lighthouse ≥ 90 for performance and accessibility on home, competition and gallery pages (mobile).

### M6–M8 — Post-Pilot
- **M6:** community membership, engagement timeline and milestones, post-competition invitations, clubs, ambassadors, volunteers (application → approval → tasks → hours), events with registration/waitlist/check-in.
- **M7:** NGO directory (self-registration, verification, geo search) and adoption facilitation (listings, applications, coordinator workflow).
- **M8:** auctions (lots from consented artwork that is VERIFIED, IN_EXHIBITION or RETAINED and reverts to its pre-listing status if the lot is cancelled or unsold, bidding with anti-sniping, payment window, fulfilment, artist thank-you, proceeds in the ledger), feedback surveys, full analytics and social metric snapshots.
- Each module's acceptance criteria are in its section (§8, §9, §11).

### 14.1 Definition of Done (every milestone)
- Migrations applied cleanly on a fresh DB and on a copy of staging.
- State machines have exhaustive transition unit tests.
- New domain events that send a message have a §10.3 row and templates; any other event is analytics-only. Reminders are §10 `reminder.<name>` keys, never emitted by sections.
- New personal-data fields are listed in the §12 data inventory, with retention set.
- Authorization tests exist for every new server action (allowed role passes; at least one disallowed role fails).
- No `console.log` of PII. Sentry receives errors from staging.
- Accessibility check (axe) passes on new pages.

## 15. Open Questions, Defaults & Deviations

Each section ends with its own detailed open-questions list. This section collects the ones that need a **decision from FOA leadership, counsel or the accountant**. Every item already has a default applied in the spec, so building isn't blocked; changing a default means changing config or the cited section.

### 15.1 Decisions for FOA (product)

| # | Question | Default applied | Where |
|---|---|---|---|
| P1 | Should every student submit digitally, or only the school's top N? (the source says this is "still debating") | Configurable per competition (`DigitalSubmissionScope`); default `ALL` | §6.16 |
| P2 | How many entries a school shortlists per category | 5 per category per school (`Competition.schoolShortlistSize`); 3 school positions | §6.16, §7.17 |
| P3 | Award scheme: A/B grade vs gold/silver/bronze vs All-India 1/2/3 | Configurable per round; `Competition.awardScheme` is the final round's default, RANKED 1/2/3 | §7.17 |
| P4 | Which judging levels are active for the pilot (City/State/National/Global) | School round, then a single NATIONAL final round judged on the physical artwork | §7.17 |
| P5 | Registration fee amounts, who pays on the school route, refund policy | Config values (no amounts invented). School route: institution pays in bulk. No refunds after CONFIRMED except cancellation or duplicates; CM/SA may request a discretionary refund, which FINANCE approves | §6.16, §8.3 |
| P6 | Physical artwork after judging: return or retain, and who pays shipping | Retain unless return is requested within 30 days of results; the shipping payer is stated in the packaging instructions | §6.16 |
| P7 | Can minors' artwork be auctioned, and how are proceeds split | Yes, with verified guardian AUCTION_OF_ARTWORK consent and the credit capped at first name + initial. 100% of proceeds to FOA unless the competition's proceeds policy sets a creator share, which the AUCTION_OF_ARTWORK consent form states (§12.3); creators and schools receive an acknowledgement letter | §8.14, §12.15 |
| P8 | Ambassador eligibility, minimum volunteer age, clubs per institution | Thresholds in config: volunteers 14+ with guardian approval; 1 club per institution | §9.16 |
| P9 | Should post-competition invitations ship with the pilot (M5) instead of M6? | M6, with a backfill run so the pilot cohort is still invited | §9.16 |
| P10 | WhatsApp notifications at launch | No; email, SMS and in-app first, WhatsApp adapter post-MVP | §10.10 |

### 15.2 Decisions for Counsel (legal / compliance)

| # | Question | Default applied | Where |
|---|---|---|---|
| L1 | Is guardian OTP plus the parent's self-declared details enough for verifiable parental consent under DPDP Rules, Rule 10? | Yes for MVP; DigiLocker age token behind a feature flag | §12.1, §12.15 |
| L2 | On the school route, can FOA rely on the institution's declaration or on forms the school collects? | A declaration covers participation and judging only. Any **public** use (gallery, social, auction) needs guardian OTP or an accepted signed form | §12.5 |
| L3 | Is the school a joint data fiduciary or acting for FOA? | FOA is the fiduciary; Institution Terms bind schools to act on FOA's instructions | §12.15 |
| L4 | Minimum age for a minor's own login | 13; under-13s have guardian-managed profiles only | §12.15 |
| L5 | Retention periods (unsuccessful entries, consents, audit logs, financial records) | The §12.11 table: config values, every number marked "confirm" | §12.11 |
| L6 | Background checks for judges and volunteers who interact with minors | Self-declaration plus code of conduct for remote blind judging; police verification for in-person work | §12.9 |
| L7 | Copyright and ownership of minors' artwork in the gallery and at auction | Copyright stays with the creator. Physical ownership passes to FOA on dispatch only for auction-consented works | §8.14, §12.15 |

> **Compliance timeline:** India's DPDP Act 2023 and DPDP Rules 2025 commence in phases. Per the research in §12.1, the core duties (notice, consent, children's data under s.9, data-principal rights, breach reporting) apply from **13 May 2027**. The spec builds for them from day one, so the pilot doesn't need re-engineering later. Verify the dates with counsel.

### 15.3 Decisions for Finance / Accountant

| # | Question | Default applied | Where |
|---|---|---|---|
| F1 | Does FOA hold 80G / 12A (tax-deductible receipts)? | `org.has80G = false`; the receipt template and PAN capture are ready behind config | §8.14 |
| F2 | FCRA registration (foreign donations) | `org.fcraEnabled = false`; INR/domestic only; foreign payments auto-refunded | §8.14 |
| F3 | GST on registration fees and auction sales | No GST invoices; accountant to confirm | §8.14 |
| F4 | Who registers FOA with Indian telecom regulators for bulk SMS (DLT sender ID and templates), and when | FOA, before M2; SMS stays disabled until approved, with email and in-app as the fallback | §10.10 |
| F5 | How much is shown on `/transparency` | Aggregates by category per published month. Disclosed organisations shown with FY totals; individuals by name only, if they opted in; budgets hidden | §8.14 |

### 15.4 Deliberate Deviations From the Source Document

| # | Source says | Spec does | Why |
|---|---|---|---|
| D1 | Login with "FOA Participant ID + Competition Registration Number" | Participant ID (or email/phone) as identifier **plus a one-time password** to the participant's or guardian's verified contact; the registration number is never a credential | The registration number is printed on certificates and shared with schools, so it can't act as a secret |
| D2 | "Age category" collected as a field | Computed from date of birth against the competition's age cut-off date | Avoids mismatched data |
| D3 | Phase 5 (physical collection) placed before school judging | Merged with Phases 8 and 14 into one physical-artwork track that starts **after** a shortlisted entry is verified (the source's own "MOVE THIS HERE" note) | Avoids couriering work that will be eliminated |
| D4 | Phases jump from 11 to 14 | Phases 12–14 are treated as the physical-artwork track, per the source's closing paragraph ("physical artwork (12–14)") | Numbering gap in the source |
| D5 | Judges evaluate entries | Judges see **anonymized** entries (entry code only) | Fairness, and child data protection |
| D6 | Gallery shows "participant's approved display name, school, city" | Minors default to first name + last initial; school and city only with guardian opt-in per field | DPDP children's-data duties |
