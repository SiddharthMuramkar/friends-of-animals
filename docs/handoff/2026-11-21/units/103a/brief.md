# Brief 103a: gallery curation and public gallery pages from the database

Unit 103a of #103 · M4 · L · risk (A K C LH) · keys X4 (CSP sources, `next.config.ts`), X12 (home gallery) · branch
`ticket/103-pages` · worktree `/root/foa-wt/103a` · blocked by #102, 99b (and through them 99a, 100b/c, #97, #85, #82/#83,
70b, #65, #63, #62, 61a, 59a). Prepped by foa-p103 on 2026-11-21 against `foa/ticket/57-harness` 0569f4f (PR #140).
Sources: #103 body (no owner comments), #55 decisions (none for the gallery), `issues-M3-M4.md` #103 + M34-2/5/7/8/10,
spec §1.7–§1.11, §2.6, §10; house patterns from 70b (public DB pages) and 89a (module + full enum up front).

## Scope
**In (103a):** the Gallery module (H24 owner): schema `gallery.ts` with enum `gallery_item_status` (all four values,
F2), enum `gallery_unpublish_reason` (both values: `consent_withdrawn`, `disqualified`; the spec's third value `moderator` is
dropped because a moderator hides, never unpublishes) and every `gallery_item` column, hidden and unpublished columns included,
so 103b and 103c add no column to it; one migration `--name 103_gallery`; `PublicAssetUrl` (folded harness item, dag.md)
and the fallback route `/media/p/[...key]`; the single status writer `transitionGalleryItem` (siblings go through it); use
cases `listGalleryCandidates`, `pickGalleryEntry`, `editGalleryItem`, `publishGalleryItem`, `listGalleryItemsForAdmin`,
`listPublicGallery`, `getPublicGalleryItem`, `featuredGalleryItems`, `readPublicAsset`; pages `/gallery`,
`/gallery/[entryCode]`, `/admin/gallery`; `/gallery` in `ROUTES` + `nav.links.gallery` + sitemap (list page only) and out
of the unbuilt list in `routes.test.ts`; the home `Gallery` section shows featured items (placeholder frames when none);
CSP `img-src` for the CDN origin; namespaces `gallery`, `adminGallery` (+ `home.gallery` keys); preview seed;
`tests/e2e/103-gallery.spec.ts`; Lighthouse evidence. **Pure core already on the branch** (see "Head start").
**Out:** 103b owns the `consent.withdrawn` consumer, every `→ unpublished` move, deleting public objects, `CdnPurger`,
`cdn_purge`, the SLA setting and alert. 103c owns reports (`/gallery/[entryCode]/report`, its link on the item page),
`published → hidden`, `hidden → draft`, the hide button and `/admin/gallery/reports`. 103d owns the original-asset crawl.
#104 owns social. #102 owns stamping; 99b owns the credit resolver extraction and the revalidation route.

## Acceptance checks
1. `listGalleryCandidates({ competitionId })` lists every finished entry with a reason per row; eligible only with valid
   public-display consent: adult individual with consent ✓; minor with guardian consent ✓; school-route student covered
   only by the institution declaration ✗ (`no_public_display_consent`, #83); withdrawn ✗; never asked ✗. *Seam 1*
2. `pickGalleryEntry({ entryId })`: ineligible → `no_public_display_consent`, no row; eligible → `draft` with the entry's
   title, recognition, age category and discipline snapshot; again → `already_picked`; no stamped gallery copy → #102's
   stamp job requested (fake). An `unpublished` item can be re-picked (`unpublished → draft`) only while eligible. *Seam 1*
3. `editGalleryItem`: title 1–120 and story 0–500 graphemes after normalising (trim, collapse spaces, drop control
   characters and bidi overrides, keep paragraphs with at most one blank line in the story); 121 → `title_too_long`; `featured` toggles. *Seam 1 + Vitest (done)*
4. `publishGalleryItem`: stamp pending → `stamp_pending`; consent withdrawn since the pick → `no_public_display_consent`;
   else `published`, `published_at` = clock, one audit row `gallery.published`, tags `gallery` + `gallery:<code>`
   revalidated (fake). Status machine: every (from ∈ none + 4) × (to ∈ 4) pair against the literal table. *Seam 1 + Vitest*
5. Public read models show title, credit per #82's resolver (adult as resolved; minor "Asha K."; school only with
   display_school; city only with display_city), age category, recognition and story; drafts and other statuses absent;
   filters (competition, discipline, age category, recognition) and cursor pages with no gap or overlap. *Seam 1*
6. **Original-key test:** the JSON of every public read model (list, item, featured) contains no `storage_key` of any
   seeded file whose purpose is not `stamped_*` (originals and private derivatives), and every URL in it parses as a
   `PublicAssetUrl` for a `stamped_*` file. `publicAssetUrl` refuses any other purpose. *Seam 1 + Vitest (done)*
7. `readPublicAsset({ key })` (behind `/media/p/[...key]`, used when `PUBLIC_ASSET_BASE_URL` is unset outside
   production): a clean `stamped_*` file streams; any other purpose, unknown or deleted file, `..`, empty or encoded-slash
   segment → 404. Production without the base fails closed. *Seam 1 + Vitest (done for the parser and base)*
8. Authz on every curation use case: content manager, staff admin, super admin ✓; member and competition manager ✗.
   Public reads and `readPublicAsset`: visitor ✓. *Seam 1*
9. `h.seed.preview()` twice leaves the same gallery: published items for an adult, a minor on the default credit and a
   minor with both opt-ins, one draft, two featured, each with `stamped_gallery` + thumb file rows. *Seam 1*
10. `/gallery`, `/gallery/<code>`, `/admin/gallery` render accessibly, light + dark, no horizontal scroll at 320 px; an
    unknown or unpublished code is a 404; home shows featured items, else the frames. *Seam 2, written, Not run here*
11. Lighthouse mobile ≥ 90 (performance, accessibility) on `/gallery` and one item page, with 70b's runner. *Evidence,
    Not run here (no Postgres, no reachable preview)*
12. `routes.test.ts` passes with `/gallery` registered and out of the unbuilt list; the build keeps `/gallery` ◐ and the
    item route ISR (no ƒ public page). *Vitest + build gate*

## Files and hotspots
- Head start (committed): `src/server/modules/gallery/domain/{status,text}.ts`,
  `src/server/modules/files/domain/public-asset-url.ts` + tests. Keep `domain/*` free of `server-only`, `@/` and Next.
- New: `src/server/db/schema/gallery.ts` (+ barrel line, H1); `drizzle/NNNN_103_gallery.sql` (H2);
  `src/server/modules/gallery/{index,candidates,pick,edit,publish,transition,public-read,public-asset}.ts` + tests;
  `src/server/seed/gallery.ts` (+ `seeders` line, H6); `src/app/gallery/{page.tsx,[entryCode]/page.tsx,_components/*,
  _lib/*}`; `src/app/media/p/[...key]/route.ts`; `src/app/admin/gallery/{page.tsx,actions.ts,_components/*}` (path per
  57b's staff tree); `messages/en-IN/{gallery,adminGallery}.json` (+ `src/i18n/messages.ts`, H3); `tests/e2e/103-gallery.spec.ts`.
- Append-only: `composeUseCases` in `src/server/app.ts`; `can()` policy (H8): `gallery.curate`, `gallery.read_published`;
  `src/lib/routes.ts` + test, `messages/en-IN/nav.json`, `sitemap.ts` (H4, H32); `src/lib/csp-sources.ts` (X4);
  `src/env.schema.ts` `PUBLIC_ASSET_BASE_URL` (optional; serialize). X12: `src/app/page.tsx` `Gallery` (267–282),
  `gallery-frames.tsx`, `messages/en-IN/home.json` (shared with #111 later).
- GLOSSARY via `domain-modeling`: Gallery item, Public credit, Stamped copy, Public asset URL, Featured.

## Design (risk-flagged: the three tournament contenders compared)
- **A. Simplest thing:** every gallery page dynamic inside `<Suspense>`, live DB read per request. Withdrawal shows at
  once, but each visit costs a render and DB round trips (Lighthouse, PgBouncer), and nothing types "public only".
- **B. Deep Gallery module + branded URLs + tagged cache (chosen).** The module's public interface is three read use
  cases returning view models whose only image field is `PublicImage { src: PublicAssetUrl; srcset; width; height }`.
  `PublicAssetUrl` can only be built by `publicAssetUrl(base, file)`, which refuses non-`stamped_*` purposes, so a raw
  key cannot reach a page by construction and AC 6 proves it at runtime (leverage: #104, 99b, 131 reuse it). Pages follow
  70b: `/gallery` keeps its shell static and streams the list (`connection()` → `'use cache'` read, tags `gallery`);
  the item page is ISR (`generateStaticParams` placeholder, cached read tagged `gallery` + `gallery:<code>`). Every
  cached read uses `cacheLife({ stale: 60, revalidate: 300, expire: 900 })`, so even a failed revalidation drops a
  withdrawn item within 15 min (the default SLA). Credit is computed inside the cached read from #82's resolver, never
  stored; revalidation on consent change is 103b's.
- **C. Public projection table** `gallery_public_item` rebuilt on every consent event: a second copy of credits and URLs
  that can drift, a rebuild path to test, and a stored credit (#82 says derived). Rejected.
- **One status writer.** `transitionGalleryItem(ctx, tx, { itemId, to, reason })` checks `assertGalleryTransition`,
  locks the row (`FOR UPDATE`), writes status columns, audit, and revalidation. 103b adds asset retraction + purge inside
  it for every move out of `published`; 103c calls it. Machine (literal, F2): (none)→draft (pick); draft→published;
  published→hidden; hidden→draft (restore, re-stamp); draft|published|hidden→unpublished (system); unpublished→draft.
- **Item 404.** Spike first in slice 4: cached read at the page's top level (not under Suspense) and `notFound()` before
  streaming. If Next 16.4 still answers 200, fall back to 70b's proxy pattern (memoised published codes) and flag key X2
  in the PR; never ship a 200 "not found".
- **Images.** No `remotePatterns`: `<img>` with width/height, `srcset` (480 thumb, 2048 full), `loading="lazy"` except
  the item page's LCP image (`fetchpriority="high"`). `alt` = title + credit from messages. Check oxlint `nextjs` rules
  on `<img>`; if `no-img-element` fires, use `next/image` with `unoptimized` instead of disabling it.
- **Approved display name** = #82's resolver output, shown read-only to the content manager at publish; no manual name
  override in v1 (HR-44 decides whether shortening is allowed).

## Interface needs (adopt the real names on `M4` at claim)
```ts
// #82/#83 (M34-7): consent read API + resolver (99b extracts it if it is not shared)
canUse(db: AppDb, subject: ConsentSubject, purpose: "public_display", ctx: { competitionId: string }): Promise<boolean>;
publicCreditsFor(db: AppDb, subjects: ConsentSubject[], competitionId: string): Promise<Map<string, PublicCredit>>;
type PublicCredit = { name: string; school: string | null; city: string | null }; // minor default "Asha K."
// 85b entries (+ #89/#97 recognition, M34-5)
listGalleryEntrySources(db: AppDb, i: { competitionId: string }): Promise<{ entryId: string; entryCode: string;
  competitionId: string; categoryKey: string; ageCategoryKey: string; discipline: string; title: string;
  finished: boolean; subject: ConsentSubject; derivedImageFileId: string | null;
  recognition: { kind: "round"; outcome: RoundOutcome; awardPosition: 1 | 2 | 3 | null } | { kind: "school"; position: 1 | 2 | 3 } | null }[]>;
// #102 stamping
findStampedDerivative(db: AppDb, i: { sourceFileId: string; variant: "gallery" | "gallery_thumb" }):
  Promise<{ fileId: string; purpose: `stamped_${string}`; storageKey: string; width: number; height: number } | null>;
requestStamp(tx: AppDb, clock: Clock, i: { sourceFileId: string; variant: "gallery" }): Promise<void>; // also cuts the thumb
// 63a + #102: public bucket
deps.files.publicBucket: string; ObjectStorage.read({ bucket, key }): Promise<ReadableStream<Uint8Array>>;
// 99b: revalidation that works in a request and from the worker; fake records tags
revalidatePublicTags(ctx: UseCaseContext, tags: readonly string[]): Promise<void>;
// 59a
authorize(ctx, "gallery.curate"): Promise<{ role: Role | null }>; recordAudit(tx, ctx, { action, entity, before, after, actorRole });
// 70b: PUBLIC_READER actor, Lighthouse runner; #65: CspSources { feature, directives: { "img-src": [origin] } }
```

## Head start (pure core, Vitest only): `4e60db5` on `ticket/103-pages`, 93 tests, `pnpm check` green
- `gallery/domain/status.ts`: `GALLERY_ITEM_STATUSES`, `GALLERY_UNPUBLISH_REASONS`, `GALLERY_TRANSITIONS` (literal, with
  `by: "content_manager" | "system"`), `canTransitionGalleryItem`, `assertGalleryTransition`, `isPubliclyVisible`, `leavesPublicSite` (103b retracts assets on these moves).
- `gallery/domain/text.ts`: `GALLERY_TEXT_LIMITS`, `graphemeCount`, `normaliseGalleryTitle`, `normaliseGalleryStory`.
- `files/domain/public-asset-url.ts`: branded `PublicAssetUrl`, `publicAssetBase`, `publicAssetUrl`,
  `isPublicAssetPurpose`, `storageKeyFromFallbackPath`, `storageKeyFromPublicAssetUrl` (AC 6 parses read-model URLs
  with it; 103b builds purge lists from it). Keys must match #63's `<prefix><purpose>/<uuid>` layout exactly.

## Residue
HR-44 (safeguarding sign-off of gallery credits; whether display names may be shortened), HR-30 (DPDP: minors' public
credit), HR-13 + HR-11 (production CDN host `PUBLIC_ASSET_BASE_URL`; production fails closed until set), HR-06 (non-prod R2:
preview images 404 until it exists; alt text still renders), HR-28 (Lighthouse ×3 on a phone), HR-01 (Seam 2 on previews).

## Test plan
Vitest for the core (done). Seam 1 through `createHarness()` with seed builders for competitions, entries, consents and
stamped files; one test file per slice; authz matrix per use case; the original-key test collects every seeded
`file_asset.storage_key` and searches the serialised read models. Seam 2 spec with `expectRendersAccessibly` (+ `.dark`)
on 3 pages and the home section, Not run. Lighthouse via 70b's runner, Not run.

## Slices (ordered)
1. Schema, migration, `pickGalleryEntry` + `listGalleryCandidates` + authz (AC 1, 2, 8) · `pick.test.ts`.
2. `editGalleryItem`, `publishGalleryItem`, `transitionGalleryItem`, audit, revalidation (AC 3, 4, 8) · `publish.test.ts`.
3. Public read models, filters, cursor, original-key test, `readPublicAsset` (AC 5, 6, 7) · `public-read.test.ts`.
4. Pages, fallback route, admin page + actions, routes/nav/sitemap, home section, CSP source, seed, e2e spec (AC 9–12) ·
   `seed/gallery.test.ts` + `tests/e2e/103-gallery.spec.ts`.
