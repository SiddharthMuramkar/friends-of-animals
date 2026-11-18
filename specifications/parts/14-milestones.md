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
