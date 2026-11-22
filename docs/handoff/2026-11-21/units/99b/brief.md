# 99b: public results page with consented credits (#99, M4)

Branch `ticket/99-page` · worktree `/root/foa-wt/99b` · base `foa/M0` 442dd99 (rebase onto `foa/M4` after 99a merges) · M · risk
(minors' public credits, embargo leak, CSP, caching) · no conflict key (but see X2 below) · blocked by 70b, 99a (and through 99a:
82, 83a, 83b).
Prepped by foa-p99 on 2026-11-21. **Head start on the branch:** `f868b7d M4 #99: Add public results view domain core`: `src/server/modules/results/domain/public-results.ts` (pure, 14 Vitest cases).

## Scope
- **In (99b):** use case `getPublicResults({ slug })` (visitor-allowed) returning the page's whole view; the pure view
  (`publicResultsView`: discipline → age group → placed / special mentions / finalists, credits fail-closed) and cache lifetime
  (`resultsCacheLife`); `RESULTS_TAGS`; route `/competitions/[slug]/results` (static shell + one streamed, cache-tagged section);
  "Results" link on the competition detail page once published (H25); namespace `results`; `tests/e2e/99-results-public.spec.ts`;
  the page in 103d's crawl list.
- **Out → 99a:** the release, approval, publish job, events, prize messages, admin pages. **Out → #82/83b:** the credit resolver,
  `canUse`, the institution-declaration rule (99b only calls them; if #82 left the resolver private, 99b moves it into the Consent
  module as a shared export, M34-7, and 100b/103a import it from there). **Out → 103a:** artwork images (the page shows no images).

## Acceptance criteria (testable)
1. **Consented credits only** (S1, ticket AC 4). Published release; `as(visitor).getPublicResults({slug})`: adult with
   public_display → name per resolver; minor default → "Asha K."; school only with display_school; city only with display_city; no
   public_display → `{kind:"withheld"}` with the award and entry code still shown. A line the resolver returns nothing for is
   withheld (fail closed).
2. **No personal data beyond the credit** (S1). `JSON.stringify(result)` contains no DOB, age, guardian data, participant profile id,
   registration number, email, phone or asset key (assert on seeded values).
3. **Embargo** (S1). Approved, not published: result is `{state:"scheduled", publishAt}` with no lines; draft or pending: `{state:
   "none"}`. Seam 2: before publish, the page HTML and its RSC payload contain none of the seeded winners' names or entry codes.
4. **Withdrawal applies on the next render** (S1). Guardian withdraws public_display → drain → `getPublicResults` shows withheld.
   Credits are computed at read time, never stored. Page freshness: the cached section lives ≤ 60 s (`resultsCacheLife`).
5. **Grouping** (unit, done). Disciplines in the competition's order, age groups in the competition's order, placed lines by
   position, then special mentions, then finalists; unknown groups kept at the end, never dropped.
6. **Authorization** (S1). `getPublicResults`: visitor ✓, member ✓ (public data); it never returns an unpublished release's lines
   to any actor, staff included (staff preview lives on 99a's admin page).
7. **Page** (S2, Not run). `/competitions/<seeded-slug>/results`: one h1, per discipline → category sections, award as icon + word
   (not colour), "Name withheld" text; before publish "Results will be announced on 1 March 2027 at 10:00 am IST"; unknown slug →
   404. `expectRendersAccessibly` light + dark; no horizontal scroll at 320–412 px; 0 CSP violations (#65 listener).
8. **Build** (gate). `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build` passes with the route ◐ (static shell); JS ≤ 170,000 B gz.
9. **Lighthouse mobile ≥ 90** (perf + a11y) on the results page: evidence, **Not run** here → HR-28.
10. **Competition page link** (S2). The detail page shows "See the results" only when a published release exists.

## Interface needs (code against these; rename to what landed)
```ts
// 99a
publishedRelease(db: AppDb, competitionId: string): Promise<{ id: string; version: number; publishedAt: Date;
  lines: Array<{ entryId; entryCode; participantProfileId; discipline; ageGroup; outcome; awardPosition; awardBand }> } | null>;
scheduledRelease(db: AppDb, competitionId: string): Promise<{ publishAt: Date } | null>;
// 70b / 70a
getPublishedCompetition({ slug }) -> PublicCompetition | null   // id, name, disciplines[], ageGroups[{ label, minAge, maxAge }]
PUBLIC_READER: Actor;  COMPETITION_TAGS;  getPublishedCached(slug)   // 70b's 'use cache' read for the static shell
isListedCompetitionSlug(slug, lookup)                                 // 70b proxy helper
// #82 (+83b's institution rule inside canUse)
type PublicCredit = { kind: "withheld" } | { kind: "credited"; name: string; school: string | null; city: string | null };
resolvePublicCredits(db: AppDb, i: { competitionId: string; participantProfileIds: string[] }): Promise<Map<string, PublicCredit>>;
//   batch read, no N+1; if only a single-subject resolver exists, 99b adds the batch wrapper in the Consent module
// #72: award band labels come from 72's message keys (first/second/third, gold/silver/bronze, grade_a/grade_b)
// #65: public CSP allows request-time streamed flight scripts (70b verified); tests/e2e/support/csp.ts
```

## Files
- **Head start (done):** `src/server/modules/results/domain/public-results.ts` + test (structural `PublicResultLine`; switch to
  `Pick<SnapshotLine, …>` from 99a's `snapshot.ts` at build).
- **New:** `src/server/modules/results/public-results.ts` (use case + `RESULTS_TAGS`) + Seam 1 test;
  `src/app/competitions/[slug]/results/{page.tsx,_components/*,_lib/*}`; `messages/en-IN/results.json`;
  `tests/e2e/99-results-public.spec.ts`.
- **Shared:** `src/app/competitions/[slug]/page.tsx` (H25, 70b's file: one link block inside its Suspense hole), `src/i18n/messages.ts`,
  `src/lib/routes.ts` + test, `sitemap.ts` (published results pages only), 103d's crawl list if it exists.
- **X2 note:** `src/proxy.ts` matches `/competitions/:slug` only. A real 404 for `/competitions/<unknown>/results` needs the matcher to
  add `/competitions/:slug/results` (one line). Ask the orchestrator for X2; fallback: page-level `notFound()` (status 200 while
  streaming, trap 6) plus `robots: { index: false }` for that state, recorded in the PR.

## Design (codebase-design; risk-flagged, 3 compared)
- **A. Fully prerendered `'use cache'` page revalidated by the worker.** The worker can't call `revalidateTag` (#71 note), so it would
  need an internal revalidate route, a secret, and the Vercel bypass on previews. Build has no DB. Rejected.
- **B. Dynamic section, no cache.** Simplest and always fresh, but every visit at results time hits Postgres through PgBouncer. Kept
  as the fallback.
- **C. Static shell + one streamed section with a bounded, tagged cache (chosen).** Shell (header, h1 from 70b's cached competition
  read, intro copy) is prerendered. The section sits in `<Suspense>`: `await connection()` → `'use cache'` loader with
  `cacheTag(RESULTS_TAGS.competition(id))` and `cacheLife(resultsCacheLife(view, now))`. Lifetimes: published ≤ 60 s revalidate /
  300 s expire (withdrawal visible within a minute, well inside HR-30's 15 min); scheduled → revalidate at the publish instant (≤ 60 s);
  none → 60 s. Server Actions that change results (99a's publish-now approval) call `updateTag`. The embargo never depends on the
  cache: the loader reads published releases only, so nothing unpublished is ever in a cache entry or the RSC payload.
- Deep module: one use case returns the whole view; grouping, ordering, fail-closed credits and lifetimes are pure and unit-tested.
  The page only renders. `'use cache'` bodies take `competitionId` as an argument (no headers, trap 8); dates cross the boundary as
  ISO strings. Check at build: Vercel needs `"use cache: remote"` for runtime caching to persist across serverless instances
  (cacheLife docs); pick it if `"use cache"` alone doesn't share entries, and say so in the PR.

## Residue
- **HR-44 + HR-30:** safeguarding and DPDP sign-off on minors' public credits (default first name + last initial, school/city opt-in).
- **HR-28:** Lighthouse mobile ×3 on a phone, iOS 16 devices (Lighthouse ≥ 90 not runnable here).
- **HR-27:** no CSP violations on staging after M4 → main. **HR-01:** Seam 2 on previews.

## Test plan
- Unit (done): `domain/public-results.test.ts` (grouping, order, fail-closed credits, field stripping, cache lifetimes).
- Seam 1: `results/public-results.test.ts` on the harness with 99a's seed builders + #82's consent builders, fake clock, `h.drain()`.
- Seam 2: `tests/e2e/99-results-public.spec.ts` (page, embargo HTML + RSC check, 404, axe light/dark, 320 px, CSP), **Not run**.

## Slices (M → 1)
1. Public results read + page + link: `src/server/modules/results/public-results.test.ts` (AC 1–4, 6) and
   `tests/e2e/99-results-public.spec.ts` (AC 3, 7, 8, 10); Lighthouse evidence or HR-28 (AC 9).
