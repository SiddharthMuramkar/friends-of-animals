# 125a: Events and campaigns: publish and public pages (#125, M6, size M, risk: personal data, public pages)

Branch `ticket/125-publish` · worktree `/root/foa-wt/125a` · cut from `foa/M0` 442dd99 · blocked by 111a, 114 (and, through them, 57, 59a/59b, 60, 61a, 62, 70b).
**Head start:** `4f7168e M6 #125: Add events domain core` (pure, 64 tests) under `src/server/modules/events/domain/`: `event-status` (table), `event-details` (zod + cross-field codes + `publishableProblems`), `slug`, `changes`, `registration-window`. Rebase onto `foa/M6` at build time. It touches no shared file.
Prepped by foa-p125 on 2026-11-21 against `foa/ticket/57-harness` 0569f4f (PR #140, may still change).

## Scope
- **In (125a):** the `event` table with the enums `event_kind`, `event_status` and `event_audience`, in migration `125_events`. Use cases `createEvent`, `updateEvent`, `publishEvent`, `cancelEvent`, `completeEvent`, `listEventsForAdmin`, `getEventForAdmin`, `listPublishedEvents` and `getPublicEvent(slug)`. The outbox events `event.published`, `event.changed {changes, startMoved}` and `event.cancelled` (emitted with no consumer yet; 125b and 125c subscribe). Audit rows. Policy actions. Admin pages `/admin/events`, `/admin/events/new` and `/admin/events/[eventId]`. Public pages `/events` and `/events/[slug]`, with a `ROUTES` entry and a nav label. The proxy slug check for `/events/:slug`. The `events` namespace (shared by a, b and c, which run in sequence). The `h.seed.event()` builder and preview seed. Inventory rows.
- **Out, 125b:** `event_registration`, registering, the waitlist, promotion, every notice and reminder, the register button, `/dashboard/events` and `/admin/events/[eventId]/registrations`. It also adds the promotion hook into `updateEvent` when capacity rises (one call).
- **Out, 125c:** check-in, no-shows and the automatic `completed` at `ends_at`, the attendance timeline entry, the check-in page and the M6 Seam 2 journey.
- **Out, later or elsewhere:** the cover image (soft #63), campaign messages (#126), "places left" on public pages (needs 125b's counts; 125b adds it).

## Acceptance criteria (each with its seam)
1. **Draft.** `as(contentManager).createEvent(valid)` returns `{id, slug}` with status `draft`, `created_by` set, and one audit row `event.created`. The draft is absent from `listPublishedEvents` and `getPublicEvent(slug)` returns `not_found`. *S1*
2. **Validation.** Invalid input is refused with `invalid_input` and field problems (`ends_before_start`, `place_required`, `city_required`, `registration_window_empty`, `registration_closes_after_end`, plus zod's own). *Unit (done) + one S1 mapping test.*
3. **Sanitised.** A description containing `<script>`, `<img onerror>` or `<a href="javascript:…">` is stored without them, through 111a's sanitiser, on create and on update. *S1*
4. **Publish.** draft → published sets `published_at` from the clock, writes one outbox row `event.published {eventId}` and an audit row. The event appears in `listPublishedEvents`, which lists ongoing and upcoming events by `starts_at` then id. A start already past is refused with `starts_in_past`. *S1*
5. **Edit and notice.** Editing a published event's time emits `event.changed {changes:["time"], startMoved:true}`. A venue edit emits `["place"]`. A summary-only edit writes no outbox row. Audit `before`/`after` hold the changed fields only. The slug never changes. Moving a published event's start into the past is refused. *S1*
6. **Cancel.** draft → cancelled and published → cancelled. Only a published one emits `event.cancelled`. A cancelled event leaves the list. Its detail page stays reachable and shows "cancelled", so shared links still work. *S1 (`getPublicEvent` returns status) + S2*
7. **Complete.** published → completed only when `now ≥ ends_at`, else `not_ended`. *S1*
8. **Transition table.** Every allowed and forbidden move is covered by the unit tests (done). One S1 test shows a forbidden move through a use case (publish a cancelled event) returns `invalid_transition` and writes nothing.
9. **Authorization, per use case.** content_manager and community_manager are allowed. member, competition_manager and visitor are refused on every admin use case. The two public reads allow a visitor. *S1*
10. **Public pages.** `/events` lists upcoming published events: title, date and time in IST (`longDateTime`), city or "Online", the registration-window state. `/events/<seeded-slug>` shows the detail. An unknown or draft slug returns HTTP 404 through the proxy's DB check. *S2 + unit `isListedEventSlug(slug, lookup)`*
11. **Build stays DB-free.** `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build` passes. `/events` and `/events/[slug]` are ○ or ◐, never ƒ. Initial JS ≤ 170,000 B gz. *Gate*
12. **Seed.** `h.seed.event({...})` builds any status. The preview seed adds one upcoming published event, one campaign and one draft, and running it twice changes nothing. *S1*
13. **Inventory.** Every new column is either inventoried or on the non-personal list, and #114's coverage test passes. *S1*
14. **axe and Lighthouse.** axe is clean on all five pages, light and dark, with `expectRendersAccessibly`. Lighthouse mobile ≥ 90 on `/events` and `/events/[slug]` through 70b's runner. *S2, written but not run here → HR-28*

## Files
- **Done:** `src/server/modules/events/domain/{event-status,event-details,slug,changes,registration-window}.ts` + tests.
- **New:**
  - `src/server/db/schema/events.ts`
  - `drizzle/NNNN_125_events.sql`
  - `src/server/modules/events/{policy,use-cases,public-reads,seed,index}.ts` + `events-admin.test.ts`
  - `src/app/(staff)/admin/events/{page,new/page,[eventId]/page}.tsx` + `_components/event-form.tsx` + `actions.ts` + `_lib/form-to-input.ts` (IST datetime-local → instants; unit-tested)
  - `src/app/events/{page,[slug]/page}.tsx` + `_lib/{public-reads,view}.ts` + `_components/*`
  - `messages/en-IN/events.json`
  - `tests/e2e/125-events-public.spec.ts`
- **Hotspots, one line or entry each:**
  - H1 schema barrel; H2 `drizzle/meta/*` (regenerated); `src/server/app.ts` (`eventsUseCases`); H6 `seed/index.ts` (`seedEvents` after identity/access)
  - H3 `src/i18n/messages.ts`; H4 `src/lib/routes.ts` + `nav.json` + sitemap; H5 inventory; H8 the policy table; H9 the outbox `DomainEvent` union; H19 the admin nav
  - **X2 `src/proxy.ts`:** add `/events/:slug` to the matcher with a DB slug check. The unit's `keys` list is empty, so the orchestrator should add X2, or serialize after 70b/112b. If 70b generalised the check (a lookup per prefix), it's a one-line registration.
  - Q6 says 125a rebases on 111b.
- **Plain-Node rule:** `domain/` and `schema/events.ts` import nothing from Next, `@/env` or `server-only`.

## Design (codebase-design; risk-flagged, three options compared)
- **A. Its own `events` module: a deep use-case facade over one `event` table (chosen).** Status comes from the pure table. Edits pass through `eventChanges()`, so producers emit one payload that says what changed and consumers never diff rows. Public reads follow 70b's hybrid. The list streams under `connection()`. The detail is ISR with a placeholder param, `'use cache'` + `cacheTag("events", "event:<slug>")` + `cacheLife("hours")`, and returns null for the placeholder without touching the DB. Publish, edit and cancel call `updateTag` in the Server Actions. The interface stays small (9 use cases), and the domain holds every rule a test needs.
- **B. Events as a 111a CMS document kind (`cms_document`/`cms_revision`).** Revisions and Draft Mode would come for free. Rejected because events carry structured scheduling, capacity and status that registrations reference by FK, and "edit a published event and notify registrants" doesn't fit revision supersede. A reuses only 111a's sanitiser and cache pattern. #55 puts events under "CMS"; the PR says so (R15).
- **C. Separate `event` and `campaign` tables.** Rejected: the fields and flows are the same, and a campaign differs only in an optional place (`place_required` applies to `kind=event` only).
- **Defaults, reversible:**
  - Organisers are content_manager and community_manager, global scope (the ticket names them). Staff 2FA comes from #60's gate.
  - Drafts are cancelled, never deleted.
  - Registration opens at publish and closes at the start unless staff set a window.
  - The slug is the title, then the IST date, then a number; it's fixed at creation.
  - Columns: `event`: id, kind, slug unique, title, summary, description_html, starts_at, ends_at, venue_name, address, city, pin_code, online_url, capacity null, audience, registration_opens_at null, registration_closes_at null, waitlist_enabled, status, created_by_user_id (FK user, on delete set null), published_at, cancelled_at, completed_at, created_at, updated_at. A check enforces `ends_at > starts_at`. Indexes: `(status, starts_at)` and `slug`.

## Interface needs (code against these; rename to what landed)
```ts
// 57a: createHarness(), h.as(actor), h.clock, h.seed, composeUseCases(...), uuidv7(at), SeedDeps, Seeder
// 59a
authorize(ctx: UseCaseContext, action: Action, resource?: Resource): Promise<{ role: Role | null }>; // throws DomainError("forbidden")
recordAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entity: { type: "event"; id: string };
  before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
role(...roles: Role[]): Rule; anyone: Rule /* public reads; add if 59a lacks it */; EVENTS_POLICY spread into POLICY
class DomainError extends Error { readonly code: string; readonly details?: unknown }
h.seed.grant(user: { id: string }, grant: Grant): Promise<void>; h.signIn(user): Promise<Actor & { kind: "user" }>
// 61a
emit(tx: AppDb, clock: Clock, event: DomainEvent, options?: { availableAt?: Date }): Promise<void>;
type EventsDomainEvent =
  | { type: "event.published" | "event.cancelled"; aggregate: { type: "event"; id: string }; payload: { eventId: string } }
  | { type: "event.changed"; aggregate: { type: "event"; id: string };
      payload: { eventId: string; changes: NoticeChange[]; startMoved: boolean; endsAt: string } };
// 111a: the one sanitiser (name as landed)
sanitiseRichText(html: string): string;
// 114: inventory entries, e.g.
{ table: "event", column: "created_by_user_id", category: "identifier", subject: { kind: "user", via: "created_by_user_id" },
  retention: { policyKey: "events.created_by", defaultDays: null /* with the event */, basis: "accountability", toConfirm: "counsel" },
  action: "anonymise" }  // every other event column → NON_PERSONAL (a venue address isn't a person's)
// 70a/70b: istLocalToInstant(value: "YYYY-MM-DDTHH:mm"): Date; the proxy's DB slug check pattern; Lighthouse runner
// 59b: src/app/(staff)/admin/layout.tsx + admin nav entry
```

## Residue
- **HR-28:** Lighthouse ×3 on a phone and real iOS 16 devices. A local Lighthouse run needs `pnpm start` plus a seeded Postgres: not run here.
- **HR-31:** the retention of `event.created_by_user_id` (default: kept with the event, anonymised on erasure), to confirm.
- **HR-57 (append, M6 defaults):** organisers are content and community managers; default audience is members; registration closes at the start; drafts are cancelled, not deleted.
- **Not run:** Seam 2 and axe (no Postgres server; previews fail at `pnpm db:migrate`), and Lighthouse.

## Test plan
- **Unit:** done (64 cases); add `form-to-input` and `isListedEventSlug`.
- **Seam 1 (`events-admin.test.ts`):**
  - World: a content manager, a community manager, a competition manager and a member.
  - Uses `h.clock.set` to cross `starts_at` and `ends_at`.
  - Asserts on use-case results, outbox rows by type, `audit_log` rows and the public reads.
- **Seam 2:** `tests/e2e/125-events-public.spec.ts` covers the list, the detail, a 404 for an unknown slug and the admin pages, with axe in both themes (written, not run).

## Slices (size M → 1)
1. `src/server/modules/events/events-admin.test.ts` covers ACs 1–9, 12 and 13, then the pages for 10, 11 and 14. Build order:
   1. schema and migration;
   2. create and validate;
   3. publish and public reads;
   4. update with `eventChanges`;
   5. cancel and complete;
   6. authorization;
   7. seed and inventory;
   8. admin pages;
   9. public pages and proxy;
   10. e2e spec.
