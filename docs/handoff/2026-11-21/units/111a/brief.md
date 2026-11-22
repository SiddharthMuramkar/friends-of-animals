# Unit 111a: CMS core: revisions, preview, sanitiser, versioned legal pages (#111, M5)

Branch `ticket/111-core` · worktree `/root/foa-wt/111a` · base `foa/M0` 442dd99 · size L · risk A (stored XSS, staff gate), C (static CSP)
· keys none (holds H38, Q6 first) · blockers 60, 64, 65 (through them 57b and 59a) · sibling **111b** (home, about, impact, site facts).
**Head start pushed:** `b9e7863 M5 #111: Add CMS revision and rich-text sanitiser domain core` (pure, 91 tests, `pnpm check` green):
`src/server/rich-text/{strip-markup,href,blocks}.ts` and `src/server/modules/cms/domain/{revisions,documents}.ts`.

## Scope
- **In (111a):** enum `cms_revision_status`; tables `cms_document`, `cms_revision`; `consent_document.legal_revision_id`; the
  one rich-text sanitiser (built) on save and on render; use cases `listCmsDocuments`, `listRevisions`, `saveDraft`,
  `publishRevision`, `getPublishedDocument`, `getDraftForPreview`, `startPreview`; the cached public read and its tags; Draft
  Mode entry and exit; the **legal** kind: `/privacy`, `/terms`, `/safeguarding`, `/child-protection-policy` from the CMS with
  "Version n, published <date>"; consent documents linked to the legal revision; `/admin/cms` (all 8 documents with
  draft/published state) and `/admin/cms/[key]` for legal documents; seed; authz tests; the build check list.
- **Out, 111b:** the `home`, `page` (about), `impact` and `facts` kinds (body schemas, editors, seeds); rewiring `/`, `/about`,
  `/impact`; `getOrgFacts()`, the facts readiness check, `SITE.org`, footer and JSON-LD facts. 111a's registry already lists
  their keys; 111b adds one kind file each.
- **Out, later:** blog/stories (#112, adds the `post` profile with images), contact inbox (#113), events (#125), the HTML entry
  point of the sanitiser for essays (86b, same folder).

## Acceptance checks (seam)
1. **Stripped on save** (S1). As a content manager with a verified second factor, `saveDraft({ key: "legal_safeguarding", body })`
   whose strings hold `<script>…</script>`, `<img src=x onerror=…>`, `<svg onload>` and a link to `javascript:alert(1)`: the row
   read raw through `h.db` holds none of them (link becomes text). Corpus and idempotence: unit, done in `blocks.test.ts`.
2. **Stripped on render** (S1). A published revision inserted raw with the same payloads: `getPublishedDocument` returns the
   sanitised body; the public renderer never uses `dangerouslySetInnerHTML` (grep check in the PR evidence).
3. **Preview without going public** (S1). After `saveDraft`, `getPublishedDocument` (visitor) still returns the published
   revision; `getDraftForPreview({ key })` returns the draft for a content manager and refuses a member and a competition
   manager with `forbidden`. `startPreview` is what the Draft Mode entry action calls; it refuses the same roles.
4. **Publish** (S1). `publishRevision({ revisionId })` makes it `published` with `version = max + 1`, the previous one
   `superseded`, in one transaction; writes one audit row `cms_revision.published` (entity `cms_revision`; before/after = ids,
   status, version; no body); returns `{ version, tags: tagsToRefresh(key) }`, which the Server Action passes to `updateTag`.
5. **Immutability** (S1). `saveDraft` never edits a published or superseded row (decision tested, done); a raw `UPDATE` of
   a published row's `body` raises (custom trigger); a second `published` or second `draft` row per document violates the
   partial unique indexes.
6. **Authorization** (S1, table-driven). `saveDraft`, `publishRevision`, `listRevisions`, `getDraftForPreview`, `startPreview`:
   global `content_manager` passes; member, staff_admin, competition_manager and visitor get `forbidden` and write nothing.
   Without a verified second factor a content manager gets #60's `second_factor_required`. Public reads: anyone.
7. **Legal versions and consent link** (S1). Publishing `legal_privacy` v2: `currentLegalVersion("legal_privacy")` is
   `{ version: 2, publishedAt }`; the same transaction inserts the next `privacy_notice` consent document with the same body
   and `legal_revision_id` = that revision (terms likewise). A `messages` consent document published through #64 records the
   current `legal_privacy` revision. #64's admin screen publishes `messages` only from now on.
8. **Static and fresh** (build). `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build` passes; the four legal
   routes stay ○ or ◐ (add them to #65's prerender assertion list if missing); initial JS within 170 kB.
9. **Seed** (S1). `seedPreview` twice: 8 `cms_document` rows; each legal document has exactly one published v1 whose body is
   the current repo text (`src/content/legal`, or #64's v1 consent body for privacy and terms, which is the same text).
10. **Seam 2, written, Not run:** `tests/e2e/111-cms.spec.ts`: `expectRendersAccessibly` light + dark on `/admin/cms` and
    `/admin/cms/legal_privacy`; publish v2 → `/privacy` shows "Version 2"; preview shows the draft and a "Draft preview" status,
    exit restores the published text. Lighthouse ≥ 90 on `/privacy`: residue (F23, no runner yet).

## Design (risk-flagged; compared with codebase-design vocabulary)
- **Content model.** (i) **Chosen:** typed bodies per kind; rich text is the policy-page block shape (`p`, `list`, `strong`,
  `link`, `fact`), the same shape #64 stores, rendered by React. Editors type #64's plain-text markup
  (`parseConsentDocumentSource` / `formatConsentDocumentSource`), with a server-rendered preview. No editor JS, no HTML ever
  stored, and the existing `LegalDocument` renderer draws CMS bodies unchanged (all four repo docs pass the sanitiser
  untouched, tested). (ii) One HTML field per document through 86b's hast sanitiser: richer editing, but `innerHTML` on
  static public pages whose CSP allows inline script, and home/about copy is layout, not free HTML. (iii) A generic block
  CMS (tournament contender c): deeper but overbuilt for eight fixed documents.
- **The one sanitiser** lives in `src/server/rich-text/`. 111a's entry points: `sanitizeDocumentBody`, `sanitizeBlocks`,
  `sanitizeInlines`, `sanitizePlainText` (typed input), `safeHref`, `linkRel` (`noopener noreferrer nofollow` on https).
  86b adds `sanitize.ts` (`sanitizeRichText(html, profile)`, hast) beside them; no file overlaps. Whichever lands second
  moves both corpora into one shared `xss-corpus.ts`. Profiles are data (`cms` now; `post` from #112a).
- **Revisions.** (i) **Chosen:** revision rows with status; at most one open draft (edited in place) and one published per
  document (partial unique indexes); versions numbered at publish, never reused. (ii) Document + pending-copy column: no
  history, no "Version n". Rejected.
- **Rendering (tournament P+B3, F10).** (a) **Default:** cached read in the static shell: `loadPublishedDocument(key)` with
  `'use cache'`, `cacheTag(cmsTag(key))`, `cacheLife("max")`; with no `DATABASE_URL` at build it returns the seed body (repo
  text), so CI builds pass; publish → `updateTag`. Text stays in the prerendered HTML (LCP, SEO). (b) Static shell + a
  `<Suspense>` hole after `await connection()` around the cached loader (#64's pattern for `/privacy`): always fresh, no
  fallback, text not in the shell. Switch to (b) if a prerender DB read trips §1.7 trap 15 (`env()` during prerender).
  (c) Build-time snapshot: needs a deploy per publish. Rejected.
- **Draft Mode.** Editor button → Server Action → `startPreview` (authz) → `(await draftMode()).enable()` → redirect to the
  public path. With Draft Mode on, the page renders the draft in a `<Suspense>` hole that resolves the actor from the session
  (a revoked role stops previewing at once) and shows a "Draft preview" status with an exit action (`disable()`). Read
  `node_modules/next/dist/docs/01-app/02-guides/draft-mode.md` (cache bypass, "Draft Mode with Cache Components") first.
- **Revalidation without a port.** Use cases return tags; the Server Action calls `updateTag` for each (§1.7 trap 9). No new
  `Deps` field, so X1 stays free. #112a's worker-side scheduled publish needs `revalidateTag(tag, "max")` instead: its problem.
- **Legal pages with #64 (F11).** (L-A) **Chosen:** the CMS is the one editor of all four pages; publishing privacy or terms
  mirrors the body into the next consent document in the same transaction, with `legal_revision_id`. Text and consent records
  can't drift; #64's immutability holds (insert only). (L-B) Link only: two editors for one text. (L-C) #64 keeps privacy and
  terms: content managers can't edit them (fails AC 1 of #111). The page shows the CMS version.
- **Policy defaults:** actions `cms.read_drafts`, `cms.save_draft`, `cms.publish`: `role("content_manager")` only (super admin
  is not a wildcard in 59a; they can grant themselves the role, audited), each flagged `secondFactor: "staff"`.

## Interface needs (code against; adapt names, not shapes)
```ts
// 59a access + audit
authorize(ctx: UseCaseContext, action: Action, resource?: Resource): Promise<{ role: Role | null }>; // DomainError("forbidden")
recordAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entity: { type: string; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
// CMS_POLICY appended to POLICY: { "cms.read_drafts" | "cms.save_draft" | "cms.publish": role("content_manager") }
h.seed.grant(user, { role: "content_manager", scope: { type: "global" } }); h.signIn(user): Promise<Actor & { kind: "user" }>;
// 60: rule flag secondFactor?: "staff"; a harness way to verify the session's factor (seeded TOTP + verifySecondFactor)
// 64 consent
consentDocument: { id; purpose: "privacy_notice" | "terms" | "messages"; version: number; title; body: ConsentDocumentBody; publishedAt; ... }
insertConsentDocumentVersion(tx: AppDb, ctx: UseCaseContext, i: { purpose: "privacy_notice" | "terms"; title: string; body: ConsentDocumentBody; legalRevisionId: string }): Promise<{ id: string; version: number }>;
parseConsentDocumentSource(text: string): { ok: true; body: ConsentDocumentBody } | { ok: false; errors: { line: number; code: string }[] };
formatConsentDocumentSource(body: ConsentDocumentBody): string;
// 64's LegalDocument takes a body + version label (or 111a makes it so); 65: the prerender assertion list in scripts/csp-output.ts
// 59b: the (staff) admin layout and nav (H19); 57b: SIGNED_IN_PREFIXES covers /admin
```
**111a provides (for 111b, 112a, 125):**
```ts
type CmsKind<Body> = { parse(v: unknown): { ok: true; body: Body } | { ok: false; issues: string[] }; sanitize(v: unknown): Body; seedBody(): Body };
// src/server/modules/cms/kinds/index.ts: one line per kind (legal here; 111b adds home, page, impact, facts)
listCmsDocuments(): Promise<{ key: CmsDocumentKey; kind: CmsDocumentKind; published: { version: number; publishedAt: Date } | null; hasDraft: boolean }[]>;
saveDraft(i: { key: CmsDocumentKey; body: unknown }): Promise<{ revisionId: string }>; // refuses invalid_body { issues }
publishRevision(i: { revisionId: string }): Promise<{ version: number; tags: string[] }>;
getPublishedDocument(i: { key }): Promise<{ key; version: number; publishedAt: Date; body: unknown } | null>;
getDraftForPreview(i: { key }): Promise<{ revisionId: string; body: unknown } | null>;
loadPublishedDocument(key): Promise<...> // 'use cache' loader for pages, tag cmsTag(key)
currentLegalVersion(key): Promise<{ version: number; publishedAt: Date } | null>;
```

## Files
- **Built:** `src/server/rich-text/{strip-markup,href,blocks}.ts` + tests; `src/server/modules/cms/domain/{revisions,documents}.ts` + tests.
- **New:** `src/server/db/schema/cms.ts` (enum from `CMS_REVISION_STATUSES`; `cms_document` id, key unique, kind, created_at;
  `cms_revision` id, document_id FK, version int null, body jsonb, status, created_by/at, updated_at, published_by/at;
  unique (document_id, version); partial uniques on draft and on published); migrations `NNNN_111_cms` (generated, incl.
  the nullable `consent_document.legal_revision_id` FK) and `NNNN_111_cms_revision_guard` (`--custom`: reject UPDATE of
  `body` unless the old status is `draft`, and DELETE); `src/server/modules/cms/{index,use-cases,read,kinds/legal,kinds/index}.ts`
  + Seam 1 tests; `src/server/seed/cms.ts`; `src/app/(staff)/admin/cms/{page.tsx,[key]/page.tsx,_components/*,actions.ts}`;
  `messages/en-IN/adminCms.json`; `tests/e2e/111-cms.spec.ts`.
- **Shared, one line each (merge queue unions):** schema and seed barrels, `src/server/app.ts`, `src/i18n/messages.ts`,
  59a's policy table, 59b's admin nav (H19), `drizzle/meta/*` (regenerated).
- **Hotspots:** H38 (owner), H16 (64's schema column, `insertConsentDocumentVersion`, its admin screen limited to
  `messages`), H39 shared: 111a owns `(legal)/**` + `legal.json` (version label), 111b owns `/`, `/about`, `/impact`;
  `legal-document.tsx` is edited by 64 then 111a then 111b (facts): keep the order. No X key needed (no proxy, layout, csp).

## Residue
- **HR-50:** counsel signs off the four legal pages and the CMS seed copy; seeds are the repo drafts.
- **HR-17:** who holds `content_manager` in production (default rule: content managers only).
- **HR-51:** defaults to confirm: one open draft per document, versions count publishes, preview by Draft Mode.
- **HR-01:** Seam 2 needs the preview secrets. **HR-28** + F23: Lighthouse ≥ 90 on new public pages (no runner here).

## Test plan
- Unit (done): sanitiser corpus, idempotence, allowlist, policy docs untouched; revision moves table; registry and tags.
- Seam 1 on `createHarness()`: slices below; raw SQL only for the trigger and partial-unique checks; authz table per use case.
- Build: the gate commands with empty variables; compare the route table with M5's tip. Seam 2: written, Not run.

## Slices (L → 4; each one behaviour, one test file)
1. **Drafts and publishing.** Schema, migrations, legal kind, `saveDraft` / `publishRevision` / `listRevisions` /
   `listCmsDocuments`, audit, authz, staff gate. `src/server/modules/cms/publishing.test.ts` (AC 1, 4, 5, 6).
2. **Public read and preview.** `getPublishedDocument` (sanitise on render), `getDraftForPreview`, `startPreview`, the cached
   loader with its no-DB fallback. `src/server/modules/cms/reading.test.ts` (AC 2, 3).
3. **Legal versions and consent link.** `legal_revision_id`, mirror on publish, `currentLegalVersion`, seed.
   `src/server/modules/cms/legal.test.ts` (AC 7, 9).
4. **Screens and pages.** `/admin/cms`, the legal editor (markup textarea, preview, publish, revisions), Draft Mode entry/exit,
   the four legal pages from the CMS, `adminCms` namespace, build list. `tests/e2e/111-cms.spec.ts` + the build gate (AC 8, 10).
