# Brief 103d: Seam 2 crawl, no public gallery or results URL resolves to an original asset

Unit 103d of #103 · M4 · M · risk (K J) · no X key · branch `ticket/103-crawl` · worktree `/root/foa-wt/103d` · blocked by
103a (and 99b for the results pages, already a 103a blocker). Prepped by foa-p103 on 2026-11-21 against
`foa/ticket/57-harness` 0569f4f (PR #140).

## Scope
**In (103d):** ticket AC 8. `tests/e2e/103-gallery-crawl.spec.ts` plus a pure helper `tests/e2e/support/media-urls.ts`
with Vitest tests (`tests/e2e/**/*.test.ts` is in `vitest.config.ts`). A fixed-id export of the seeded originals if 103a's
seed doesn't already have one (`SEED_GALLERY_ORIGINALS` in `src/server/seed/gallery.ts`, read by Playwright like
`SEED_ACCOUNTS`).
**Out:** 103a owns `PublicAssetUrl`, the fallback route and the Seam 1 original-key test (the in-process twin of this
crawl); 99b owns the results page; 103b/103c own their pages' own axe specs. No product code changes except the seed
export.

## Acceptance checks
1. The crawl visits `/gallery` and every cursor page, every linked `/gallery/<code>`, and every
   `/competitions/<slug>/results` linked from `/competitions` for published results. Each visited page answers < 400. *Seam 2*
2. It collects every media reference: `img[src]`, `img[srcset]`, `source[srcset]`, `meta[property="og:image"]`,
   `meta[name="twitter:image"]`, `a[href]` and inline `style` `url(...)`. Site assets (`/_next/`, the site photo paths
   from `src/lib/images`, `/brand/`) are allow-listed by exact prefix; everything else is classified. *Seam 2 + Vitest*
3. Every non-site media URL classifies as `stamped` (under `PUBLIC_ASSET_BASE_URL` or `/media/p/`, purpose segment
   `stamped_*`); none is `private` (`/api/files/`, signed URLs with `X-Amz-*` params) or `unknown`. At least one stamped
   URL is found (an empty crawl fails). *Seam 2 + Vitest*
4. For every seeded original (fixed ids, purpose `entry_image` and private derivatives), the key built from the crawl's
   storage prefix (taken from the stamped URLs) answers 4xx on the public base and on `/media/p/`; `/api/files/<id>`
   without a session is not a 200 image. *Seam 2 + Vitest for the key builder*
5. `media-urls.test.ts` covers srcset parsing (width and density descriptors, extra spaces, data URIs ignored), the
   classification table and prefix derivation (`pr-12/`, `br-<hash8>/`, `staging/`, `""`). *Vitest*
6. No retries, skips or axe narrowing; runs on both Playwright projects; needs no `e2e.yml` change. *Review*

## Files and hotspots
- New: `tests/e2e/103-gallery-crawl.spec.ts`, `tests/e2e/support/media-urls.ts` + `media-urls.test.ts` (new files in
  the shared support folder: append-only, no edit to existing helpers).
- Possibly one export in 103a's `src/server/seed/gallery.ts` (serial after 103a).

## Design (risk-flagged; no tournament)
- **A. Independent classifier in the test support (chosen).** The crawl does not import `PublicAssetUrl`: a check that
  reuses the code under test would pass when both are wrong. It encodes the key layout from #63
  (`<prefix><purpose>/<uuidv7>`) and the base rule from M34-8 on its own.
- **B. Scrape the sitemap only:** item pages of minors are never in the sitemap (103a), so it would miss them. Rejected.
- **Previews without R2 (HR-06):** stamped objects 404 there, so the crawl asserts URL shape and the negatives (originals
  4xx), not that stamped images load. Image loading is covered once HR-06 exists, by 103a's axe/Lighthouse runs.
- Prefix: read from the first stamped URL; all must share it (a mixed prefix fails the crawl).

## Interface needs
```ts
// 103a: public pages + fallback route; seed constants
export const SEED_GALLERY_ORIGINALS: readonly { fileId: string; purpose: "entry_image" | string }[];
// 63a key layout: storageKeyFor(prefix, purpose, id) === `${prefix}${purpose}/${id}`
// 99b: /competitions/[slug]/results linked from /competitions when published
// env at test time: PLAYWRIGHT_BASE_URL; PUBLIC_ASSET_BASE_URL read from the page's own URLs (not from env)
```

## Residue
HR-01 (preview Seam 2 needs the owner's Vercel secrets), HR-06 (non-prod R2, for stamped images to load on previews).

## Test plan
Vitest for the helper (pure). Seam 2 spec written and listed under "Not run" (no Postgres here; preview E2E deferred).
Local run recipe: build, `PORT=3100 pnpm start`, seeded Postgres, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 pnpm exec
playwright test tests/e2e/103-gallery-crawl.spec.ts`.

## Slices
1. Helper + tests, crawl spec, seed export if missing (AC 1–6) · `tests/e2e/support/media-urls.test.ts` +
   `tests/e2e/103-gallery-crawl.spec.ts`.
