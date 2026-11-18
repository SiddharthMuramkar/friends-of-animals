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
- **Encryption.** TLS 1.2+ everywhere (1.3 preferred), including PgBouncer. Until the Vercel Static IPs are bought (#12), PgBouncer's port 6432 is open to all, protected by TLS, SCRAM, 32-byte random passwords and CrowdSec (§2.3). R2 encrypts objects at rest (AES-256). Backups are encrypted before they leave the VPS (pgBackRest repository encryption; `age` for the daily dumps). Until FOA's R2 exists (#18) none leave it: the only backups are in the local pgBackRest repository, which is encrypted too. Whether the VPS disk is encrypted at rest is a question for Hostinger. A separate evidence bucket (`foa-evidence`) holds consent forms, clearance documents and safeguarding files, with no public access and R2 bucket locks.
- **PII field-level encryption.** `Guardian.phone`, `Guardian.email`, `ParticipantProfile.dateOfBirth` and the fields marked enc in §12 are encrypted with AES-256-GCM in the repository layer (an encrypted Drizzle `customType` in `src/server/db/pii.ts` encrypts on write and decrypts on read), stored as `v1:{kid}:{iv}:{ct}:{tag}` with keys from `PII_ENCRYPTION_KEYS` and `PII_ENCRYPTION_ACTIVE_KID`. Exact-match lookups use HMAC-SHA256 blind indexes (`phoneHash`, `emailHash`, keyed by `PII_HASH_KEY`) over normalized values (E.164 phone, lowercased email). DOB is decrypted only in the app; the age group is computed there and snapshotted by §6, so no SQL filters on DOB. The `pii.rekey` job re-encrypts after a key rotation.
- **Audit.** `AuditLog` per §3.3, plus `pii.viewed` rows whenever a minor's PII, an original file or an evidence file is opened.
- **Admin protection.** `/admin` is limited to 300 requests/min per user. `ADMIN_IP_ALLOWLIST` is optional and applies to SUPER_ADMIN. A sign-in from a new device emails the user.
- **Public forms.** Turnstile, a 10 requests/min per IP limit (stored in Postgres, §2), and a honeypot field.
- **Backups.** pgBackRest archives WAL to an encrypted R2 repository at least every 60 s (`archive_timeout = 60`), with 30 days of PITR. A daily `age`-encrypted `pg_dump` goes to a separate, locked R2 bucket and is kept 35 days. Until FOA's R2 exists (#18), there is no off-site copy and no daily dump yet: pgBackRest archives to a local, encrypted repository on the VPS. R2 has no object versioning, so originals are never overwritten: keys are UUIDs or content hashes, and every write uses `If-None-Match: *`. RPO ≤ 5 min, RTO ≤ 4 h. Every quarter, a restore drill verifies the repository (`pgbackrest verify`), restores into a throwaway container and volume on the VPS (no network, never `pg-nonprod` or the live data volume), replays `ErasureLedger`, runs smoke tests, and records the time taken.

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
- **CI on each PR (GitHub Actions).** Install, then oxlint and `oxfmt --check`, then `tsc --noEmit`, then Vitest (≥ 80% coverage on `server/domain`, 100% of state-machine transitions), then `drizzle-kit check` plus a migration drift check (`drizzle-kit generate` must produce no new migration), then build. The PR then deploys a preview, whose `vercel-build` creates `foa_pr_<n>` from the seeded `foa_seed` template and applies the `drizzle/` migrations through `DIRECT_URL`. An hourly sweeper on the VPS drops the databases of closed PRs and deleted branches, reading each database's comment (§2.4); GitHub Actions can't, because it won't pass the future allowlist. GitHub Actions runs Playwright E2E, axe and Lighthouse CI against it. gitleaks, `pnpm audit` and CodeQL also run.
- **Release.** A merge to `main` auto-deploys staging. Production needs a manual promotion with approval. Migrations run in `vercel-build` under a Postgres advisory lock (§2.3), before the traffic switch, and MUST be expand/contract (backward compatible). Worker images deploy from GitHub Actions (§2.3). Rollback uses Vercel instant rollback for the app and redeploys the previous GHCR image tag for the worker; DB problems get a forward fix.
- **Seed (`scripts/seed.ts`, idempotent, synthetic only; previews are cloned from a `foa_seed` database built from it).** Beyond the §2.1 baseline (1 competition, 3 schools, 30 participants, 2 judges): participants under 13, aged 13–17 and adults across both routes; guardians with consents of every `ConsentMethod`, one withdrawn and one stale-version consent; ConsentDocuments in en-IN and hi-IN; one DataRequest of each type; one synthetic SafeguardingReport; one user per `Role`. Phone numbers come from a reserved test range. OTP uses `DEV_OTP_BYPASS_CODE`, which is ignored when `APP_ENV=production`.
- **Feature flags.** Stored in a `FeatureFlag { key, enabled, rolloutPercent?, updatedBy, updatedAt }` table that SUPER_ADMIN edits, with env overrides. Flags: `AUCTIONS`, `ADOPTION`, `VOLUNTEERS`, `NGO_DIRECTORY`, `EVENTS`, `COMMUNITY`, `CLUBS`, `AMBASSADORS`, `SOCIAL_PUBLISHING` (API posting to social networks, post-MVP, §7.11; MVP is manual export), `SMS_CHANNEL`, `WHATSAPP_CHANNEL`, `MINOR_LOGIN`, `IMAGE_SAFETY_CLASSIFIER`, `DIGILOCKER_GUARDIAN_VERIFICATION`, `LOCALE_HI`. Post-MVP modules (§1) ship dark behind their flags.

### 13.9 Configuration (required environment variables)

| Variable | Envs | Purpose |
|---|---|---|
| `APP_ENV`, `APP_URL` | all (defaulted locally; `APP_URL` also on previews) | `local`, `preview`, `staging` or `production`; canonical base URL |
| `DATABASE_URL`, `DIRECT_URL` | all | `DATABASE_URL`: PgBouncer, transaction mode (in the worker: Postgres directly on the Compose network, §2.2). `DIRECT_URL`: PgBouncer with the migrator role, which PgBouncer gives session mode through a per-user `pool_mode`, for migrations. On previews both name the placeholder `foa_pr`, replaced with the preview's own database (§2.4) |
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

Env is validated at boot with zod (schemas in `src/env.schema.ts`, read through `src/env.ts`), in the app and in the worker: the app validates it in `register()` (`src/instrumentation.ts`), so a missing required variable fails the start. Only a local run may leave out `APP_ENV` and `APP_URL`, which then default to `local` and `http://localhost:3000`; a preview may also leave out `APP_URL`. A missing `APP_URL` fails the build and the start on `staging` and `production` (a preview defaults it to `https://$VERCEL_BRANCH_URL`), and on Vercel so does a missing `APP_ENV` (prerendered pages read both at build time). `next build` needs no other variable; the Vercel build still fails without `DIRECT_URL`, because `vercel-build` runs the migrations through it. Backup credentials (pgBackRest and dump-bucket R2 tokens, the repository cipher passphrase) live only on the VPS, never in Vercel.

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
10. A preview deploy creates its own database `foa_pr_<n>` on `pg-nonprod` from `foa_seed`, migrates it, and the E2E suite passes against it. The hourly VPS sweeper drops the database once the PR is closed or the branch deleted. A missing env variable fails the boot.
11. The quarterly restore drill completes within the 4 h RTO, and its report is filed in `/admin/reports`.
12. Sentry events contain no email, phone, name or DOB values (fixture test of the scrubber).
