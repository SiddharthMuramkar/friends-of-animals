# Unit 64: consent documents and consent to messages (#64, M0)

Branch `ticket/64-consent-documents-and-consent-to`, worktree `/root/foa-wt/64`, base `foa/M0`.
Blockers 59a (roles, `can()`, audit) and 61a (outbox, drain). Risk: personal data, the base for guardian consent (#82), legal copy. Size L. No siblings: this unit owns all of #64.
Head start (phase A) on the branch: `src/server/modules/consent/domain/*`, a pure core with unit tests (see "Built in phase A").

## Scope
In:
- versioned, immutable consent documents with a staff publish flow;
- a consent event log keyed by subject, giver, purpose, document version, time and method;
- give, withdraw and history for the `messages` purpose: at sign-up and on `/account/consents`;
- an audit row per change, and an outbox `consent.withdrawn` event per withdrawal;
- `/privacy` and `/terms` render the current published version and its number;
- `/admin/consent-documents`;
- seed data.

Out:
- guardian or minor consent, per-purpose consent for participants, and the `otp_link`/`paper_form` methods (#82, #83);
- competition attachments (#72);
- consumers that react to a withdrawal: gallery, social, auction, communications (#69, #119, #126, #131);
- the rich-text sanitiser (#111);
- the `(staff)` admin layout and navigation (59b), and the staff 2FA gate (#60).

## Acceptance criteria (numbered, with the seam that proves each one)
1. Seam 1. `as(staffAdmin).publishConsentDocument({ purpose: "privacy_notice", title, source })` creates v2. v1 still reads back deep-equal, with the same `publishedAt`. `listConsentDocumentVersions({ purpose })` lists v2 and v1, newest first.
2. Seam 1, raw SQL. On PGlite, `update consent_document ...` and `delete from consent_document ...` raise errors and change no rows (custom trigger).
3. Seam 1, authorization. `publishConsentDocument` as a member, as a visitor, and as a holder of a scoped (non-global) role each fails with `forbidden`, and writes no document and no audit row. Allowed roles: `staff_admin` and `super_admin`, global scope.
4. Seam 1. A member calls `giveConsent({ purpose: "messages", documentId: <current> })`, then `withdrawConsent({ purpose: "messages" })`. `myConsents()` then returns status `withdrawn` and a history of 2 events, newest first, each with its document version, method `web_form` and time.
5. Seam 1. Give and withdraw each write exactly one `audit_log` row: action `consent.given` or `consent.withdrawn`, entity `consent_event`, ids only, IP and user agent from the actor. Publishing writes `consent_document.published`.
6. Seam 1. A withdrawal writes one `outbox` row `consent.withdrawn` in the same transaction. Its payload holds ids only: `consentEventId`, `subjectType`, `subjectId`, `purpose`, `documentId`. A use case that throws after `emit` leaves no event and no outbox row. `h.drain()` dispatches the row, so its status is `dispatched`, not `failed`.
7. Seam 1. Calls that change nothing add no rows. Giving again on the same version, or withdrawing when nothing is given, returns `{ changed: false }` with no new event, audit row or outbox row. Giving on a stale document id fails with `document_outdated`. After v2 is published, giving again records a new event on v2.
8. Seam 1. `currentConsentDocument({ purpose })` returns the latest published version, or `null` before the first one.
9. Seam 1. Sign-up with the messages box ticked records a `given` event (method `web_form`). Unticked records nothing. The box is never pre-ticked.
10. Seam 1. `seedPreview` twice leaves one v1 each of `privacy_notice`, `terms` and `messages`, published by the seeded super admin. Their bodies come from `src/content/legal` (privacy, terms) and a new draft messages document.
11. Seam 2: `tests/e2e/64-consent.spec.ts`. `/privacy` and `/terms` show "Version 1" and the seeded text. A member gives and withdraws on `/account/consents`. A staff admin publishes v2 on `/admin/consent-documents` and `/privacy` shows "Version 2". Written but not run here: no Postgres.
12. Seam 2 with axe: `expectRendersAccessibly` (light and dark) on `/account/consents`, `/admin/consent-documents` and the sign-up consent step. `/privacy` and `/terms` are already in the smoke set.
13. Build. `DATABASE_URL= ... pnpm build` passes. `/privacy` and `/terms` keep a static shell (◐, not ƒ), with the document in a dynamic hole.

## Files
New:
- `src/server/db/schema/consent.ts`, plus one barrel line in `schema/index.ts` (hotspot, union merge);
- `drizzle/NNNN_64_consent.sql`, generated with `--name 64_consent`;
- `drizzle/NNNN_64_consent_document_immutable.sql`, a `--custom` migration for the trigger;
- `src/server/modules/consent/{index.ts,use-cases/*,repository.ts}`;
- `src/server/seed/consent.ts`, plus one line in `seeders` (hotspot);
- `src/content/legal/messages-consent.ts` (draft copy, HR-20), not added to `LEGAL_DOCS`;
- `src/app/account/consents/{page.tsx,_components/*,actions.ts}` (path per 57b's account tree);
- `src/app/(staff)/admin/consent-documents/{page.tsx,_components/*,actions.ts}` (route group per 59a/59b);
- `messages/en-IN/consent.json` and `consentAdmin.json`;
- `tests/e2e/64-consent.spec.ts`.

Touched (hotspots):
- `src/server/app.ts` (one `consentUseCases` entry in `composeUseCases`);
- `src/i18n/messages.ts` (2 namespaces, append-only);
- the sign-up form and action (#57b, #58), plus `auth.json` (consent checkbox copy);
- `src/app/(legal)/_components/legal-document.tsx`, `privacy/page.tsx`, `terms/page.tsx` and `legal.json` (the version label). This is the F7 and #65 static-render conflict;
- 57b's signed-in route registry (`app-routes.ts`, `SIGNED_IN_PREFIXES`);
- 59a's policy action table (append the consent actions).

Not touched: harness, deps (X1), proxy, root layout, site header.

## Design (risk-flagged, so three designs compared)
- **A. Append-only event log, chosen.** `consent_event` (id, subject_type, subject_id, giver_user_id, purpose, document_id → consent_document, action `given|withdrawn`, method, occurred_at). Current state is the latest event per (subject, purpose): a pure fold (`currentConsent`) for one subject, and `DISTINCT ON` in SQL for later gating reads.
  - The interface stays small: give, withdraw, mine.
  - History, and who withdrew how and when, come free.
  - #82 adds a subject type and methods without changing the shape.
  - Concurrent give and withdraw resolve by (occurred_at, UUIDv7 id).
- **B. Record table with `withdrawn_at`.** A partial unique index gives one active consent per subject and purpose at the DB level. But withdrawal mutates the row, so it can't be append-only, and it needs extra columns for withdrawal giver and method. History is lossy on re-consent unless a new row is added each time, and then it's an event log in disguise.
- **C. Event log plus a `consent_current` projection** upserted in the same transaction. Cheap gating reads, and a row lock serialises races. It's two writes and a second invariant for every caller. That's a shallow extra seam until gallery-scale reads exist; add it then if `DISTINCT ON` is slow.

Documents:
- `consent_document` (id, purpose enum, version int, title, body jsonb, published_at, published_by_user_id), unique (purpose, version).
- No drafts: publishing inserts the next version, and preview happens before submit, in the form. So every row is immutable, and the trigger rejects every UPDATE and DELETE.
- Body = `ConsentDocumentBody` (the `short` and `sections` of `LegalDoc` from `src/content/legal/model.ts`). The existing `LegalDocument` renderer draws it, with no HTML and no sanitiser.
- Staff type a small plain-text markup (`- ` short points before the first `## Section {#id}`; paragraphs; `- ` lists; `**strong**`, `[text](/path|#id|https://…)`, `{{fact}}`; `\` escapes). `parseConsentDocumentSource` turns it into a body and returns line-numbered error codes. `formatConsentDocumentSource` pre-fills the form from the current version.

Other decisions:
- Purposes are enum `consent_purpose`: `privacy_notice`, `terms`, `messages`. Only `messages` can be given or withdrawn. `privacy_notice` and `terms` are notices shown on `/privacy` and `/terms`.
- `messages` covers optional news and updates only. Service messages (codes, receipts, legally required notices) never check it.
- Giving requires the document to be the latest published version of that purpose (`document_outdated` otherwise). Consent always points at the exact text the user saw.
- Legal pages (F7): the static shell (header, title, lead) stays prerendered. The body and "Version N · Last updated" sit in a `<Suspense>` hole that first awaits `connection()`, then calls a `'use cache'` loader with `cacheTag("consent-document:<purpose>")` and `cacheLife("max")`. The publish Server Action calls `updateTag`.
  - With no published version (production before HR-20), the page falls back to the repo text with no version number, as it does today.
  - Read before building: `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md` and `04-functions/{cacheTag,cacheLife,updateTag,connection}.md`.
- Sign-up records consent after the account exists, via `as(newUser).giveConsent(...)` from 57b's sign-up action. That's not atomic with Better Auth's user insert (F8f), which is acceptable: on failure the user can still consent in settings, and the error is logged without PII.

## Interface needs (signatures coded against; reconcile with what lands)
```ts
// 59a: policy and audit
type ConsentAction = "consent_document.publish" | "consent_document.list_versions"
  | "consent.give" | "consent.withdraw" | "consent.read_own";
can(actor: Actor, action: Action, resource?: { type: "user"; id: string }): Promise<boolean>;
// rule: publish/list_versions → global staff_admin|super_admin; give/withdraw/read_own → kind "user" acting on own id
assertCan(ctx: UseCaseContext, action: Action, resource?): Promise<void>; // throws DomainError { code: "forbidden" }
writeAudit(tx: AppDb, ctx: UseCaseContext, entry: { action: string; entityType: string;
  entityId: string; before: JsonValue | null; after: JsonValue | null }): Promise<void>;
h.seed.staffAdmin(): Promise<User>; h.seed.superAdmin(): Promise<User>;   // global grants
// 57b: a user actor for tests and actions
h.actorFor(user: { id: string }): Actor;   // else a literal { kind: "user", userId, sessionId, meta }
// 61a: outbox
emit(tx: AppDb, event: { type: "consent.withdrawn"; aggregateType: "consent_event";
  aggregateId: string; payload: Record<string, string> }): Promise<{ id: string }>;
h.drain(): Promise<void>;  // must mark an event with no registered handler `dispatched`, or 64 registers a no-op handler
// 64 exports (for 57b sign-up, #72, #82)
giveConsent(input: { purpose: "messages"; documentId: string }): Promise<{ changed: boolean }>;
withdrawConsent(input: { purpose: "messages" }): Promise<{ changed: boolean }>;
myConsents(): Promise<{ purpose; state: ConsentState; history: ConsentHistoryItem[] }[]>;
publishConsentDocument(input: { purpose; title: string; source: string }):
  Promise<{ ok: true; id: string; version: number } | { ok: false; errors: SourceError[] }>;
currentConsentDocument(input: { purpose }): Promise<PublishedDocument | null>; // public, also the legal-page loader
listConsentDocumentVersions(input: { purpose }): Promise<PublishedDocument[]>;
```

## Residue
- **HR-20:** counsel and FOA approve the privacy, terms and messages-consent copy. Seeds are drafts. In production, staff publish v1 of each through `/admin/consent-documents` after approval.
- **HR-30:** counsel rules whether the sign-up wording meets DPDP notice and consent rules, and on the withdrawal SLA.
- **HR-17:** FOA confirms who may publish (default: `staff_admin` and `super_admin`) and the purpose list.
- **HR-01:** Seam 2 on the preview waits for the secrets and the database.

## Test plan
- Unit (done in phase A): the fold and decide table (never, given, withdrawn, re-consent on a new version, stale id); the purpose catalogue; the body schema (ids, hrefs, facts, empties); source parse and format, including a round trip of all four repo legal docs and line-numbered errors.
- Seam 1 (`src/server/modules/consent/*.test.ts`): ACs 1–10, through `createHarness()`, with raw SQL only for AC 2.
- Seam 2: ACs 11–12 in `tests/e2e/64-consent.spec.ts`. Not run here.

## Slices (ordered, each one behaviour and one test file)
1. Documents. Schema, migration and immutability trigger; `publishConsentDocument`, `currentConsentDocument`, `listConsentDocumentVersions` with authorization and audit; seed. Test: `documents.test.ts` (ACs 1, 2, 3, 5-publish, 8, 10).
2. Consent. `consent_event`, `giveConsent`, `withdrawConsent`, `myConsents`, the audit row, the outbox `consent.withdrawn` and drain. Test: `consent.test.ts` (ACs 4, 5, 6, 7).
3. Sign-up step. 57b's sign-up form checkbox and action call; `auth.json`. Test: `sign-up-consent.test.ts` (AC 9).
4. Screens. `/account/consents`, `/admin/consent-documents` (source textarea, preview, publish, old versions), `consent` and `consentAdmin` namespaces. Test: `tests/e2e/64-consent.spec.ts` (ACs 11, 12).
5. Legal pages. `/privacy` and `/terms` read the current version in a cached dynamic hole, with the fallback. Test: build route table plus Seam 2 (ACs 11, 13).

## Built in phase A (commit 5ad8b35 on the branch, pushed, no PR)
`src/server/modules/consent/domain/`. Pure code with relative imports only, so the schema and seed can import it.
- `consent-state.ts`:
  - `currentConsent(events)`;
  - `decideGive(state, latest | null, requestedDocumentId)` returns `record`, `unchanged`, or `reject` with `document_outdated` or `no_published_document`;
  - `decideWithdraw(state)`.
- `document-body.ts`: `ConsentDocumentBody`, `parseConsentDocumentBody(unknown)` returning `{ ok, body | issues }`, `isAllowedHref`, `SECTION_ID`.
- `document-source.ts`: `parseConsentDocumentSource(text)` returning `{ ok, body | errors: { line, code }[] }`, and `formatConsentDocumentSource(body)`.
- `purposes.ts`: `CONSENT_PURPOSES`, `GIVABLE_PURPOSES`, `LEGAL_PAGE_PURPOSE`, `CONSENT_METHODS`, `CONSENT_SUBJECT_TYPES`. The schema's `pgEnum`s use these arrays.

Seed bodies: `{ short: LEGAL_DOCS.privacy.short, sections: LEGAL_DOCS.privacy.sections }` (the same for terms). Each passes `parseConsentDocumentBody` (tested).
