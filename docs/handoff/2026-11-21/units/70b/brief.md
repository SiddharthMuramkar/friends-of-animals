# Brief 70b: Public competition pages read published competitions from the DB (#70, M1)

Branch `ticket/70-public-pages`, worktree `/root/foa-wt/70b`, base `foa/M1`. Size M, risk (CSP, infra: build must stay DB-free). Keys X2 (`src/proxy.ts`), X4 (held in case the CSP needs a tweak; expect no edit to `next.config.ts`/`security-headers.ts`). Blocked by #65 (CSP) and 70a. Tournament flagged in issues-M1.md (angles below); this brief names the default.

## Scope
- **In (70b):** `/competitions` and `/competitions/[slug]` render 70a's `PublicCompetition` read model; the proxy's slug check reads published slugs from the DB; showcase `CompetitionCard`/`StatusChip` take a view model both sources can fill; the home "live and upcoming" section moves to the DB too (X12 is #70's; otherwise its sample links 404 once the proxy checks the DB, e.g. on staging); a shared public detail body that 70a's `/admin/competitions/[id]/preview` then renders; `competitions.json` messages; smoke spec update; Lighthouse evidence when a run is possible.
- **Out → 70a:** schema, use cases, read model, cache tags, admin pages, seed. **Out → later:** status chips beyond `published` (#71), fees/prizes on the page (#72; show the existing "announced soon" copy, never invent amounts), `/styleguide` and `/impact` keep samples.

## Acceptance criteria (testable)
1. `/competitions` lists the seeded published competitions from the DB and never the draft; no file under `src/app/competitions/**` imports `@/content/sample` (Vitest source scan in `_lib/view.test.ts`). — Seam 2 + unit
2. `/competitions/<seeded-slug>` shows name, theme, welfare message, disciplines, age groups, age cut-off, rules, materials, duration, scope flags and key dates in IST (`15 January 2027 at 10:00 am IST` via `longDateTime`). — Seam 2
3. Unknown slug and the draft's slug → HTTP 404 (proxy). Unit: `isListedCompetitionSlug(slug, lookup)` with an injected lookup, including malformed escapes. — unit + Seam 2
4. A publish or edit shows on the public pages without a deploy (70a's actions `updateTag` the list and slug tags). — Seam 2 journey step after 70a's publish
5. Build stays DB-free and public: `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build` passes; `/competitions` and `/competitions/[slug]` are ○ or ◐ (not ƒ); initial JS ≤ 170,000 B gz. — gate
6. CSP: public pages keep #65's no-nonce policy; 0 `securitypolicyviolation` events on both pages (#65's listener). — Seam 2
7. axe: `expectRendersAccessibly` on `/competitions` and one detail page, light and dark; no horizontal scroll at 320–412 px. — Seam 2 (`tests/e2e/70-competitions-public.spec.ts`)
8. Lighthouse mobile ≥ 90 performance and accessibility on `/competitions` and one detail page. — evidence; Not run here (no Postgres, no reachable preview) → HR-28
9. Admin preview renders the same detail body as the public page. — Seam 2 (70a's spec gains one assertion)

## Files
- `src/app/competitions/page.tsx`, `[slug]/page.tsx`, `_lib/view.ts` (+ test), `_components/filters.tsx`; new `src/app/competitions/_lib/public-reads.ts` (cached reads), new `src/components/competitions/competition-detail.tsx` (shared detail body).
- `src/proxy.ts` (X2): replace the build-time `COMPETITION_SLUGS` set with a DB check; keep the blog check and the matcher.
- `src/components/showcase/{competition-card,status-chip}.tsx`, `src/app/page.tsx`, `src/app/_components/home-layout.ts` (X12, #70 owns).
- `messages/en-IN/competitions.json` (append keys; shared hotspot), `tests/e2e/smoke.spec.ts` (slug comes from the seed), new `tests/e2e/70-competitions-public.spec.ts`.
- `src/app/(staff)/admin/competitions/[id]/preview/page.tsx` (70a's file, after 70a merged).

## Design (3 angles compared; tournament may override)
- A. **Fully cached prerender** (`'use cache'` reads at build + `cacheTag`, revalidate on publish). Needs a DB at build: breaks gate 2 (empty `DATABASE_URL`) and trap 15 (`env()` during prerender). A build-phase guard that returns `[]` would cache an empty list until the next publish. Rejected.
- B. **Static shell + dynamic hole everywhere:** content inside `<Suspense>` after `await connection()`, then a tagged cached read. Build-safe and simple, but every detail visit renders on demand.
- C. **Hybrid (chosen):** list = B (the hero, prompts and doors stay in the static shell; the list section streams: `connection()` → `listPublishedCached()`). Detail = ISR per the Next 16.4 guide (`02-guides/incremental-static-regeneration-cache-components.md`): `generateStaticParams` returns the placeholder only (`competitionParams([])`), `params` awaited inside `<Suspense>`, and `getPublishedCached(slug)` is `'use cache'` + `cacheTag(COMPETITION_TAGS.list, COMPETITION_TAGS.slug(slug))` + `cacheLife("hours")`. It returns `null` for the placeholder **without touching the DB**, so the build needs none. Unlisted slugs get the App Shell first and a cached, upgraded page after the first visit.
- Cached reads call `as(PUBLIC_READER).getPublishedCompetition({slug})`, where `PUBLIC_READER` is a constant visitor actor with fixed meta (cache bodies can't read headers, trap 8; no visitor data is logged). The policy lets visitors `competition.read_published`.
- Proxy: `isListedCompetitionSlug(slug, lookup)` (pure, in `_lib/view.ts`) + a module-level lookup in `src/proxy.ts` that calls `as(PUBLIC_READER).publishedCompetitionSlugs()` and memoises it for 60 s per instance (Node runtime proxy). A draft or unknown slug is rewritten to `/__not-found` before streaming, so it stays a real 404 (trap 6). A slug published < 60 s ago may 404 on another instance for up to a minute; recorded in the PR. Contender: an exact-slug query per request with no memo.
- DB enum values are lowercase (`drawing`); `fromPublic` maps them to the existing upper-case UI tokens and message keys (`DRAWING`), so filters and `competitions.json` keys stay as they are.
- Cards: `CompetitionCardModel` (name, slug, theme, disciplines, age range, next key date, participation, status label, `sample: boolean`, cover image id). `fromSample(c)` and `fromPublic(c)` fill it, so the home page and `/styleguide` keep working. DB competitions have no cover image yet: default to a fixed credited site image per discipline (no new images).
- Interaction with #65: dynamic holes stream inline flight scripts at request time. That rules out a public CSP built only from build-time per-page hashes. Public pages already stream (header Suspense, `cachedNow`), so #65 must already allow this. Verify against #65's merged `src/lib/csp.ts` before building. If it doesn't allow it, stop and report `BLOCKED` rather than loosen the CSP.

## Interface needs (from 70a and #65)
```ts
// 70a: src/server/modules/competitions
type KeyDateKind = "registration_opens" | "registration_closes" | "submissions_close" | "school_round_closes";
type PublicCompetition = {
  id: string; code: string; slug: string; name: string; theme: string; welfareMessage: string;
  status: "published"; // #71 widens
  participation: "individuals" | "institutions" | "both";
  disciplines: Discipline[]; ageGroups: { label: string; minAge: number; maxAge: number }[];
  categories: { discipline: Discipline; ageGroupLabel: string }[];
  ageCutoffDate: string; // YYYY-MM-DD
  rules: string; permittedMaterials: string; duration: string;
  digitalScope: "all_participants" | "shortlist_only"; shortlistPerCategory: number; schoolPositions: number;
  physicalArtwork: { kind: "not_required" } | { kind: "all_shortlisted" } | { kind: "top_n"; count: number };
  publicDisplay: boolean; auctionPermitted: boolean;
  keyDates: { kind: KeyDateKind; at: Date }[]; // ascending
  publishedAt: Date;
};
as(a).listPublishedCompetitions(): Promise<PublicCompetition[]>;
as(a).getPublishedCompetition(i: { slug: string }): Promise<PublicCompetition | null>;
as(a).publishedCompetitionSlugs(): Promise<string[]>;
const COMPETITION_TAGS: { list: "competitions"; slug(s: string): string };
// Dates cross the 'use cache' boundary serialised. Rehydrate them or carry ISO strings in the cached shape.
// #65: src/lib/csp.ts public policy permits request-time streamed flight scripts; tests/e2e/support/csp.ts violation listener.
```

## Residue
- HR-28: Lighthouse ×3 on a phone, iOS 16 devices. Lighthouse mobile ≥ 90 locally needs `pnpm start` plus a seeded Postgres: Not run here.
- HR-27: no CSP violations on staging after M1 → main.
- HR-01 / DB down: Seam 2 specs written, Not run.

## Test plan
- Unit: `_lib/view.test.ts` covers `isListedCompetitionSlug`, `fromPublic`/`fromSample`, filter tokens and the timeline on the new model, IST rendering helpers and the no-sample-import scan.
- Gate: build table shows ○/◐ for both routes, `check:build` budget.
- Seam 2 (Not run): `70-competitions-public.spec.ts` (list, detail, 404 for draft and unknown slug, axe light/dark, 320 px scroll, CSP listener); smoke spec reads a seeded slug.

## Slices
1. Public pages, home section and proxy read the DB read model through cached reads, with the shared detail body adopted by the admin preview. Test: `src/app/competitions/_lib/view.test.ts` (ACs 1, 3, 5) plus `tests/e2e/70-competitions-public.spec.ts` (2, 4, 6, 7, 9).
