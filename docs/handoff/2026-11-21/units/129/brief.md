# Brief 129: adoption listings (#129, M7)

Unit 129 = all of #129 (no siblings) · L · not risk-flagged · no conflict keys · branch `ticket/129-adoption-listings` ·
worktree `/root/foa-wt/129` (cut from `foa/M0` 442dd99; rebase onto `foa/M7` at build) · blocked by 127, 85a, 111a (and
through them 59a, 61a, 63a/b, 114). PR base `M7`, title `M7 #129: Adoption listings`. Prepped by foa-p129 on 2026-11-21
against `foa/ticket/57-harness` (PR #140). Sources: #129 body (no comments), #55 (stories 176-181; no adoption
decisions), `issues-M6-M8.md` #129 + 0.1-0.3, spec §1.2/§1.7-§1.11, briefs 63a, 85a, 103a, 70b, 59a, 114.
**Head start on the branch (ae24159):** `src/server/modules/adoption/domain/{status,age,details,filters,slug,photos}.ts`,
146 Vitest cases, `pnpm check` green. Use cases call these; don't re-implement them.

## Scope
**In:** the Adoption module's listing half. Schema `adoption.ts`: enums built from the domain lists
(`adoption_listing_status` with all 5 values (F2), `adoption_species`, `animal_sex`, `animal_size`); `adoption_listing` (id
uuidv7, directory_listing_id → 127, slug unique, name, species, breed, sex, size null, colour, birth_month `date` (first of
the month, never an age), sterilised bool null, about, health_notes, vaccination_notes, conditions, state, city, city_key,
pin_code, status, published_at, closed_at, created_by_user_id, created_at, updated_at; index (status, published_at desc,
id desc)); `adoption_listing_photo` (id, listing_id, file_asset_id unique, position, alt_text, created_at). One migration
`--name 129_adoption_listings` that also adds `adoption_photo` to `file_asset_purpose` (used by no DDL, F2). Use cases
`createAdoptionListing`, `updateAdoptionListing`, `addListingPhoto`, `removeListingPhoto`, `publishAdoptionListing`,
`holdAdoptionListing`, `resumeAdoptionListing`, `withdrawAdoptionListing`, `browseAdoptableAnimals`, `getAdoptableAnimal`,
`readAdoptionPhoto`, `listMyAdoptionListings`, `getAdoptionListingForOwner`; the single writer `transitionAdoptionListing`.
Pages `/adopt` (+ `layout.tsx` with the disclaimer), `/adopt/[slug]`, `/dashboard/organisation/adoptions{,/new,/[listingId]}`;
route `GET /media/adoption/[photoId]/[kind]`; namespace `adoption`; `/adopt` in ROUTES + nav + sitemap; preview seed;
`tests/e2e/129-adoption.spec.ts`.
**Out:** applications, coordinator workflow, the `→ adopted` use case, success stories (#130 uses the `adopted` move this
table already defines); distance search (#128; "location" here = state, city, PIN); directory listings, verification,
the representative grant and suspension (#127); scanning and derivative generation (63b, 85a); staff moderation of
single animals (suspending the directory listing is FOA's lever). No consumer of `directory.listing_suspended` (see Design).

## Acceptance checks (seam)
1. **Verified only.** A representative of a `verified` directory listing creates a `draft`; one of a pending, rejected,
   suspended or withdrawn listing gets `directory_not_verified` and no row. Publish and resume re-check it. *Seam 1*
2. **Derived copies only.** The JSON of `browseAdoptableAnimals` and `getAdoptableAnimal` holds no `storage_key` of any
   seeded `file_asset` or `file_derivative`; every image URL is `/media/adoption/<photoId>/<kind>` with kind in
   `ADOPTION_PHOTO_KINDS`. `readAdoptionPhoto` returns the derivative's bytes (equal to the storage fake's object) for a
   publicly visible listing, and `not_found` for a hidden listing, an unprocessed photo, an unknown kind or `original`. *Seam 1*
3. **Filters.** A fixture of ~10 animals (species × age band × sex × size × state × city × sterilised) returns the
   hand-listed ids, newest first, for each filter and two combinations; city matches without case; keyset pages have no
   gap or overlap; draft, withdrawn, on-hold and adopted animals are absent; `clock.advance` moves an animal across age
   bands. *Seam 1 + Vitest (parse, cursor, bands: done)*
4. **Disclaimer.** `src/app/adopt/layout.tsx` and each dashboard adoption page render `<AdoptionDisclaimer>`. *Vitest
   (element tree of the sync component and layout) + Seam 2 (text on every adoption page)*
5. **Transition table.** Every (from ∈ new + 5) × (to ∈ 5) × mover triple against the literal table. *Vitest (done, 74
   cases)*; a forbidden move through a use case → `invalid_transition`, row unchanged. *Seam 1*
6. **Lifecycle effects.** Publish sets `published_at`, one audit row and one `adoption.listing_published` outbox row;
   withdraw sets `closed_at`, emits `adoption.listing_closed`; hold/resume audit; each move revalidates `adoption` +
   `adoption:<slug>` (fake). Publish with no processed photo → `publish_blocked` with `no_photo`. *Seam 1*
7. **Authorization, every use case.** Manage: the owning listing's representative ✓; another listing's representative,
   a member, a visitor and staff admin ✗ (nothing written). Owner reads: same. Public reads and the photo read: visitor ✓. *Seam 1*
8. **Suspension hides.** After 127's `suspendListing`, its animals leave browse, their pages 404 and photos are
   `not_found`; `reinstateListing` brings them back with no adoption row changed. *Seam 1*
9. **Edits.** Update works in draft, published and on hold; adopted or withdrawn → `listing_closed`; the slug never
   changes; >8 photos → `too_many_photos`; a photo file not owned by the caller, of another purpose, or not clean →
   `file_not_usable`; alt text required (≤150). *Seam 1 + Vitest (done)*
10. **Seed.** `h.seed.preview()` twice leaves the same rows: ≥6 published animals over 3 species and 3 cities on seeded
    verified listings, one draft, one on hold, one adopted, one on a suspended listing (hidden). *Seam 1*
11. **Pages.** The five pages are axe-clean light and dark with no horizontal scroll at 320 px; unknown or hidden slug →
    404; Lighthouse mobile ≥ 90 on `/adopt` and one animal page. *Seam 2 written, Not run; Lighthouse Not run (HR-28)*
12. **Routes and build.** `/adopt` registered and out of the unbuilt list; `routes.test.ts` green; build keeps `/adopt` ◐
    and `/adopt/[slug]` ISR, no ƒ public page. *Vitest + build gate*

## Files and hotspots
- New: `src/server/db/schema/adoption.ts` (+1 barrel line, H1); `drizzle/NNNN_129_adoption_listings.sql` (H2);
  `src/server/modules/adoption/{index,policy,create,update,photos,transition,lifecycle,public-read,photo-read,owner-read}.ts`
  + tests; `src/server/seed/adoption.ts` (+ `seeders` line after 127's, H6); `src/app/adopt/{layout,page}.tsx`,
  `src/app/adopt/[slug]/page.tsx`, `_components/*`, `_lib/view.ts` (+test); `src/app/media/adoption/[photoId]/[kind]/route.ts`;
  `src/app/dashboard/organisation/adoptions/**` (path per 127's tree, H19 link); `messages/en-IN/adoption.json` (+
  `src/i18n/messages.ts`, H3); `tests/e2e/129-adoption.spec.ts`.
- Append-only: `composeUseCases` (`adoptionUseCases`); #59 policy (H8: `adoption.listing.manage`, `adoption.listing.read_public`);
  63a `FILE_PURPOSES`/`PURPOSE_RULES` + 85a derivative registry (H21: `display_800`, purpose `adoption_photo`);
  outbox event union (H9); 114 inventory/non-personal lists (H5); `src/lib/routes.ts` + test, `nav.json`, `sitemap.ts` (H4).
- Not touched: `src/proxy.ts` (X2) unless the 404 spike fails; CSP/`next.config.ts` (X4): photos are same-origin.

## Design (new module: compared with codebase-design vocabulary)
**Photo delivery (the one real choice).** (A) Signed redirect: a stable URL that 302s to a presigned R2 GET of the
derivative. Every image costs an extra hop, signatures change per request (no browser cache), and the R2 origin must
enter `img-src` (X4). (B) Public copies: copy derivatives to the public bucket on publish and serve via 103a's
`PublicAssetUrl`/CDN; retract on hold-out, withdraw and directory suspension, plus CDN purge. Fastest delivery, but it
adds copy, retract, purge and three event consumers, and a missed retraction leaves photos public. (C) **Chosen: a
same-origin streaming route** `GET /media/adoption/[photoId]/[kind]` → `as(PUBLIC_READER).readAdoptionPhoto({photoId,
kind})`, which checks `publicVisibility(listing, directory)` and streams the private derivative through
`ObjectStorage.read`, with `Cache-Control: public, max-age=300` and a CDN cache header (verify the exact header against
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and Vercel's CDN docs at build). The
module is deep: one use case owns visibility, kind whitelisting and "never the original"; it needs no public bucket
(HR-13), CSP change or sync code; retraction is bounded by the 5-minute cache. Cost: a function run per cache miss.
**Text.** Plain text everywhere (`normalisePlainText`, grapheme limits); React escapes it, paragraphs from line breaks.
This removes the need for the sanitiser, so **111a is not a real blocker**; if FOA later wants formatting, use #111's
`cms` profile. **Age.** Store `birth_month`, never an age (#55 "store DOB, never age"); bands come from the clock.
**Suspension.** Public reads join `directory_listing.status = 'verified'` (no status change, no consumer). Cached reads
tag `adoption`, `adoption:<slug>` and `directory:<id>` for every directory listing on the page, so 127's revalidation on
suspend drops them; `cacheLife({ stale: 60, revalidate: 300, expire: 900 })` is the backstop. **Pages** follow 70b:
`/adopt` static shell + streamed list (`connection()` → `'use cache'` read keyed on canonical `filtersToSearchParams`);
`/adopt/[slug]` ISR with a placeholder param. **404:** spike `notFound()` before streaming (103a's slice-4 spike); if
Next 16.4 still answers 200, fall back to 70b's proxy lookup and flag X2 in the PR. **One status writer**
`transitionAdoptionListing(ctx, tx, {listingId, to, by})`: `moveAdoptionListing`, `FOR UPDATE`, timestamps, audit,
outbox, revalidation. #130 calls it with `by: "coordinator"` for `adopted`.

## Interface needs (code against these; adopt the real names on `M7`)
```ts
// 57a: createHarness(), h.as/h.clock/h.seed/h.deps, uuidv7(at), composeUseCases, UseCaseContext = Deps & { actor }
// 59a
authorize(ctx, action: "adoption.listing.manage", resource: { scopes: [{ type: "organisation"; id: string /* directory_listing.id */ }] }): Promise<{ role: Role | null }>; // throws DomainError("forbidden")
authorize(ctx, action: "adoption.listing.read_public"): Promise<{ role: Role | null }>; // anyone, visitor included
recordAudit(tx, ctx, { action: `adoption.${string}`; entity: { type: "adoption_listing"; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
class DomainError extends Error { constructor(readonly code: string, message?: string) }
h.signIn(user): Promise<Actor & { kind: "user" }>; h.seed.grant(user, { role, scope })
// 127
directoryListing: { id: string; slug: string; name: string; type: DirectoryListingType; status: "pending_verification" | "verified" | "rejected" | "suspended" | "withdrawn"; city: string; state: string };
grant on verify: organisation_representative @ { type: "organisation", id: directoryListing.id } // 127 names the scope type
h.seed.directoryListing(i?: { status?: DirectoryListingStatus }): Promise<{ listing: DirectoryListing; representative: User }>;
as(staff).suspendListing({ listingId, reason }); as(staff).reinstateListing({ listingId, reason }); DIRECTORY_TAGS.listing(id): string;
SEED_DIRECTORY: fixed ids of seeded verified (and one suspended) listings and their representatives
// 63a
FILE_PURPOSES += "adoption_photo"; PURPOSE_RULES.adoption_photo = { contentTypes: [jpeg, png, webp, heic], maxBytes: 15 * MiB, environments: "all" };
fileAsset: { id; ownerUserId; purpose; status: "...clean..."; bucket; storageKey }; ObjectStorage.read({ bucket, key }): Promise<ReadableStream<Uint8Array>>
// 85a
DERIVATIVE_KINDS.display_800 = { maxEdge: 800, contentType: "image/webp", quality: 80 }; DERIVATIVES_BY_PURPOSE.adoption_photo = ADOPTION_PHOTO_KINDS;
fileDerivative: { fileAssetId; kind; bucket; storageKey; width; height; contentType }; fileProcessing: { fileAssetId; status: "queued" | "done" | "failed" }
// 61a
emit(tx, { type: "adoption.listing_published" | "adoption.listing_closed"; aggregateType: "adoption_listing"; aggregateId: string; payload: { listingId: string; directoryListingId: string; slug: string } }): Promise<void>;
// 99b / 70b: revalidatePublicTags(ctx, tags: readonly string[]); PUBLIC_READER: Actor; Lighthouse runner; expectRendersAccessibly
// 114: INVENTORY / NON_PERSONAL entries for every new column (created_by_user_id is PD; the coverage test decides)
```

## Residue
HR-61 (counsel reviews the disclaimer; ships the body's sentence as copy), HR-06 (non-prod bucket: preview photos 404
until it exists; alt text still renders), HR-10/M7 (rebuild worker-preview so the media job knows `adoption_photo`),
HR-31 (retention of listings and photos, "confirm with counsel"), HR-28 (Lighthouse ×3 on a phone, real devices),
HR-01 (Seam 2 on previews).

## Test plan
Vitest: `domain/*.test.ts` (done); `src/app/adopt/_lib/view.test.ts` (card/detail view models, srcset, disclaimer tree).
Seam 1 via `createHarness()` with 127's directory seed, the storage fake and seeded `file_derivative`/`file_processing`
rows (no media run needed): one file per slice, an authz table per use case, the original-key test collecting every
seeded `storage_key`. Seam 2 `tests/e2e/129-adoption.spec.ts`: filters on `/adopt`, an animal page, the dashboard
create flow, disclaimer text on each, `expectRendersAccessibly` light + dark: written, **Not run** (no Postgres here).

## Slices
1. Schema, migration, policy, `createAdoptionListing`, `updateAdoptionListing` (AC 1, 7, 9) · `create.test.ts`.
2. Photos + lifecycle: purpose and derivative registration, `addListingPhoto`, `removeListingPhoto`, the writer,
   publish/hold/resume/withdraw, audit, outbox, revalidation (AC 5, 6, 7, 9) · `lifecycle.test.ts`.
3. Public reads: browse with filters and cursor, get, `readAdoptionPhoto`, original-key test, suspension (AC 2, 3, 7, 8)
   · `public-read.test.ts`.
4. Owner reads, pages, photo route, dashboard + actions, ROUTES/nav/sitemap, messages, seed, e2e spec (AC 4, 10, 11, 12)
   · `seed/adoption.test.ts` + `src/app/adopt/_lib/view.test.ts` + `tests/e2e/129-adoption.spec.ts`.
