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
| IN_REVIEW → PUBLISHED | approver | approver ≠ `lastEditedById` when `content.fourEyes`; LEGAL template: STAFF_ADMIN only | set `publishedAt` and `publishedRevisionId`; `revalidateTag`; `content.published` |
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

Home edits go through §9.4.2. The page is ISR with `revalidateTag` (`home`, `posts`, `competitions`, `gallery`, `events`, `impact`) and a 300 s fallback.

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
