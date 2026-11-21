# Brief 72: competition fees, award schemes and attached consent documents (#72, M1)

Branch `ticket/72-competition-fees-award-schemes-and`, worktree `/root/foa-wt/72`, base `foa/M1` (head start cut from `foa/M0` 442dd99). Size L, risk (money, minors' consent documents, public page). Key X9 (serial 70a → 71 → 72). Blocked by 64, 70a, 71. **Also needs 70b** for AC 10 (the public detail body is 70b's `src/components/competitions/competition-detail.tsx`). 70b is not a listed blocker, so if it hasn't merged when this unit builds, ship slices 1–4 and send `BLOCKED 72 public page needs 70b` before slice 5. No siblings: this unit owns all of #72. Sources: ticket (no comments), #55 stories 2, 20, 59, 60, 65 and domain rules (award scheme, fees), `issues-M1.md` #72, old SPEC.md §6.3/§7 (award bands) as prior art only.

## Scope
- **In:** per-route fees or "free" (bigint paise, INR); an award scheme per planned round with optional prize text per band; attaching consent documents by pinned version, and re-attaching; the edit read for admin screens; extending the public read model; `getRegistrationTerms` for 75b/77a/78; audit; `can()` rules; preview seed; admin sections; a public terms section; a versioned document page if #64 has none.
- **Out:** payment orders and the fee snapshot on a registration (77a, 78). Giving consent on attached documents (78, 82, 83). Adding #82's purposes (participation, public_display, social_media, auction): #82 appends them to `ATTACHABLE_PURPOSES`. Real rounds (#95/#99): they read `foa_final`'s scheme as their default. Prize fulfilment (#99+). Cancel and refunds (#80).

## Acceptance criteria (testable, with seam)
1. **Fee per route.** `as(cm).setCompetitionFees({ competitionId, fees: { individual: "1,500", institution: "25000.50" }, currency: "INR" })` stores `competition_fee` rows 150000n and 2500050n, currency `INR`. `getCompetitionTermsForEdit({ competitionId })` returns them. Proved by unit tests (parse) and Seam 1.
2. **Free.** `{ free: true }` stores 0n for every route the competition offers. The public view shows "Free" for each route. Seam 1.
3. **Money rules.** `"21474836.49"` round-trips as 2147483649n (more than 2^31). Rejections: non-INR gives `unsupported_currency`; negative, 3 decimals, exponent or garbage gives `invalid_amount`; a route the competition doesn't offer gives `route_not_offered`; an offered route left empty gives `missing_fee`. DB checks back `amount_minor >= 0` and `currency = 'INR'`. Proved by unit tests (done) and Seam 1.
4. **Fee lock.** In `registration_open` or `registration_closed` (#71), `setCompetitionFees` returns `fees_locked` and changes no rows or audit. In draft or published it works. Proved by a unit test (done) and Seam 1.
5. **Step-up.** A competition manager without a fresh step-up (#60) is refused on `setCompetitionFees` (#60's error code) and nothing is written. Awards and documents need no step-up. Seam 1.
6. **Default scheme.** With nothing set, the edit read and the public model give `ranked_123` (bands first, second, third) for every offered round. `foa_final` is always offered. `school` is offered only when institutions take part. Proved by a unit test (done) and Seam 1.
7. **Scheme per round.** `setRoundAwards({ competitionId, roundKey: "school", scheme: "grades_ab", prizes: { grade_a: "Trophy" } })` stores that round and leaves `foa_final` alone. Switching scheme keeps only the prizes whose band the new scheme has. Errors: `band_not_in_scheme`, `round_not_offered` (school on an individuals-only competition), `unknown_scheme`, `prize_too_long` (over 200 characters). Proved by unit tests (done) and Seam 1.
8. **Pinned documents.** `attachConsentDocument({ competitionId, purpose: "competition_terms" })` pins the current published version, v1. A staff admin then publishes v2 through #64's `publishConsentDocument`. The competition still points at v1, and the edit read shows state `newer_available`. Re-attaching moves it to v2. Re-attaching again returns `{ changed: false }` and writes no audit row. `detachConsentDocument` removes the pin. Errors: `not_attachable` (for example `messages`) and `no_published_version`. Proved by unit tests (done) and Seam 1.
9. **Public read model.** As a visitor, `getPublishedCompetition({ slug })` (70a) carries:
   - `terms.fees`: per route, `free`, `amount` (paise) or `not_set`;
   - `terms.awards`: per round, the scheme, its bands and each band's prize or null;
   - `terms.documents`: purpose, title, version and an href to the pinned version.

   Drafts stay hidden. `getRegistrationTerms(db, id)` returns the fees and the documents with `required`. Seam 1.
10. **Public page.** The detail page shows fees, prizes and links to the pinned document versions. The link target renders that exact version. Seam 2, Not run.
11. **Audit.** Each successful change writes exactly one `audit_log` row with changed fields only: `competition.fees_set`, `competition.awards_set`, `competition.consent_document_attached` or `competition.consent_document_detached`. Refusals and no-op calls write none. Seam 1.
12. **Authorization.** Every new use case has a table-driven test:
    - passes: a global competition manager, and one scoped to this competition;
    - fails: a manager scoped to another competition, a content manager, a member and a visitor.

    No rows are written on a refusal. Seam 1.
13. **Seed.** `seedPreview` adds one free and one paid competition. The paid one uses obviously-sample amounts (₹100 individual, ₹1,000 institution, commented "sample, not FOA's price", HR-34). Both have `competition_terms` v1 (draft sample text, HR-33) and `privacy_notice` attached, plus a non-default scheme on one round. Running it twice changes nothing. Seam 1.
14. **axe.** `expectRendersAccessibly`, light and dark, on the admin fees, awards and documents pages, the public detail page and the document version page. Seam 2, Not run.

## Files
- **Built (head start, pushed as `92a9e4a` on the branch, 61 unit tests, `pnpm check` green):** `src/server/modules/competitions/domain/{fees,award-schemes,consent-attachments}.ts` plus tests.
- **New:**
  - `src/server/db/schema/competition-terms.ts`, kept separate from 70a's `competitions.ts` to keep the X9 diff small;
  - `drizzle/NNNN_72_competition_fees_awards_consent.sql`;
  - `src/server/modules/competitions/use-cases/{fees,awards,consent-documents,terms-read}.ts` plus tests;
  - `src/server/modules/competitions/registration-terms.ts`;
  - `src/server/seed/competition-terms.ts`;
  - admin pages `src/app/(staff)/admin/competitions/[id]/{fees,awards,documents}/` (`page.tsx`, `actions.ts`, `_components/`);
  - `src/components/competitions/competition-terms.tsx` (public section);
  - `src/app/documents/[purpose]/[version]/page.tsx`, only if #64 has no versioned route;
  - message namespaces `messages/en-IN/adminCompetitionTerms.json` and `competitionTerms.json`, new ones rather than growing `competitions.json`;
  - `tests/e2e/72-competition-terms.spec.ts`.
- **Hotspots touched:**
  - the schema barrel (1 line), `seeders` (1 line) and `src/i18n/messages.ts` (2 namespaces);
  - #64's `consent_purpose` enum and purpose catalogue: append `competition_terms` (Q7: 64 → 72 → 82);
  - 70a's competitions facade (4 use cases) and `toPublicCompetition`, `PublicCompetition` (add `terms`);
  - 70a's edit page (links to the 3 sections), 70b's `competition-detail.tsx` (mount the section);
  - 59a's policy table (actions below), 57b's `app-routes.ts`;
  - `src/lib/routes.ts`, for the document route only.

## Data model (one generated migration; no hand SQL)
- `participation_route` enum (`individual`, `institution`), exported for 75b/77a/78.
- `competition_fee`:
  - `competition_id` → competition, on delete cascade; `route`;
  - `amount_minor bigint` (`mode: "bigint"`), with check `>= 0`;
  - `currency char(3)`, default `'INR'`, with check `= 'INR'`;
  - `updated_by` → user, `updated_at`;
  - PK (competition_id, route).
  - An offered route with no row means not set.
- `award_scheme` enum (`ranked_123`, `medals_gsb`, `grades_ab`) and `award_round` enum (`school`, `foa_final`).
- `competition_award_scheme`:
  - `competition_id`, `round`;
  - `scheme`, default `ranked_123`;
  - `prizes jsonb`, typed `Partial<Record<AwardBand, string>>` and validated in `domain/`;
  - `updated_by`, `updated_at`;
  - PK (competition_id, round).
  - No row means the default.
- `competition_consent_document`:
  - `competition_id`, `purpose consent_purpose`;
  - `consent_document_id` → consent_document, on delete restrict. #64's rows are immutable, so the FK is the pin.
  - `attached_by`, `attached_at`;
  - PK (competition_id, purpose).
- `ALTER TYPE consent_purpose ADD VALUE 'competition_terms'` sits in the same migration and is never used in DDL. Only seeds use it, at runtime after the migration commits.

## Design (risk-flagged; compared with `codebase-design`)
- **A. Three narrow use cases over a deep pure core (chosen).**
  - Use cases: `setCompetitionFees`, `setRoundAwards`, `attach/detachConsentDocument`, plus one read, `getCompetitionTermsForEdit`.
  - Every rule (parsing, offered routes, lock, default scheme, band reconciliation, pin state) lives in `domain/` as pure functions. The use cases are thin adapters: `can()`, optional step-up, load, decide, write, audit.
  - Step-up applies only where money is (fees), per #55 story 20 "money operations".
  - #77 reads fees through one function, `getRegistrationTerms`.
- **B. One aggregate `updateCompetitionTerms({ fees, awards, documents })`.** One form and one audit row, but step-up would gate award and document edits too. Its audit diffs mix money with copy, and a large input grows the authz test surface. Rejected.
- **C. Fold the three into 70a's `updateCompetition`.** Its groups are replaced wholesale, so every competition edit would need step-up and re-validate money. 70a's tests would also churn. Rejected.
- **Award schemes:**
  - Chosen: (a), round-keyed rows for planned rounds (`school`, `foa_final`), default `ranked_123`. This matches "chosen per round" and the pilot plan in #55.
  - Rejected: (b), a competition-level scheme with per-round overrides, which keeps two sources of truth before rounds exist.
  - #95/#99 rounds take `foa_final`'s scheme as their default.
  - 70a's `school_positions` (default 3) stays separate from the band count. Noted for #89.
- **Documents:** one document per purpose, pinned by `consent_document_id`, which matches #64's (purpose, version) and #82's per-purpose records. This adds the purpose `competition_terms` rather than reusing `terms`, because the site terms of use are a different text. Attachable today: `competition_terms`, `privacy_notice`. Both are `required` for registration. #82 appends optional purposes.
- **Decisions (reversible, recorded):**
  - Publishing a competition is **not** gated on fees, so 70a's publish contract and tests stay intact. Instead, `getRegistrationTerms` returns `null` for an unset route, and 75b/77a/78 must refuse with `fee_not_set`. Flag this to the reviewer.
  - Fees lock from `registration_open` on (old SPEC §6.3 prior art; HR-34 confirms). Awards and documents stay editable.
  - Fees display with `inr` for whole rupees and `inrExact` when there are paise.
- **Errors:** follow 70a's `{ ok: true, value } | { ok: false, error }` for expected refusals, and #59's forbidden error for authz.
- **Cache:** the server actions call `updateTag(COMPETITION_TAGS.slug(slug))` after each write, so the public page updates.

## Interface needs (code against these; reconcile with what lands)
```ts
// 70a
competition: { id: uuid; slug: text; status: competition_status; participation: "individuals" | "institutions" | "both" };
type PublicCompetition = { /* 70a fields */ }; function toPublicCompetition(row): PublicCompetition; // 72 adds `terms: PublicCompetitionTerms`
as(a).getPublishedCompetition(i: { slug: string }): Promise<PublicCompetition | null>;
h.seed.competition(o?: { status?: CompetitionStatus; participation?: Participation }): Promise<{ id: string; slug: string }>;
const COMPETITION_TAGS: { list: string; slug(s: string): string };
// 71
type CompetitionStatus = "draft" | "published" | "registration_open" | "registration_closed";
// 64
consentDocument: { id: uuid; purpose: consent_purpose; version: int; title: text; publishedAt: timestamptz };
pgEnum("consent_purpose", ["privacy_notice", "terms", "messages"]); // 72 appends "competition_terms"
as(staffAdmin).publishConsentDocument(i: { purpose; title: string; source: string }): Promise<{ ok: true; id: string; version: number } | { ok: false; errors: unknown[] }>;
as(a).currentConsentDocument(i: { purpose }): Promise<{ id: string; purpose; version: number; title: string; publishedAt: Date } | null>;
h.seed.staffAdmin(): Promise<User>;
// 59a
assertCan(ctx: UseCaseContext, action: "competition.edit", r: { type: "competition"; id: string }): Promise<void>; // throws forbidden
writeAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entityType: "competition"; entityId: string; before: JsonValue | null; after: JsonValue | null }): Promise<void>;
h.seed.staff(o: { role: Role; scope?: { type: "competition"; id: string }; secondFactor?: boolean }): Promise<{ user: User; actor: Actor }>;
// 60
assertSteppedUp(ctx: UseCaseContext): Promise<void>; // throws { code: "step_up_required" }; harness can mark an actor stepped-up
// 72 exports (75b, 77a, 78 code against this; 78's brief names the id `documentVersionId`)
getRegistrationTerms(db: AppDb, competitionId: string): Promise<null | {
  fees: Record<ParticipationRoute, { amountMinor: bigint; currency: "INR" } | null>;
  documents: readonly { purpose: AttachablePurpose; documentId: string; version: number; required: boolean }[] }>;
```

## Residue
- **HR-33:** counsel and FOA write the competition terms and consent texts. Seeds use clearly marked draft text, and the placeholder guard blocks production.
- **HR-34:** fee amounts are FOA data entry. FOA also confirms the award-scheme default, the fee lock from registration open, and step-up on fee edits.
- **HR-28:** real-device pass on the admin forms and the public section.
- **HR-01:** no local Postgres, so the Seam 2 spec is written but not run.

## Test plan
- **Unit (done, 3 files):** rupee parsing and formatting, bigint above 2^31, offered routes, the fee decision and its errors, the lock; schemes, bands, rounds, the default plan, reconciliation, errors; pin state and attach decisions, attachable and required purposes.
- **Seam 1:** `use-cases/{fees,awards,consent-documents,terms-read}.test.ts` and `seed/competition-terms.test.ts` on `createHarness()`. Assert return values, rows through `h.db` (bigint exactness), `audit_log` rows, and the authz tables.
- **Seam 2 (Not run):** `tests/e2e/72-competition-terms.spec.ts`. A manager sets fees, a scheme and a document. The public page shows them, and the document link opens that version. axe light and dark on 5 pages.

## Slices
1. Fees: schema enum and table, migration, `setCompetitionFees`, and the fees half of `getCompetitionTermsForEdit` (lock, step-up, audit, authz). Test: `use-cases/fees.test.ts` (ACs 1–5, 11, 12).
2. Awards: `competition_award_scheme` and `setRoundAwards`, plus defaults in the edit read. Test: `use-cases/awards.test.ts` (6, 7, 11, 12).
3. Documents: the `competition_terms` purpose, `competition_consent_document`, attach, re-attach and detach. Test: `use-cases/consent-documents.test.ts` (8, 11, 12).
4. Reads and seed: `terms` in `toPublicCompetition`, `getRegistrationTerms`, the preview seed. Tests: `use-cases/terms-read.test.ts` and `seed/competition-terms.test.ts` (9, 13).
5. Screens: 3 admin sections plus actions (`updateTag`), the public terms section in 70b's detail body, the document version page, messages, and the e2e spec. Test: `tests/e2e/72-competition-terms.spec.ts` (10, 14).
