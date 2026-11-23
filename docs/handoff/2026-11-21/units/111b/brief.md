# Unit 111b: Home sections, about, impact counters and site facts from the CMS (#111, M5)

Branch `ticket/111-home` · worktree `/root/foa-wt/111b` (create at build from `foa/M5` after 111a merges) · size L · risk A
· key **X12** (`src/app/page.tsx`, `_components/home-layout.ts`) · blocker **111a** (Q6: 111a → 111b → 112a; 110a, 112b, 116a
rebase on 111b) · sibling **111a** owns the CMS core, the sanitiser, Draft Mode and the four legal pages.
**No head start code:** the stand-alone parts are thin (impact counters reuse `impactSchema`, home reuses `HomeLayout`); they're
built with their slices against 111a's kind interface.

## Scope
- **In (111b):** CMS kinds `home`, `page` (about), `impact`, `facts` (body schema, sanitise, seed body, editor each);
  `/`, `/about`, `/impact` read the published documents through 111a's cached loader, with the same layout and the seed body
  as the no-DB build fallback; home counters and the `/impact` counters from the `impact` document; `getOrgFacts()` (cached,
  tag `org-facts`) merging #62 settings (legal name, registration type and number, PAN) with the `site_facts` document
  (email, phone, address, socials, grievance officer name and email); every `SITE.org` reader moves to it; the runtime facts
  readiness check; `home`, `about`, `impact` messages shrink to UI chrome; seed.
- **Out:** CMS core, revisions, sanitiser, preview, legal pages and their version label (111a). Funds raised: computed by
  110a, never typed in (F9); whichever of 110a/111b merges second wires it into `/impact` and the home counters. Competition
  fees (`SITE.org.fees`) stay code placeholders until the competition module owns them (#72, HR-34). Home stories (112b).

## Acceptance checks (seam)
1. **Home edit** (S1). A content manager publishes `home` with `seasonal` hidden and a new hero heading:
   `getPublishedDocument({ key: "home" })` returns it, and `visibleSections(body)` leaves out `seasonal` (and `events`, hidden
   until #125).
2. **Home validation** (S1). `saveDraft` refuses with `invalid_body` (issues listed, no row): an unknown or repeated section
   key, a missing one, counter keys that aren't 4 distinct `COUNTER_KEYS`, a CTA href outside `ROUTES`, an image id outside
   `SiteImageId`. Hero and CTA text pass `sanitizePlainText` (markup stripped).
3. **Impact counters** (S1). Publishing `impact` with new values and `asOf` returns them; `fundsRaised`/`funds` as a key, a
   negative or non-integer value, or a bad date is refused `invalid_body`. Small counts stay suppressed by `visibleCounters`.
4. **About** (S1). Publishing `about` with a changed section returns it; its paragraphs go through 111a's `sanitizeBlocks`.
5. **Org facts** (S1). After publishing `site_facts` and setting #62's `org.legalName`, `getOrgFacts()` returns both merged;
   an empty field is a `placeholder(key)` as today; publishing `site_facts` returns tags including `org-facts`.
6. **Readiness** (unit + S1). `missingOrgFacts(facts)` lists missing keys with today's `PlaceholderKey` names. In production,
   `/api/health` adds `facts: "incomplete"` (no key names, it's public) and the admin shell shows staff the missing keys.
   `assertNoPlaceholdersInProduction` stays in `next.config.ts` for facts still in code (fees); DB facts are checked at runtime.
7. **Static pages** (build). `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build`: `/`, `/about`, `/impact`
   stay ○ or ◐, their HTML holds the seed text, initial JS within 170 kB; the hero heading stays the LCP element.
8. **Authorization** (S1). The kinds ride 111a's `cms.*` actions (content manager only, staff gate); `getOrgFacts` and the
   published reads are public; the readiness detail is staff-only (`staff_admin`, `super_admin`, `content_manager`).
9. **Seed** (S1). `seedPreview` twice: `home`, `about`, `impact` v1 published from today's messages, `HOME_LAYOUT` and the sample
   impact; `site_facts` v1 with every field empty (placeholders on previews, as today).
10. **Seam 2, written, Not run:** extend `tests/e2e/111-cms.spec.ts`: `expectRendersAccessibly` light + dark on
    `/admin/cms/home`, `/admin/cms/about`, `/admin/cms/impact`, `/admin/cms/site_facts`; publish a hero change → `/` shows it.
    `/`, `/about`, `/impact` stay in the smoke set. Lighthouse ≥ 90 mobile: residue (F23).

## Design (risk-flagged; codebase-design vocabulary)
- **About body.** (i) **Chosen:** structured fields that mirror the designed page (hero, duty, vision/mission, skill, ashoka,
  how steps, people, objectives, transparency, name line): text fields, item lists, and 111a's blocks only for paragraphs.
  Photos, quote figures, tiles and layout stay in code, so the page keeps its look and Lighthouse score. (ii) Free blocks
  (headings, paragraphs, images): flexible, but loses the designed layout and lets one edit break LCP. Rejected for now.
- **Home body.** `HomeLayout` with text in place of message keys: `hero { heading, subheading, eyebrow, imageAssetId, alt?,
  primaryCta { label, href }, secondaryCta? }`, `counterKeys` (4), `sections` (all 11 keys, each once, `visible`).
  CTA hrefs are picked from `ROUTES` paths (a select, not free text); `visibleSections()`, `openAnnouncement()` and
  `activeAnnouncement()` stay as they are. `HOME_LAYOUT` becomes the seed body.
- **Facts (tournament P+B2).** (i) **Default:** tax and behaviour facts in #62 settings (super admin + step-up), display facts
  in the `site_facts` document (content manager), merged by one cached `getOrgFacts()` (F10). (ii) All facts in the CMS with
  tax facts mirrored from settings: one editor, but two copies of the tax facts. `getOrgFacts()` returns the same `OrgFact`
  shape as `SITE.org`, so `<Placeholder>`, `ContactFact` and `LegalDocument`'s `FACT_VALUE` keep working with one import change.
- **Rendering:** whatever 111a's tournament picked (default: cached read in the static shell with the seed fallback).
  `getOrgFacts()` is cached the same way and read by the root layout's JSON-LD and the footer.
- **Placeholder guard (deviation note).** F10 moves the build guard to runtime because the facts move to the DB. §1.11 says
  placeholders keep the production build failing, so the default keeps the build guard for code facts and **adds** the
  runtime check for DB facts, rather than removing anything. State this in the PR.

## Interface needs (code against; adapt names, not shapes)
```ts
// 111a (see its brief)
type CmsKind<Body> = { parse(v: unknown): { ok: true; body: Body } | { ok: false; issues: string[] }; sanitize(v: unknown): Body; seedBody(): Body };
saveDraft(i: { key: CmsDocumentKey; body: unknown }): Promise<{ revisionId: string }>;   // refuses invalid_body { issues }
publishRevision(i: { revisionId: string }): Promise<{ version: number; tags: string[] }>;
getPublishedDocument(i: { key }): Promise<{ key; version: number; publishedAt: Date; body: unknown } | null>;
loadPublishedDocument(key): Promise<...>;  // cached page loader, tag cmsTag(key)
sanitizeBlocks(v: unknown, "cms"): LegalBlock[]; sanitizePlainText(v: unknown): string; tagsToRefresh, ORG_FACTS_TAG
// 62 settings: readSetting(db: AppDb, key: SettingKey): Promise<unknown>; registry entries 111b appends (H7):
//   "org.legalName" | "org.registrationType" | "org.registrationNumber" | "org.pan" (string, empty default, super admin + step-up)
// existing: impactSchema, COUNTER_KEYS, visibleCounters (src/content/sample); HomeLayout, visibleSections; placeholder(), findPlaceholders()
```
**111b provides:** `getOrgFacts(): Promise<OrgFacts>` (shape of `SITE.org` minus fees), `missingOrgFacts(f): PlaceholderKey[]`.

## Files
- **New:** `src/server/modules/cms/kinds/{home,page,impact,facts}.ts` + tests; `src/server/modules/cms/org-facts.ts` + test;
  editor components under `src/app/(staff)/admin/cms/[key]/_components/` (one per kind); seed bodies in
  `src/server/seed/cms-pages.ts`.
- **Touched:** `src/app/page.tsx`, `_components/home-layout.ts` + test (**X12**); `about/page.tsx`, `impact/page.tsx`;
  `SITE.org` readers: `contact`, `donate`, `pricing`, `refunds`, `schools`, `styleguide` pages, `blog/_components/fact-checks.tsx`,
  `(legal)/_components/legal-document.tsx`, `src/lib/seo.ts`, `src/lib/site.ts` + test; `src/app/api/health/route.ts` + test;
  the root layout's org JSON-LD and the footer if they read facts; `messages/en-IN/{home,about,impact}.json` (shrink),
  `adminCms.json` (append); `kinds/index.ts`, the settings registry, seed barrel (one line each).
- **Hotspot flags for the orchestrator:** `src/app/layout.tsx` is X3 (65, 66a, 118) and the footer is in §1.10's chrome group;
  if either must change, hold X3 or merge after those units. `next.config.ts` (X4) stays untouched under the default above.
  H39 owner (111b first, then 110a, 112b, 116a). `legal-document.tsx` order: 64 → 111a → 111b.

## Residue
- **HR-21:** FOA's facts (email, phone, address, socials, grievance contact) entered in the CMS by FOA staff; tax facts by a
  super admin in settings. Production shows `facts: "incomplete"` until then.
- **HR-51:** which home sections are visible, counter values and as-of date, about copy edits.
- **HR-50:** the CMS seed copy (today's site text) signed off. **HR-28** + F23: Lighthouse ≥ 90 on `/`, `/about`, `/impact`.
- **HR-01:** Seam 2 waits for the preview secrets.

## Test plan
- Unit: each kind's `parse`/`sanitize` (valid seed body round-trips; the refusals in AC 2–3); `missingOrgFacts`; health route.
- Seam 1 on `createHarness()` with a seeded content manager (verified factor) and super admin for settings.
- Build: route table and JS budget against M5's tip; HTML of `/` contains the seeded hero heading. Seam 2: written, Not run.

## Slices (L → 5; each one behaviour, one test file)
1. **Home from the CMS.** `kinds/home.ts`, seed body from `HOME_LAYOUT` + `home.json`, `/` rewired, editor.
   `src/server/modules/cms/home.test.ts` (AC 1, 2, 9 for home).
2. **Impact counters.** `kinds/impact.ts`, `/impact` and the home counters read it, editor. `src/server/modules/cms/impact.test.ts` (AC 3).
3. **About.** `kinds/page.ts`, `/about` rewired, editor. `src/server/modules/cms/about.test.ts` (AC 4).
4. **Org facts and readiness.** `kinds/facts.ts`, settings keys, `getOrgFacts`, every `SITE.org` reader, health + admin banner.
   `src/server/modules/cms/org-facts.test.ts` (AC 5, 6, 8).
5. **Screens and checks.** The remaining editor polish, the e2e additions, the build gate. `tests/e2e/111-cms.spec.ts` (AC 7, 10).
