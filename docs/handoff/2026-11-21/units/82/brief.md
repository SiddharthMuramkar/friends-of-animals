# Unit 82: separate guardian consent for each purpose; public credit defaults to first name plus initial

Issue #82 · M1 · L · flags `K` · risk · no file key · Q1 (registration guard, after 81b) and Q7 (consent schema, after 64 → 72) ·
blocked by **81b** (and through it 81a, 78, 77a, 72, 64). Branch `ticket/82-separate-guardian-consent-for-each`, worktree
`/root/foa-wt/82`, base `foa/M0` today (rebase onto `foa/M1` at build). No siblings: this unit owns all of #82.
Head start (phase A): commit `a09f718` on the branch, pushed, no PR: `src/server/modules/consent/domain/{guardian-purposes,public-credit}.ts` + tests (37).

## Scope
**In:** a verified guardian gives and withdraws, one by one, the seven purposes for each child: `participation`,
`public_display`, `display_school`, `display_city`, `social_media`, `auction` (per competition the child is registered
in) and `communications` (global). Each is a #64 consent event on the child's participant profile, pointing at the
competition's attached document version (#72), with giver, time and method. Withdrawal emits `consent.withdrawn` through the
outbox (consumers arrive with #103, #104, #126, #131). The public-credit resolver (shared read helper for #100, #103, #104,
#111, #131). The guardian sees each child's consent history. A minor's registration can't be released, paid or confirmed
without participation consent. Seed, two pages.
**Out:** coordinator code links and signed forms, `code_link`/`signed_form` methods, the school-route declaration (#83);
consumers of the withdrawal (gallery #103, social #104, campaigns #126, auction #131); adults' own consents (#78 records
them at registration); a teen's own view of their consents; the child turning 18 (#115).

## Acceptance checks (seam)
1. **Each purpose on its own.** For each of the 7 purposes: `giveChildConsent` then `withdrawChildConsent` changes only
   that purpose's state in `childConsents`; the other six stay as they were. Giving again on the same version or
   withdrawing what was never given returns `{ ok: true, changed: false }`, no rows. Re-giving after a withdrawal records a
   new event. **S1** `child-consent.test.ts`
2. **Record contents.** Raw select on `consent_event`: `subject_type = 'participant_profile'`, `subject_id` = child,
   `giver_user_id` = guardian, `competition_id`, `document_id` = the competition's **attached** version even after staff
   publish v2 (and `document_outdated` when the form posts v2 before a manager re-attaches), `method = 'web_form'`,
   `occurred_at = clock.now()`. `communications`: `competition_id` null, the current published version. **S1**
3. **Withdrawal event.** One `outbox` row `consent.withdrawn` per withdrawal, same transaction, payload ids only (64's
   fields + `competitionId`); giving emits none; `h.drain()` marks it `dispatched`. Audit `consent.given` /
   `consent.withdrawn` per change (64's rows). **S1**
4. **Public credit.** Pure: default `Asha K.`; school only with `display_school`, city only with `display_city`, each on its
   own; nothing without the use's consent (`public_display` for gallery/results, `social_media` for social); auction capped
   at first name + initial even with opt-ins; initial = first letter grapheme, uppercased (Devanagari `आशा कु.`);
   blank last name → first name only; adults full name. **Vitest** (done in prep). S1: `childConsents` returns a
   `creditPreview` per competition that follows the consents. **S1**
5. **History.** `childConsentHistory({ childId })` returns every event for the child across competitions, newest first,
   each with purpose, competition title, action, document version and title, giver name, method, time. **S1**
6. **Participation gate.** A minor's registration starts `pending_payment` only when the guardian is verified **and**
   participation is given on the attached version (guardian-route form records it in the registration transaction);
   otherwise `pending_guardian`. Giving participation releases `pending_guardian` → `pending_payment` in the same
   transaction (audit `registration.status_changed`); withdrawing it before payment → `payForMyRegistration` refused
   `participation_consent_required`; 77a's confirm path refuses it too. Adults unaffected. **S1** `participation-gate.test.ts` + pure table.
7. **Offer and scope rules.** `purpose_not_offered` when the competition doesn't allow public display (`public_display`,
   `display_*`, `social_media`) or auction, or has no document attached for it; `competition_required` /
   `competition_not_allowed` by scope; `not_registered` when the child has no registration in that competition. Pure (done) + **S1**.
8. **Authorization, every new use case:** the child's verified guardian allowed; another guardian `forbidden`; the teen
   (child's own login) `forbidden` (can't give guardian consent); plain member and visitor `forbidden`; unverified guardian
   `guardian_not_verified`; nothing written on refusal. **S1**
9. **Seed:** 81a's under-13 child: participation + public_display + display_city given, display_school never; teen1:
   participation + social_media given, public_display given then withdrawn; one `communications` given; draft documents
   for the new purposes attached to the seeded competitions (72's seed). Idempotent. **S1** `src/server/seed/consent.test.ts` (extended)
10. **Pages, axe clean light + dark:** `/guardian/children/[id]/consents` (per competition + communications, give/withdraw,
    credit preview, empty state), `/guardian/children/[id]/consents/history`. **S2** `tests/e2e/82-guardian-consent.spec.ts`, written, **Not run**.

## Files
- **New:** `src/server/modules/consent/domain/guardian-purposes.ts` + test and `public-credit.ts` + test (**done in
  prep**); `src/server/modules/consent/{child-consent,participation-gate}.ts` + tests; custom migration
  `82_pre_enum_consent` (`ALTER TYPE "consent_purpose" ADD VALUE IF NOT EXISTS …` ×7, `"consent_subject_type"` +
  `participant_profile`); generated `82_guardian_consent` (`consent_event.competition_id` uuid null FK + index);
  `src/app/guardian/children/[id]/consents/{page.tsx,actions.ts,_components/*,history/page.tsx}`;
  `messages/en-IN/childConsents.json`; `src/content/legal/` draft documents for the new purposes; `tests/e2e/82-guardian-consent.spec.ts`.
- **Touch:** 64's `purposes.ts` (append values; `GIVABLE_PURPOSES`, `CONSENT_SUBJECT_TYPES`), 64's write path
  (extract `appendConsentEvent` if 64 inlined it), 64's `consent.withdrawn` payload (+ `competitionId`); 81b's
  `registerAsIndividual({ forChildId })`, `acceptGuardianRequest`, `payForMyRegistration`, the registration machine table;
  77a's confirm guard; `can()` rules; `src/server/app.ts` (one entry); `src/i18n/messages.ts`; `src/lib/app-routes.ts`;
  inventory (consent records); seed (`consent.ts` after guardians); 81a's `/guardian/children/[id]` (one link).
- **Hotspots:** Q7 consent schema/enums (after 72; enum step 1 only, **no DDL in this PR names a new value**, so scope
  stays in app code, no CHECK); Q1 registration guard (77a/81b; X10 payments guard serialize); `drizzle/meta/*` (merge queue).

## Design (risk-flagged, three compared)
- **(a) Rows per purpose:** `guardian_consent(subject, competition, purpose, given_at, withdrawn_at)`. Simple reads, but a
  second consent store beside 64's event log, mutable rows (lossy history, withdrawal giver needs columns). Fails "one
  Consent module": #83, #103, #115 would read two places.
- **(b) Deep read API:** Consent exposes `childConsents`/give/withdraw use cases and, as its only read for consumers,
  `publicUse(subject, competition, use)` → `null | { name, school?, city? }` + `participationGiven`. Callers never
  see purposes, scopes or documents.
- **(c) Append-only events, derived state:** already 64's chosen storage; #82 adds a subject type, purposes and `competition_id`.
- **Chosen: (c) storage behind (b)'s interface.** No new consent table; current state = latest event per
  (subject, competition, purpose) via 64's `currentConsent` + `decideGive(state, attached, requested)` (the competition's
  attached version is passed as "latest", so consent always names the text attached). Depth sits in two pure modules:
  `guardian-purposes.ts` (catalogue: scope, document, offer rule; `offeredPurposes`, `documentToGive`, `scopeRefusal`,
  `publicUseOf`, `minorRegistrationHold`) and `public-credit.ts` (`resolvePublicCredit`). Consumers (#100, #103, #104, #111, #131)
  call one function; changing the credit rule or a purpose's document is a one-file edit.
- **Reversible defaults (write in the PR):** `display_school`/`display_city` point at the `public_display` document
  (field options of the public credit), and modify gallery, results and social credits; `social_media` and `display_*`
  are offered only when the competition allows public display; `auction` only when it allows auction (minors offered by
  default, HR-34/HR-63); no attached participation document → minors can't be confirmed (safe side); "minor" for the
  credit = under 18 at the registration instant (78's `ageAt`), so a work made as a child stays protected; release on
  consent happens in the give transaction (no job, no worker skew); teen can't read or give guardian consents.

**Interface needs (code against these; rename to what landed):**
```ts
// 64 consent (5ad8b35 + use cases)
currentConsent(events: ConsentEventRecord[]): ConsentState;
decideGive(state: ConsentState, latest: { id: string; version: number } | null, requestedDocumentId: string): ConsentDecision;
decideWithdraw(state: ConsentState): ConsentDecision;
appendConsentEvent(tx: AppDb, ctx: UseCaseContext, e: { subjectType: ConsentSubjectType; subjectId: string;
  purpose: ConsentPurpose; documentId: string; action: "given" | "withdrawn"; method: ConsentMethod;
  competitionId: string | null }): Promise<{ id: string }>;   // event + audit + outbox on withdrawal, one tx
currentConsentDocument(input: { purpose: ConsentPurpose }): Promise<{ id: string; version: number; title: string } | null>;
// 72 competitions
attachedConsentDocument(db: AppDb, competitionId: string, purpose: ConsentPurpose): Promise<{ id: string; version: number; title: string } | null>;
competition: { id; title; publicDisplayAllowed: boolean; auctionAllowed: boolean };   // #70/#72 scope flags
// 81a/81b guardians + registration
activeGuardianLink(db: AppDb, guardianUserId: string, profileId: string): Promise<{ guardianId: string; verified: boolean } | null>;
participantProfile: { id; ownerKind: "institution" | "self" | "guardian"; firstName; lastName; dob; loginUserId: string | null; schoolName?: string | null; city?: string | null };
registration: { id; participantProfileId; competitionId; status: RegistrationStatus; createdAt: Date };
transitionRegistration(tx: AppDb, ctx: UseCaseContext, id: string, to: RegistrationStatus, why: string): Promise<{ ok: true } | { ok: false; reason: string }>;
// 59a / 61a
can(ctx, "consent.child.give" | "consent.child.withdraw" | "consent.child.read", { type: "participant_profile"; id: string }): Promise<boolean>;
emit(tx, { type: "consent.withdrawn"; aggregateType: "consent_event"; aggregateId: string; payload: Record<string, string | null> }): Promise<{ id: string }>;
```
Use cases: `childConsents({ childId })` → `{ competitions: { id, title, creditPreview, purposes: { purpose, offered,
document, state }[] }[], communications }`; `giveChildConsent({ childId, competitionId?, purpose, documentId })`;
`withdrawChildConsent({ childId, competitionId?, purpose })`; `childConsentHistory({ childId })`. Results
`{ ok: true, … } | { ok: false, reason }`; first line `can()`. Exported read: `publicUse(db, { profileId, competitionId, use })`.

## Built in phase A (a09f718)
- `guardian-purposes.ts`: `GUARDIAN_PURPOSES`, `PUBLIC_USES`, types `DocumentRef`, `CompetitionConsentSetup`
  `{ publicDisplayAllowed, auctionAllowed, attached: Partial<Record<"participation"|"public_display"|"social_media"|"auction", DocumentRef>> }`;
  `offeredPurposes(setup)`; `documentToGive(purpose, { competition, childRegistered } | { competition: null, currentDocument })`
  → `{ ok, document } | { ok: false, reason: competition_required|competition_not_allowed|not_registered|purpose_not_offered }`;
  `scopeRefusal(purpose, competitionId | null)` (withdraw checks only this); `publicUseOf(given, use, { minor })`;
  `minorRegistrationHold({ minor, guardianVerified, participationGiven })` → `null | awaiting_guardian | participation_consent_required`.
- `public-credit.ts`: `resolvePublicCredit(person, use, given: ReadonlySet<GuardianPurpose>)` → `PublicCredit | null`.
- At build: fold `GUARDIAN_PURPOSES` into 64's `CONSENT_PURPOSES` (`satisfies readonly ConsentPurpose[]`); the
  use case passes `documentToGive`'s document as 64's `decideGive` "latest".

## Residue
- **HR-33** append: text of each purpose's document (participation, public display + credit options, social media,
  auction, communications); seeds are marked drafts, production blocked by the placeholder guard.
- **HR-30** append: guardian web-form consent by a verified guardian as verifiable parental consent; minors' credit
  format; withdrawal SLA (consumers).
- **HR-34** append: auction consent offered to minors (default yes when the competition allows auction); see HR-63.
- **HR-31** append: retention of consent records (default: while the consent applies + 3 years, `toConfirm`).

## Test plan
- Pure (**landed in prep**): `guardian-purposes.test.ts` (catalogue, offer rules, scope checks, public-use table,
  registration hold table), `public-credit.test.ts` (name format, opt-ins per field, uses, auction cap, Devanagari,
  blanks, adults, never leaks the last name).
- Seam 1 on `createHarness()` with 81a's `h.seed.guardian({ children })`, 72's competition + attached-document builders,
  81b's registration builders, `h.drain()`; raw SQL only for AC 2. Seam 2 spec written, Not run.

## Slices
1. **Give and withdraw each purpose; record contents; withdrawal event** (ACs 1, 2, 3, 7, 8). Enum migration, `competition_id`,
   `giveChildConsent`/`withdrawChildConsent`/`childConsents`. Test `src/server/modules/consent/child-consent.test.ts`.
2. **History and credit preview** (4, 5, 8). `childConsentHistory`, `creditPreview`, `publicUse`. Test
   `src/server/modules/consent/child-consent-history.test.ts`.
3. **Participation gate in the registration machine** (6). 81b's start status, release on give, pay/confirm refusals.
   Test `src/server/modules/consent/participation-gate.test.ts` (+ the registration machine table file).
4. **Seed, pages, Seam 2** (9, 10). Test `src/server/seed/consent.test.ts`, `tests/e2e/82-guardian-consent.spec.ts`.
