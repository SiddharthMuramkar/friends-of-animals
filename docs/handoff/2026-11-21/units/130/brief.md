# Unit 130: adoption applications and the coordinator workflow (M7 journey)

Issue #130 · M7 · L · risk (`E J F2`, PD) · tournament P+B2 · blocked by **81b** (adult check on linked teens) and **129**
(adoption listings), and through them 127, 114, 85a, 111a, 78, 64, 69, 61a, 59a. Branch
`ticket/130-adoption-applications-and-coordinator-workflow`, worktree `/root/foa-wt/130`. No siblings: this unit owns all of #130.

## Scope
**In:** signed-in adult applies for a published listing and tracks the application; FOA adoption coordinator reviews, puts
the applicant in touch with the listing organisation (contact shared then, audited) and records the outcome
(adopted | not_matched | declined); adopted closes the listing and every other open application (`listing_closed`); the
applicant may withdraw; applicant and listing owner get a message at every step; adopter submits a success story with
consent, coordinator publishes it, consent withdrawal unpublishes it; `/adopt/stories` public read model.
**Out:** listing CRUD, photos, `/adopt` pages and the listing machine (129); directory listing and the representative grant
(127); pin search (128); message engine, templates editor (69); consent documents engine (64); inventory engine (114).

## Acceptance checks (seam)
1. **Apply + track.** Adult member applies to a published listing (answers, phone, address, contact-sharing consent) →
   `submitted`; `getMyApplications()` lists it with status; each later move shows there. Second open application to the
   same listing → `already_applied` (+ partial unique index). Listing draft/on_hold/adopted/withdrawn or its directory
   listing not verified → `listing_not_open`. Representative of the owning organisation applies → `own_listing`. **S1**
2. **Adult only.** A linked teen (81a/81b profile DOB, age < `adoption.minAdopterAgeYears` = 18) → `under_min_age`, nothing
   written; a member with no known DOB must give one (`date_of_birth_required`); an applicant giving an under-18 DOB → `under_min_age`. **S1** + pure.
3. **Coordinator moves it.** submitted → under_review → in_contact → adopted; not_matched / declined need a reason
   (`reason_required`); every move audited (`adoption.application_status_changed`, ids + status only). **S1**
4. **Transition table**: every (status × action × actor) allowed and forbidden, incl. terminal statuses, `in_contact` needing
   sharing consent still given. **pure** (`application-status.test.ts`, landed in prep) + one **S1** smoke.
5. **Owner sees contact only from in_contact on.** Representative's read of the application: no phone/address/answers
   before `in_contact`; decrypted phone + address while `in_contact`/`adopted`; `putInContact` writes the audit row
   `adoption.contact_shared`. **S1**
6. **Adopted closes the listing.** recordOutcome adopted → listing `adopted` (129's machine, `closed_at` set), every other
   open application → `listing_closed` with one message each; 129's `adoption.listing_closed` (owner withdraws) → open
   applications `listing_closed`. Listing vanishes from `browseAdoptableAnimals`. **S1**
7. **Messages at each step.** After `h.drain()`, applicant and each representative get exactly one message per step
   (FakeEmail + inbox rows): submitted, under_review, in_contact, outcome, withdrawn, listing_closed (applicant only). **S1**
8. **Success story consent.** `submitSuccessStory` only by the adopter of an `adopted` application, gives consent
   `adoption_success_story` → draft; `publishSuccessStory` without current consent → `consent_required`; with it →
   published, on `/adopt/stories` read model (no adopter name, no contact); `consent.withdrawn` → story `withdrawn`, gone
   from the read model. **S1**
9. **Authorization, every use case:** coordinator (global, and organisation-scoped only for its listings) allowed;
   representative moving status refused; member reading another's application refused; visitor refused;
   coordinator without 2FA refused (60). **S1**
10. **Inventory** rows for phone, address, answers, DOB-if-stored, outcome_reason, story text; retention default
    "2 years after decided_at" (`toConfirm`). **Vitest** (114's test). **Seed**: one published listing with a submitted
    and an in_contact application, one adopted with a published story; idempotent. **S1**
11. **Pages, axe light + dark**: `/adopt/[slug]/apply`, `/dashboard/adoptions`, `/dashboard/adoptions/[applicationId]`,
    `/dashboard/organisation/adoptions/[listingId]/applications`, `/admin/adoptions`, `/admin/adoptions/[applicationId]`,
    `/adopt/stories`. M7 journey `tests/e2e/130-adoption-applications.spec.ts` (pin search → listing → apply → coordinator
    adopted → listing gone from `/adopt`). **S2, written, Not run.** Lighthouse on `/adopt/stories`: residue (F5).

## Files
- **Landed in prep (pure):** `src/server/modules/adoption/domain/{application-status,application-eligibility,success-story,application-answers}.ts` + tests.
- **New:** `src/server/db/schema/adoption-applications.ts`; custom `130_pre_consent_purposes` (`ALTER TYPE consent_purpose ADD
  VALUE IF NOT EXISTS 'adoption_contact_sharing'`, `…'adoption_success_story'`; nothing in this PR's DDL uses them, F2);
  generated `130_adoption_applications` (`adoption_application_status`, `adoption_story_status` enums defined in full;
  partial unique `(adoption_listing_id, applicant_user_id) WHERE status IN (open)`); `src/server/modules/adoption/
  {applications,coordinator,outcome,stories,messages,read-models}.ts` + tests; `src/server/seed/adoption-applications.ts`;
  pages under `src/app/adopt/[slug]/apply`, `src/app/adopt/stories`, `src/app/dashboard/adoptions/**`,
  `src/app/dashboard/organisation/adoptions/[listingId]/applications`, `src/app/admin/adoptions/**` (each `_components/`);
  `messages/en-IN/adoptionApplications.json`; `tests/e2e/130-adoption-applications.spec.ts`.
- **Touch (one line/entry each):** schema barrel (H1); `app.ts` composeUseCases; seed `seeders` (H6); `messages.ts` (H3);
  59a policy table (H8: `adoption.apply|withdraw|read_own|review|contact|decide|story.submit|story.publish|owner.read`);
  outbox event union + subscriber registry + 69 routes/templates (H9); 64 `CONSENT_PURPOSES` (H16); inventory (H5);
  dashboard/admin nav (H19); `ROUTES` + sitemap for `/adopt/stories` (H4); 129's listing machine (call, not edit, if it
  exports `closeAdoptionListing`); 129's derivative purpose `adoption_photo` reused for the optional story photo (H21, no edit).
- **Traps:** `/adopt/[slug]/apply` sits under 129's prerendered `/adopt/[slug]`; if 129 adds `/adopt/:slug` to `src/proxy.ts`'s
  matcher, make sure `/apply` isn't rewritten to not-found (X2 owner coordination). Read `node_modules/next/dist/docs/` first.

## Design (codebase-design; tournament angles compared in context)
- **(a) Coordinator-centric, owner read-only (chosen).** One actor moves status; the owner gets messages and, from
  `in_contact`, the applicant's contact. Matches the ticket's text ("the coordinator … records the outcome") and its test
  plan ("representative moves status → refused"). **(b) Three-party, owner confirms the outcome** adds `outcome_proposed`,
  a second approver path and a stuck state when the owner goes quiet; it doubles the forbidden-move surface for no AC.
  **(c) Owner-driven, coordinator observes**: contradicts the ticket. Graft from (b): the owner sees a read-only timeline.
- **Deep pure core**: `decideApplicationTransition({from, action, actor, reason?, sharingConsent})` holds the whole table
  (to-status, event, who is told, reason rules, `sharesContact`); `planListingClosure` returns the sibling moves;
  `ownerSeesApplicantContact(status)`; `decideNewApplication` (age, listing, duplicates, own listing); story machine
  `decideStoryTransition` with the consent gate. Use cases stay thin: `authorize` → `select … for update` → decide →
  update + audit + `emit` in one transaction.
- **Reversible defaults (write in the PR):** owner sees contact only while `in_contact`/`adopted` (data minimisation; the
  share is audited); reasons required for not_matched/declined, never shown verbatim to the applicant (template says
  "not matched"/"not taken forward"); `listing_closed` reasons `adopted_elsewhere | listing_withdrawn`; on_hold keeps open
  applications but refuses new ones; terminal statuses never reopen (apply again instead); DOB from the participant
  profile (78/81a) or asked once on the form and stored encrypted on the application; stories are plain text (≤ 2000
  chars, escaped on render: no sanitiser), no adopter name shown; stories own a read model, not a #112 CMS draft
  (consent withdrawal must unpublish in one transaction); sibling close runs in the adopted transaction, not a job.

## Interface needs (code against these; rename to what landed, never wrap)
```ts
// 59a access + audit
authorize(ctx, action: AdoptionAction, resource?: { scopes?: ScopedScope[]; ownerId?: string }): Promise<{ role: Role | null }>; // DomainError("forbidden")
recordAudit(tx, ctx, { action: string; entity: { type: "adoption_application" | "adoption_story"; id: string }; before; after; actorRole }): Promise<void>;
h.seed.grant(user, { role: "adoption_coordinator", scope: { type: "global" } | { type: "organisation"; id: directoryListingId } }); h.signIn(user);
// 60: staff policy rules carry secondFactor: "staff"; h.signIn gives a 2FA-verified staff session
// 58/75: encryptedText() column or Deps.cipher.encrypt/decrypt(purpose, value); parsePhoneNumber(raw): { ok: true; e164 } | { ok: false; reason }
// 61a: emit(tx, clock, { type: `adoption.${"application_submitted"|"application_status_changed"|"adopted"}`; aggregateType: "adoption_application"; aggregateId; payload }); h.drain();
//      subscribers: { name: "adoption.consent_withdrawn", handle(deps, e: consent.withdrawn) }, { name: "adoption.listing_closed", handle }
// 62: integerSetting({ key: "adoption.minAdopterAgeYears", default: 18, min: 18, max: 25, unit: "years" }); readSetting(db, key)
// 64: CONSENT_PURPOSES += "adoption_contact_sharing" | "adoption_success_story" (GIVABLE); giveConsentInTx(tx, ctx, { purpose, documentId }): Promise<{ consentEventId: string }>;
//     currentConsentState(db, { subjectType: "user"; subjectId; purpose }): Promise<"given" | "withdrawn" | "none">; currentConsentDocument({ purpose })
// 69: message_route rows { eventType, audience: "adoption_applicant" | "adoption_listing_representatives", templateKey, channels: ["email","in_app"] };
//     registerAudience(key, (db, ref) => Promise<{ userId: string }[]>)
// 78 / 81a: ageAt(dob: CalendarDate, at: Date): number; parseDateOfBirth(text, at); selfProfileDateOfBirth(db, userId): Promise<CalendarDate | null> (decrypts; teen via login_user_id)
// 114: INVENTORY.push({ table: "adoption_application", column, purpose, category, subject: "user", retention: { policy, period, basis, toConfirm: true } })
// 127: directory_listing { id, status: "verified" | …, name }; representatives = user_role(organisation_representative, organisation, listing.id)
// 129: adoption_listing { id, directoryListingId, slug, name, status: "draft"|"published"|"on_hold"|"adopted"|"withdrawn", closedAt };
//      closeAdoptionListingInTx(tx, ctx, { listingId, outcome: "adopted" }): Promise<void>; emits adoption.listing_closed { listingId, reason: "adopted" | "withdrawn" }
```
Use cases: `applyToAdopt`, `withdrawApplication`, `getMyApplications`, `getMyApplication`, `listApplicationsForReview`,
`getApplicationForCoordinator`, `startReview`, `putInContact`, `recordOutcome`, `listApplicationsForMyListing` (owner),
`submitSuccessStory`, `publishSuccessStory`, `withdrawSuccessStory`, `listPublishedStories` (public).

## Residue
- **HR-61:** contact-sharing notice at apply, success-story consent text, story display rule (no adopter name). Seeds are drafts.
- **HR-62:** adopter minimum age 18 (setting default), coordinator staffing. **HR-17:** appoint the coordinator with 2FA.
- **HR-31:** retention of every new inventory row (`toConfirm`). **HR-10/M7:** worker redeploy for message handlers on previews.
- **HR-01:** Seam 2 on the preview. Lighthouse ≥ 90 on `/adopt/stories`: no runner (F5), real-device run is residue.

## Test plan
- Pure (landed): transition table (every status × action × actor), sibling closure plan, contact visibility, eligibility
  precedence, story machine + consent gate, answers schema bounds.
- Seam 1 on `createHarness()` with 127's verified listing + representative builder, 129's published-listing builder,
  59a grants, 64 consent documents seeded, `h.drain()`; FakeEmail + inbox rows for messages; audit rows by action.
- Seam 2: the M7 journey + axe on every page, written, Not run.

## Slices
1. **Apply and track** (ACs 1, 2, 9 apply/read, 10 inventory). Schema + enums + consent-purpose pre-migration, `applyToAdopt`,
   `withdrawApplication`, `getMyApplication(s)`, apply page + dashboard. Test `src/server/modules/adoption/applications.test.ts`.
2. **Coordinator review and contact** (3, 4 smoke, 5, 9). `startReview`, `putInContact`, `recordOutcome` (not_matched,
   declined), coordinator + owner reads, admin pages. Test `src/server/modules/adoption/coordinator.test.ts`.
3. **Adopted closes the listing** (6). Adopted transition, sibling closure, `adoption.listing_closed` consumer.
   Test `src/server/modules/adoption/outcome.test.ts`.
4. **Messages at each step** (7). Events, audiences, routes + templates seed. Test `src/server/modules/adoption/messages.test.ts`.
5. **Success stories, seed, journey** (8, 10 seed, 11). Story use cases, consent consumer, `/adopt/stories`, seed, Seam 2.
   Test `src/server/modules/adoption/stories.test.ts` (+ `src/server/seed/adoption-applications.test.ts`).

## Head start landed (prep)
`SHA_PENDING` on `ticket/130-adoption-applications-and-coordinator-workflow` (from `foa/M0`, no PR), all pure, 114 Vitest cases:
- `src/server/modules/adoption/domain/application-status.ts`: `ADOPTION_APPLICATION_STATUSES`, `OPEN_APPLICATION_STATUSES`
  (the partial unique index's list), `isOpenApplication`, `ownerSeesApplicantContact`, `decideApplicationTransition({ from,
  action, actor: "coordinator"|"applicant"|"system", sharingConsent })` → `{ ok, to, reason, sharesContact, closesListing,
  event, notify }` or `forbidden_actor | invalid_transition | reason_required | reason_too_long | sharing_consent_missing`;
  `planListingClosure({ cause, applications })`.
- `.../application-eligibility.ts`: `decideNewApplication({ applicantAgeYears | null, minAgeYears, listing, applicantRepresentsListing,
  hasOpenApplication, sharingConsent })` → `submitted` or `listing_not_open | own_listing | date_of_birth_required | under_min_age |
  already_applied | sharing_consent_required` (that precedence). Local `AdoptionListingStatus`: import 129's once on `M7`.
- `.../success-story.ts`: `ADOPTION_STORY_STATUSES`, `decideStoryTransition`, `storyIsPublic`, `parseStoryText` (20–2000 chars).
- `.../application-answers.ts`: `applicationAnswersSchema` (strict: homeType, hasOutdoorSpace, otherAnimals, experience, availability).
Rebase onto `M7` once it is cut; nothing here touches a hotspot.
