# Spec check: FOA brief vs closed issues

Checked 2026-11-26 against GitHub `SiddharthMuramkar/friends-of-animals`. Evidence is **closed issues only**: their bodies, acceptance criteria, closing PRs and closing comments. The README ticket board and HR register are used only to say what is _switched on_. The original brief is copied at the end ([Appendix](#appendix-the-brief-as-handed-over)).

## Result in one paragraph

Every role, module, data entity and workflow in the brief maps to at least one closed ticket. All six "open contradictions" in section 6 were ruled on (#10, #15) and the rulings were built. Four items were delivered **partly, on purpose**: courier tracking is typed in by hand, social posts are exported and posted by hand, Umami analytics is separate from the internal reports, and vets are a directory _service_, not a listing type. Nothing in the brief is missing outright. The real gap is **live vs built**: most features are switched off in production until FOA finishes owner steps (accounts, keys, legal sign-off), listed in [Built is not live](#built-is-not-live).

**Key:** ✅ built (ticket closed) · 🟡 built, switched off until an owner step (HR id) · ↔ built differently on purpose · ❌ not covered

## Evidence that the tickets are closed

| Fact                                                     | Value                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Open issues in the repo                                  | **0**                                                                                                        |
| Closed issues                                            | 122 (all issues ever filed)                                                                                  |
| Spec parent                                              | #55 "Spec: Friends of Animals platform, M0–M8", closed by merged PR #288 on 2026-11-26                       |
| Build tickets                                            | #56–#135 (80 tickets, milestones M0–M8), all closed as _completed_                                           |
| Closed by merged PRs                                     | 72: big integration PRs #285 (13 tickets) and #288 (30 tickets), the rest by earlier "train" PRs (#136–#272) |
| Closed by hand, with a comment listing the PRs           | 8: #56, #57, #80, #83, #85, #105, #114, #116 (their PRs said `Refs #N`, so GitHub didn't auto-close them)    |
| Research and decision tickets behind the stack and rules | #1–#15, #17, #18, #23, #27, #29 (all closed)                                                                 |
| Public-site bug batches                                  | #32–#52 (all closed)                                                                                         |

Check it yourself:

```sh
gh issue list --state open                       # prints nothing
gh issue list --state closed --limit 500 --json number --jq length   # 122
gh issue view 55 --json state,closedAt           # CLOSED, 2026-11-26
```

## Section 1: roles

| Brief role                       | Closed tickets                                                                                                                                                                                                                                                                           | Verdict                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Public visitor                   | Public site #14; competition pages #70; gallery #103; auction listings #131, #132; adoption listings #129; NGO directory #127, #128; transparency #110; QR certificate check #100                                                                                                        | ✅                                                                                 |
| Individual participant           | Email and phone sign-in #57, #58; registration, Participant ID and dashboard #78; uploads #85, #86; dispatch status #93; certificate download #100; engagement history #119                                                                                                              | ✅ 🟡 sign-in needs AWS SES (HR-12); uploads need R2 (HR-13, HR-35)                |
| Parent / guardian                | Guardians and minors #81; consent per purpose #82; consent by code link or signed form #83; auction consent #131                                                                                                                                                                         | ✅ 🟡 off in production until safeguarding and legal sign-off (HR-32, HR-33)       |
| School / institution coordinator | Institution registration and Institution ID #73; coordinators #74; competition registration #75; certify conduct #87; shortlist upload #89; dispatch tracking #93; bulk certificate ZIP #101                                                                                             | ✅                                                                                 |
| Judge / jury                     | Onboarding, code of conduct, conflicts #95; blind scoring with rubric and comments #96; rankings and "suitable for auction" flag #97                                                                                                                                                     | ✅ 🟡 police checks and conduct text (HR-38, HR-39)                                |
| FOA administrator                | Competitions #70–#72; institution verification #73; entry verification #92; artwork verification #94; results #99; auctions #131–#133; donations #106–#108; adoptions #130; volunteers #123, #124; content #111, #112; finance #105, #109; analytics #117, #135; roles #59; settings #62 | ✅ 🟡 nobody can sign in to production yet (HR-17, HR-18)                          |
| Auction buyer                    | Bidding and outbid alerts #132; payment, confirmation and delivery tracking #133                                                                                                                                                                                                         | ✅ 🟡 `auctions.enabled` off; payments need Razorpay (HR-15); rulings HR-63, HR-64 |
| Donor / corporate / CSR          | One-time donations with organisation disclosure choice #106; monthly donations #107; offline and 80G #108; disclosure shown on transparency page #110                                                                                                                                    | ✅ 🟡 Razorpay live keys (HR-15)                                                   |
| Animal-welfare ecosystem user    | Directory self-registration and verification #127; search by service and distance #128; adoption listings #129; coordinator workflow #130                                                                                                                                                | ✅ ↔ vets are not a listing type (see [Partial on purpose](#partial-on-purpose))   |
| Prospective adopter              | Browse and filter #129; apply and track #130                                                                                                                                                                                                                                             | ✅                                                                                 |
| Volunteer / community member     | Volunteer applications #123; tasks, hours and certificates #124; membership and timeline #119; clubs #121; ambassadors #122                                                                                                                                                              | ✅                                                                                 |

## Section 2: modules

| Brief module                            | Closed tickets                                                                                                                                                       | Verdict                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Static and CMS pages                    | Public site #14; CMS pages and impact counters #111; blog and stories #112; contact inbox #113; events #125; campaigns #126; awareness fixes #47                     | ✅                                                            |
| Digital art gallery                     | Consent-gated gallery, reports, purge on withdrawal #103; credit rules #82                                                                                           | ✅                                                            |
| NGO directory                           | #127, #128                                                                                                                                                           | ✅ 🟡 distance search needs pin-code data (HR-59, HR-60)      |
| Financial transparency portal           | Transparency page #110, read from the ledger #105, only locked months #109                                                                                           | ✅                                                            |
| Auth and dual registration, unique IDs  | #57, #58; institution route #75; individual route #78; IDs: Institution ID #73, Participant ID and registration number #78, Entry ID #85, Artwork ID #93             | ✅                                                            |
| Dedicated portals                       | Participant dashboard #78; institution dashboard #75; judge dashboard #96; admin home #117                                                                           | ✅                                                            |
| Engagement history tracker              | Membership, timeline and the ladder #119                                                                                                                             | ✅                                                            |
| Competition engine                      | #70–#72, #75, #78, #85–#92, #95–#99                                                                                                                                  | ✅                                                            |
| Certificates and QR verification        | Certificates for every tier with QR #100; revoke, reissue, bulk ZIP #101                                                                                             | ✅ 🟡 design sign-off (HR-42); PDFs need worker-media (HR-35) |
| Social media asset pipeline             | Logo stamping #102; export queue with captions #104                                                                                                                  | ✅ ↔ posted by hand, no auto-posting                          |
| Art auction and payments                | #131, #132, #133                                                                                                                                                     | ✅ 🟡 HR-15, HR-63, HR-64                                     |
| Donation management                     | #106, #107, #108                                                                                                                                                     | ✅ 🟡 HR-15, HR-16                                            |
| Finance / budget                        | Ledger with automatic postings #105; budgets, period lock, two approvers, accountant export #109; auction proceeds #133                                              | ✅ 🟡 accountant's chart of accounts (HR-47)                  |
| Adoption management                     | #129, #130                                                                                                                                                           | ✅                                                            |
| Community and volunteer management      | #119–#124                                                                                                                                                            | ✅                                                            |
| Notifications                           | Outbox and worker #61; templates, inbox, preferences #69; announcements and reminders #84; per-event messages in #89, #93, #99, #132, #133                           | ✅ 🟡 email HR-12, SMS HR-14, worker rebuild                  |
| Reports and analytics                   | Admin queues and basic reports #117; objective reports and social metrics #135; surveys #134; Umami #118                                                             | ✅ ↔ Umami is separate from internal reports                  |
| Privacy, consent, safeguarding (minors) | Consent documents #64; guardian flows #81–#83; data inventory and retention #114; privacy requests #115; safeguarding and breach log #116; consent gating #103, #131 | ✅ 🟡 counsel rulings and sign-offs (HR-30–HR-33)             |

## Section 3: data entities

| Brief entity           | Closed tickets                                                                                                                                                            | Verdict |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Competition            | Definition, disciplines, age groups, mode, flags #70; schedule-driven status #71; fees, award schemes, consent documents #72; rubrics #88; upload scope #91               | ✅      |
| Institution            | Name, type, address, pin code, contacts, principal, expected count, Institution ID #73; coordinators #74; registration reference #75                                      | ✅      |
| Individual participant | Participant ID, registration number, details #78; guardian details #81; consents #64, #82; age category from date of birth #75, #78                                       | ✅      |
| Submission / entry     | Image #85; video and essay #86; coordinator submits #87; school rank #89; verification #92                                                                                | ✅      |
| Physical artwork       | Artwork ID, request, dispatch, tracking, receipt #93; verification, condition, dimensions, material, consent check #94                                                    | ✅      |
| Judging record         | Rounds by tier (city/district, state, national, global) #95, #98; scores and comments #96; rank, grade and auction-suitable flag #97; school tier is the school round #89 | ✅      |
| Auction listing        | Lot fields, base and reserve price, dates #131; bid history #132; winning bid, payment, delivery, ledger link #133                                                        | ✅      |

## Section 4: workflows

| Brief workflow                    | Closed tickets                                                                                     | Verdict             |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------- |
| 1. Registration and conduct       | Institution route #73 → #74 → #75 → #89 → #87; individual route #78                                | ✅                  |
| 2. Digital submission and judging | Intake #85, #86; school shortlist #89, #91; FOA tiers #95–#98; results and certificates #99, #100  | ✅                  |
| 3. Physical artwork               | Verified #92 → requested, dispatched, received #93 → physically verified #94                       | ✅                  |
| 4. Showcase and social            | Consent #82 → gallery #103; certificate or asset → stamped #102 → export #104                      | ✅ ↔ manual posting |
| 5. Auction and ledger             | Verified + consented #94, #131 → bidding #132 → payment, confirmation, delivery #133 → ledger #105 | ✅                  |

## Section 5: integrations and non-functional

| Brief item               | What was built (closed tickets)                                                                                                                                                  | Verdict                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Media storage and CDN    | Cloudflare R2, private and public buckets, signed URLs, malware scan #63; image derivatives #85; video transcodes #86; nightly copy to Backblaze B2 #68                          | 🟡 no R2 account yet (HR-13); worker-media not running (HR-35); B2 not set up (HR-25)                           |
| Payment gateway          | Razorpay: school bulk fees #77, individual fees #78, refunds #80, donations #106, monthly donations #107, auction payment #133                                                   | 🟡 live KYC and keys (HR-15)                                                                                    |
| Email and SMS            | Amazon SES #57; MSG91 #58; outbox #61; templates #69                                                                                                                             | 🟡 SES approval (HR-12); DLT registration (HR-14)                                                               |
| Logistics / courier      | Tracking number and courier name typed in #93; auction delivery status tracked #133                                                                                              | ↔ no courier API (out of scope in #55)                                                                          |
| Analytics and monitoring | Umami #118; GlitchTip errors, uptime checks, 365-day logs #66; internal reports #117, #135                                                                                       | 🟡 Umami env vars (HR-52); alerts and log store (HR-23, HR-24) ↔ Umami data is not pulled into internal reports |
| Security and compliance  | Append-only audit log #59; staff two-factor #60; consent as an event log #64; CSP #65; security headers #50; public QR verify #100; encrypted personal fields; privacy #114–#116 | ✅ 🟡 CSP is Report-Only (HR-19); counsel rulings (HR-30)                                                       |

## Section 6: the six contradictions

All six were ruled on in #10 ("Apply the spec's integration fixes and list what's still contradictory") and #15 ("Rule on the spec's remaining contradictions"), written into #55, then built.

| #   | Contradiction                           | Ruling                                                                                                                          | Built in        |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | All entries vs shortlist-only upload    | Set per competition; default is all participants                                                                                | #91             |
| 2   | Certificates without full rosters       | Schools import the whole class by CSV; every eligible participant gets a participation certificate                              | #76, #100       |
| 3   | When physical artwork is dispatched     | One linear flow: shortlisted → digitally verified → physical work requested once → received → physically verified → FOA judging | #92, #93, #94   |
| 4   | Individual screening                    | Individuals skip the school round, pass FOA's digital check first, then ship if the competition needs the physical work         | #92, #93        |
| 5   | Registration fees                       | Fee fields per route #72; school bulk payment #77; individual payment #78; offline payments and review #79; refunds #80         | #72, #77–#80    |
| 6   | Minors' privacy in gallery and auctions | First name plus last initial by default; school and city only if the guardian opts in, per field; never contact data            | #82, #103, #131 |

## Partial on purpose

1. **Courier integration.** The brief asks for "tracking-number capture and delivery status updates". Tracking numbers are typed in by hand (#93 inbound, #133 auction delivery), and staff update the status. #55 put courier APIs out of scope. Adding one later is a new ticket.
2. **Social media publishing.** The brief says "prior to publishing to social media channels". Images are logo-stamped and queued with captions (#102, #104), and staff post them by hand. #55 put auto-posting out of scope.
3. **Analytics feeding the internal dashboard.** Umami (#118) has its own dashboard at `stats.friendsofanimals.dev`. Internal reports (#117, #135) come from the platform's database, and social-media numbers are typed in by staff (#135).
4. **Vets.** Directory listing types are NGO, rescue organisation, shelter, independent rescuer and foster caregiver. Vet care appears as a service a listing offers, not as its own type. Adding a type is a small schema change.

## Built is not live

From the README "Status at a glance" and "HR register". These are owner actions, not missing code.

| Area                         | In production today                              | What turns it on                                                   |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| Email sign-in                | Off ("Sign-in opens soon")                       | AWS SES production access (HR-12)                                  |
| Staff area                   | Nobody can use it                                | Sign-in, then the first super admin and named staff (HR-17, HR-18) |
| Phone (SMS) sign-in and SMS  | Off                                              | DLT registration through MSG91 (HR-14)                             |
| Payments, refunds, donations | Every payment refused                            | Razorpay live KYC and keys (HR-15)                                 |
| Uploads, entries, video      | Refused                                          | Cloudflare R2 account (HR-13) and worker-media (HR-35)             |
| Guardian and minors' flows   | Off in code                                      | Safeguarding sign-off and legal copy (HR-32, HR-33)                |
| Analytics                    | Off                                              | Umami env vars on Vercel (HR-52)                                   |
| Off-site backups             | None (backups on the same disk)                  | B2 and pgBackRest repo2 (HR-25)                                    |
| FOA's real facts             | Placeholders (`"facts":"incomplete"`)            | Staff enter them (HR-21)                                           |
| Production worker            | Old code (built 2026-11-22)                      | Rebuild worker-prod from `main`                                    |
| Production deploy            | Last deploy `375eb35d`, before PRs #285 and #288 | Deploy `main` (run the F2 check first)                             |

**Seen on 2026-11-26:** on `friendsofanimals.dev`, `/gallery` and `/verify` answer **HTTP 500**. `/`, `/competitions`, `/impact`, `/transparency`, `/donate`, `/ngos`, `/adopt`, `/auctions`, `/events`, `/safeguarding`, `/sign-in` and `/api/health` answer 200. Production predates the last 43 tickets, so a fresh deploy of `main` is the likely fix. The cause was not investigated.

## Appendix: the brief as handed over

## 1. System Actors & Role-Based Access Control (RBAC)

| Role                                 | Access Scope & Core Capabilities                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public Visitor**                   | View public pages, digital art gallery, auction listings, adoption listings, NGO directory, public financial transparency reports, and QR certificate verification pages.                                        |
| **Individual Participant**           | Register/login (`FOA Participant ID`), enter competitions, upload digital submissions, track entry/dispatch status, download certificates, view engagement history.                                              |
| **Parent / Guardian**                | Submit verifiable consent for minor participants (participation, communications, public display, artwork ownership/auction rights).                                                                              |
| **School / Institution Coordinator** | Onboard institution (`Institution ID`), register for competitions, certify school-level conduct/judging, upload shortlisted entries, manage physical dispatch tracking, bulk-download student certificates.      |
| **Judge / Jury Member**              | Access Jury Dashboard, score assigned entries against standardized rubrics, add rankings/comments, flag entries suitable for fundraising auctions.                                                               |
| **FOA Administrator**                | Configure/publish competitions, approve/verify institutions and entries, log physical artwork verification, publish results, manage auctions, donations, adoptions, volunteers, content, finance, and analytics. |
| **Auction Buyer**                    | Browse approved artwork listings, place bids, complete payments, track order confirmation and physical delivery.                                                                                                 |
| **Donor / Corporate / CSR Sponsor**  | Make one-time or recurring donations; toggle public name disclosure (named vs. anonymous).                                                                                                                       |
| **Animal-Welfare Ecosystem User**    | NGOs, rescue orgs, shelters, independent rescuers, foster caregivers, vets, and adoption coordinators: register in the searchable directory, manage animal adoption listings, coordinate adoptions.              |
| **Prospective Adopter**              | Search adoption listings and submit adoption inquiries/applications.                                                                                                                                             |
| **Volunteer / Community Member**     | Register as a volunteer, participate in community features, track progression toward club/ambassador roles.                                                                                                      |

---

## 2. Core Functional Modules

### Public Web & Content

- **Static & CMS Pages:** Home, About, Impact / Our Work, Animal Welfare & Awareness, Schools & Institutions info, Events & Campaigns, News / Stories / Blog, Contact Us.
- **Digital Art Gallery / Showcase:** Consent-gated public showcase displaying artwork media, title, approved display name, age/category, institution, city/country, competition, award/recognition, and artist message.
- **Animal-Welfare NGO Directory:** Searchable, structured database of registered NGOs, rescue organisations, independent rescuers, foster caregivers, and volunteers.
- **Financial Transparency Portal:** Public read-only view of financial and transaction records synced from the internal finance module.

### Identity, Dashboards & Lifecycle

- **Auth & Registration:** Dual registration (Individual vs. Institutional), unique ID generation (`FOA Participant ID`, `Institution ID`, `Competition Registration Number`, `Submission / Entry ID`, `Artwork ID`).
- **Dedicated Portals:** User Dashboard, School / Institution Dashboard, Judge / Jury Dashboard, FOA Admin Dashboard.
- **Engagement History Tracker:** Persistent user state tracking longitudinal progression (`Participant → School Winner → FOA Finalist → Community Member → Volunteer → Ambassador`).

### Competitions, Certificates & Media

- **Competition Engine:** End-to-end management of creation, dual-route registration, digital/physical submission, multi-tier judging, and result publication.
- **Certificates & Verification:** Automated certificate generation across tiers (Participation, School Merit/Winner, Finalist, National/Global Winner/Runner-up) with unique certificate numbers and QR-code verification; bulk downloads for schools and individual downloads for participants.
- **Social Media Asset Pipeline:** Automated FOA logo stamping on certificates/assets prior to publishing to social media channels; Content / Social Media Management module.

### Fundraising, Commerce & Finance

- **Art Auction & Payment Management:** Listing creation, reserve/base pricing, scheduled open/close windows, bidding engine, winner selection, payment processing, confirmation, and delivery tracking.
- **Donation Management:** One-time and recurring donation processing with sponsor disclosure preference flags.
- **Finance / Budget Management:** Internal ledger recording auction proceeds, donations, and budgets, feeding directly into the Financial Transparency portal and reporting tools.

### Operations, Adoption & Safeguarding

- **Animal Adoption Management:** Facilitator workflow connecting shelters/NGOs/rescuers/fosters/vets/adoption coordinators with prospective adopters.
- **Community & Volunteer Management:** Onboarding, activity tracking, and role assignment for community members and volunteers.
- **Notifications & Communications:** Event-driven email and SMS triggers across registration, shortlisting, physical dispatch, receipt acknowledgement, results, and auctions.
- **Reports & Analytics:** Platform-wide operational, participation, and financial reporting.
- **Privacy, Consent & Safeguarding (Minors):** Granular consent storage, minor-account protections, guardian verification, and explicit IP/ownership/proceeds consent gating before any public display or auction listing.

---

## 3. Core Data Entities & Required Fields

- **Competition:** Name, theme, animal-welfare message, type (`Drawing`, `Painting`, `Art`, `Craft`, `Essay`, `Photography`, `Videography`), eligibility & age groups, participation mode (individual/institutional), registration open/close dates, conduct/submission dates, rules/guidelines, judging criteria/rubric, prizes/recognition, physical submission requirement (e.g., Top 5 / Top 10), public display permission flag, auction eligibility flag, terms & consent requirements.
- **Institution:** `Institution ID`, institution name, pin code, address, city, country, contact details, Principal (email, phone), Authorised Coordinator (email, phone), expected participant count, competition registration reference.
- **Individual Participant:** `FOA Participant ID`, `Competition Registration Number`, name, age / DOB, age category, phone, pin code, city, state, country, optional school/college name, parent/guardian details (conditional on minor status), selected competition, communication consent, participation consent.
- **Submission / Entry:** `Unique Submission / Entry ID`, participant ID, institution vs. individual flag, competition/category, uploaded media (high-res photo/scan/video/doc), title, short description, optional artist message/statement, school-level rank (if institutional), required declarations/consents, submission timestamp, current status.
- **Physical Artwork Record:** `Artwork ID`, linked entry/creator, packaging/address/deadline metadata, courier tracking ID, receipt timestamp, verification audit fields (digital-to-physical match, physical condition log, dimensions, material, verified consent documentation).
- **Judging Record:** Judge ID, entry ID, rubric scores, grade/rank (`A/B Grade`, `Gold/Silver/Bronze`, or `1st/2nd/3rd`), judge comments, judging tier (`School`, `City/District`, `State`, `National`, `Global` — individually toggleable per competition), auction-suitability flag.
- **Auction Listing:** Artwork ID, artwork image, title, consent-gated creator info, artist story/message, competition/award metadata, base/reserve price, open/close timestamps, bid history, winning bid, payment status, delivery status, linked finance ledger entry.

---

## 4. Decoupled Technical Workflows & State Machines

The architecture separates five independent processes:

1. **Registration & Conduct**
   - **Institutional Route:** `School Registration → Institution ID + Coordinator Dashboard → Competition Registration → Conduct & School-Level Judging → Coordinator Compliance Certification`
   - **Individual Route:** `Direct Registration → FOA Participant ID + Registration Number → Independent/Online Conduct`
2. **Digital Submission & Multi-Tier Judging**
   - **Digital Intake:** `Submission Received → Entry ID Generated → Confirmation Sent`
   - **School Shortlist Upload:** `School Shortlisted → Digital Entry Submitted to FOA`
   - **Judging Hierarchy:** Configurable pipeline (`School → City/District → State → National → Global`) outputting Finalists, Winners, Runners-up, Special Mentions, and Auction-Eligible flags.
   - **Results & Certificates:** `Admin Approval → Results Published → Certificates Generated (Unique ID + QR) → Dashboard Downloads Enabled`
3. **Physical Artwork Logistics & Verification**
   - `Shortlisted → Verified → Physical Artwork Requested (Instructions + Address + Deadline + Tracking) → Dispatched → Received by FOA → Physical Artwork Verified`
4. **Public Showcase & Social Distribution**
   - `Consent Verified → Digital Gallery Published` and `Certificate/Asset → Auto-Logo Stamped → Social Media Export`
5. **Fundraising Auction & Ledger Sync**
   - `Physical Artwork Verified + Consent Confirmed → Artwork Listed → Bidding → Winning Bid → Payment → Confirmation → Delivery → Recorded in Finance System`

---

## 5. Third-Party Integrations & Non-Functional Requirements

- **Cloud Hosting & Media Storage:** Scalable object storage and CDN for high-resolution artwork scans, photography, and videography uploads.
- **Payment Gateway:** Supports one-time/recurring donations, auction settlements, and competition registration fees (if enabled).
- **Communications Gateway:** Transactional Email and SMS provider for automated workflow notifications.
- **Logistics / Courier Integration:** Tracking-number capture and delivery status updates for inbound physical artwork and outbound auction shipments.
- **Analytics & Monitoring:** Integrated analytics service feeding the internal Reports & Analytics dashboard.
- **Security & Compliance:** Data-protection compliance, strict safeguarding controls for minors' PII, immutable consent audit trails, and public QR certificate verification endpoints.

---

## 6. Open Technical Contradictions to Resolve Before Development

Before handing this spec to a developer, six ambiguities in the source draft need a definitive call:

1. **All-Entry vs. Shortlist-Only Upload:** The draft leaves an open debate on whether _all_ participants upload digitally or _only_ school-shortlisted entries (Top 5/10). This directly impacts storage architecture and how non-shortlisted students receive participation certificates.
2. **Certificate Generation Without Full Student Rosters:** If schools only upload shortlisted entries, the School Dashboard still needs a bulk roster upload (e.g., CSV) to generate individual Participation Certificates for all eligible students.
3. **Physical Artwork Dispatch Timing:** One section moves physical dispatch _before_ FOA-level judging (stating physical judging for FOA/individuals), while the very next section states FOA judges evaluate shortlisted entries _digitally_, and the inline flow requests physical artwork twice (before judging and after winners are declared). One linear state machine needs to be locked in.
4. **Individual Participant Screening Flow:** Institutional entries pass through school-level shortlisting first, while individual entries are described as judged upon physical receipt. Clarify whether individuals must first pass a digital screen before shipping physical artwork, or ship directly.
5. **Registration Fees Schema:** The inline summary mentions `"Student registration + fees"`, but competition creation and registration specs contain no fee fields, payment status states, or bulk-payment support for schools.
6. **Public Auction Creator Privacy vs. Minor Safeguarding:** Specify exact redaction rules for minors in the Digital Gallery and Auction listings (e.g., first name + initial + city only, no direct contact data).
