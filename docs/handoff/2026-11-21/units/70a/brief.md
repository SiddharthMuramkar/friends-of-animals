# Brief 70a: Competitions module, admin create/edit/preview/publish (#70, M1)

Branch `ticket/70-module-admin`, worktree `/root/foa-wt/70a`, base `foa/M1` (head start cut from `foa/M0`). Size L, risk (auth/staff screens). Key X9 (competitions schema + use cases + admin pages; serial #70a → #71 → #72). Blocked by #60 (and #59a, #57a/b through it).

## Scope
- **In (70a):** `competitions` schema + one generated migration; the module `src/server/modules/competitions/` with use cases `createCompetition`, `updateCompetition`, `getCompetitionForEdit`, `listCompetitionsForAdmin`, `previewCompetition`, `publishCompetition`, plus the public read model `listPublishedCompetitions`, `getPublishedCompetition`, `publishedCompetitionSlugs` (70b renders them); audit rows; `can()` rules; preview seed; admin pages `/admin/competitions`, `/new`, `/[id]/edit`, `/[id]/preview` with server actions that call `updateTag(COMPETITION_TAGS.list)` / `.slug(slug)` after a write.
- **Out → 70b:** rewriting `/competitions`, `/competitions/[slug]`, the home "live and upcoming" section, `src/proxy.ts`, showcase cards, Lighthouse; swapping the admin preview body for the shared public detail component.
- **Out → later:** automatic status (#71 extends `competition_status`, schedules on `competition_key_date`), fees/award schemes/consent docs (#72), cancel (#80), edit locks after registration opens (#71/#75).

## Acceptance criteria (testable)
1. Manager creates a draft: `as(cm).createCompetition(input)` → `{ id, slug, status: "draft" }`; `getCompetitionForEdit({id})` returns every field back. — Seam 1
2. Manager edits: `updateCompetition({ id, ...patch })` changes scalar fields and replaces the repeating groups (age groups, categories, key dates) wholesale. — Seam 1
3. Preview: `previewCompetition({id})` returns the `PublicCompetition` shape for a draft (what the public page will render). — Seam 1 (+ Seam 2 page)
4. Publish: `publishCompetition({id})` sets `status=published`, `publishedAt=clock.now()`. Refused with `{ code: "not_ready", problems: PublishProblem[] }` while required fields are missing or dates/age groups are inconsistent; refused `not_draft` when already published. — Seam 1 + unit (`publishProblems`)
5. Drafts never public: as a visitor, `listPublishedCompetitions()`, `getPublishedCompetition({slug})` and `publishedCompetitionSlugs()` exclude drafts and include the competition after publish. — Seam 1
6. Code: format `^[A-Z]{3,6}\d{2}$` after trim+uppercase (`"paws27 "` → `PAWS27`); bad format → `invalid_code`; duplicate (any case) → `code_taken`; a DB unique constraint backs it. — unit + Seam 1
7. IST: key date `"2027-01-15T10:00"` (datetime-local, IST) is stored `2027-01-15T04:30:00.000Z` (row read) and `getCompetitionForEdit` gives back `"2027-01-15T10:00"`; an impossible local time (`2027-02-30T10:00`) → `invalid_date`. — unit + Seam 1
8. Audit: create, update and publish each write exactly one `audit_log` row (`competition.created|updated|published`, `entity_type="competition"`, entity id, `before`/`after` = changed fields only, actor id, IP + UA from `actor.meta`). Refusals write none. — Seam 1
9. Authz per use case (table-driven): global `competition_manager` passes; `competition_manager` scoped to another competition fails edit/preview/publish of this one (and create needs global); `content_manager`, `member`, visitor fail; a staff actor without the second factor fails (#60). No rows written on refusal. Read-model use cases allow visitors. — Seam 1
10. Seed: `seedPreview` adds 3 published (one per participation mode, slugs/codes mirroring the sample set so existing links resolve: `neighbours-on-my-street`/`NEIGH27`, …) and 1 draft; idempotent (twice → same counts, fixed ids). Builder `h.seed.competition({ status?, ... })`. — Seam 1
11. Admin pages render accessibly: `expectRendersAccessibly` on the 4 pages, light and dark; journey: seeded manager creates, edits, previews, publishes, and sees the status change. — Seam 2 (`tests/e2e/70-competitions-admin.spec.ts`, written, Not run)

## Files
- New `src/server/db/schema/competitions.ts` + 1 line in `schema/index.ts` (barrel hotspot); `drizzle/NNNN_70_competitions.sql` + meta (merge queue regenerates).
- New `src/server/modules/competitions/{index.ts, use-cases/*.ts, read-model.ts, cache-tags.ts, errors.ts, domain/*.ts}`; 1 line in `src/server/app.ts` `composeUseCases(...)`.
- #59's policy file: append `competition.*` rules (append-only hotspot).
- New `src/server/seed/competitions.ts` + 1 line in `seeders` + `competition()` builder in `src/server/seed/index.ts` (hotspot).
- New `src/app/(staff)/admin/competitions/**` (`page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx`, `[id]/preview/page.tsx`, `_components/competition-form.tsx` (client leaf island for repeating rows), `actions.ts`); signed-in route registry append (57b's `src/lib/app-routes.ts`).
- New `messages/en-IN/adminCompetitions.json` + 3 lines in `src/i18n/messages.ts` (append hotspot).
- New `tests/e2e/70-competitions-admin.spec.ts`.
- Already on branch (head start, 60bf809): `src/server/modules/competitions/domain/{vocabulary,code,ist,key-dates,age-groups,slug,publish-rules}.ts` + 46 unit tests. Enum values are lowercase snake (`drawing`, `both`, `registration_opens`), as in the harness's `captured_message_channel`; the schema's `pgEnum`s take their values from `vocabulary.ts`/`key-dates.ts`.

## Data model (generated migration, no hand SQL)
`competition_status` enum (`draft`, `published`; #71 adds values in its own migration). `competition_participation` (`individuals`,`institutions`,`both`), `competition_discipline` (7 from #55), `competition_digital_scope` (`all_participants` default, `shortlist_only`), `competition_physical_artwork` (`not_required`, `all_shortlisted` default, `top_n`), `competition_key_date_kind` (`registration_opens`, `registration_closes`, `submissions_close`, `school_round_closes`).
- `competition`: uuid id; `code` text unique; `slug` text unique; name, theme, welfare_message, rules, permitted_materials, duration (text, nullable while draft); participation; disciplines `competition_discipline[]`; age_cutoff_date `date`; digital_scope; shortlist_per_category int default 5; school_positions int default 3; physical_artwork + physical_artwork_top_n int (check: set iff `top_n`, 1..shortlist_per_category); public_display bool default false; auction_permitted bool default false; status; published_at; created_by → user; created_at/updated_at.
- `competition_age_group` (id, competition_id, label, min_age, max_age, position; check min ≤ max); `competition_category` (id, competition_id, discipline, age_group_id, unique triple) — categories = discipline × age group, all crosses on by default, manager can untick; `competition_key_date` (competition_id, kind, `at` timestamptz; PK (competition_id, kind)). #71 schedules from `competition_key_date`.

## Design (codebase-design; 3 options compared)
- A. **One deep module, aggregate-style** (chosen): use cases take/return a whole `CompetitionDraft` (scalars + groups); `updateCompetition` replaces groups in one transaction; pure `domain/` decides validity (`parseCompetitionCode`, `istLocalToInstant`, `publishProblems`); one `toPublicCompetition(row)` mapper feeds both preview and public reads, so preview cannot drift from the public page. Small interface, all rules behind it, tests at Seam 1.
- B. Per-group use cases (`addAgeGroup`, `setKeyDate`, …): many shallow entry points, N audit rows per form save, harder authz table. Rejected.
- C. Draft as one jsonb document, normalised on publish: cheap edits but #71/#75 need relational key dates and categories before publish; two shapes to keep in sync. Rejected.
- Errors: use cases return `{ ok: true, value } | { ok: false, error }` for expected refusals (`invalid_code`, `code_taken`, `invalid_date`, `not_ready`, `not_draft`, `not_found`) and throw #59's forbidden error for authz (match whatever 57b/59a settled; don't invent a second convention).
- Cache tags (contract with 70b): `cache-tags.ts` exports `COMPETITION_TAGS = { list: "competitions", slug: (s) => \`competition:${s}\` }`. Use cases stay framework-free; the server actions call `updateTag`.
- No step-up on publish (#55 story 20 lists results, roles, money, exports, not competitions). Staff 2FA gate applies via #60's (staff) layout + `can()`.

## Interface needs (code against these; adjust names to what landed)
```ts
// #59a policy + audit
type Action = "competition.create" | "competition.edit" | "competition.preview" | "competition.publish" | "competition.read_published";
type Resource = { type: "competition"; id?: string };
function can(actor: Actor, action: Action, resource: Resource): Promise<boolean>;
function requireCan(ctx: UseCaseContext, action: Action, resource: Resource): Promise<void>; // throws ForbiddenError
const AuditLog: { write(tx: AppDb, ctx: UseCaseContext, e: { action: string; entityType: "competition"; entityId: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }): Promise<void> };
// roles: "competition_manager" | "content_manager" | "member" ...; scope { type: "global" } | { type: "competition"; id: string }
// #59a/#60 seed + harness
h.seed.staff(opts: { role: Role; scope?: Scope; secondFactor?: boolean }): Promise<{ user: User; actor: Actor }>;
// #60: Actor user gains `secondFactorVerified: boolean`; can() refuses staff roles without it.
// #57b: src/lib/app-routes.ts registry; (staff) layout at src/app/(staff)/admin/layout.tsx.
```

## Residue
- HR-17: FOA appoints real competition managers (2FA-enrolled) before production use.
- HR-28: real-device pass on the admin form (iOS 16, font scaling).
- HR-01 / no local Postgres: Seam 2 spec written, Not run.

## Test plan
- Unit (head start, done): code parsing, IST conversion both ways + invalid inputs, key-date order, publish problems, slug.
- Seam 1: `src/server/modules/competitions/{create,update,publish,authz,seed}.test.ts` via `createHarness()`; assert returned values, rows via `h.db`, `audit_log` rows; fake clock for `publishedAt`.
- Seam 2: `70-competitions-admin.spec.ts` (journey + `expectRendersAccessibly` ×4, `.dark`), Not run.

## Slices
1. Schema + migration + `createCompetition`/`getCompetitionForEdit` (code, IST, audit, authz) — `create.test.ts` (ACs 1, 6, 7, 8, 9)
2. `updateCompetition` with group replacement + changed-field audit — `update.test.ts` (2, 8, 9)
3. `publishCompetition` + read model + `previewCompetition` — `publish.test.ts` (3, 4, 5, 9)
4. Seed + `h.seed.competition` builder — `seed.test.ts` (10)
5. Admin pages, actions (`updateTag`), messages, e2e spec — `tests/e2e/70-competitions-admin.spec.ts` (11)
