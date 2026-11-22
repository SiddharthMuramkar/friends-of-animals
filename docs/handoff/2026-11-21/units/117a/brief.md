# 117a: Admin home queues by role (#117, M5, M, risk: authz)

Branch `ticket/117-queues` · worktree `/root/foa-wt/117a` · cut from `foa/M5` at build time (prepped 2026-11-21 by pane foa-p117 against `foa/M0` 442dd99) · blockers 80b, 103c (and through the chain 59a, 60, 70a, 73, 85b, 92, 93, 99a, 80a, 103a) · no conflict key · H43 owner. **No head-start code**: the logic worth having is the queue queries and the scope probe, and both need 59a's policy plus the six source tables (see "Pure core" below).

## Scope
- **In (117a):** the Reports and analytics module's first part: an in-code **queue registry** (one definition per file), use cases `getAdminHome()` and `listQueueItems({ key, cursor?, limit? })`, the `/admin` home page (queue cards) and the fallback list `/admin/queues/[key]`, the `adminHome` namespace, `can()` action `admin_home.view`, the preview-seed check (one item in every queue, one staff user per queue role), and the Seam 2 spec plus axe.
- **Six queues:** `institutions_to_verify` (73), `entries_to_verify` (92), `artwork_arriving` (93), `results_to_approve` (99a), `refunds_to_approve` (80a), `reports_to_review` (103c gallery reports).
- **Out, 117b (sibling):** per-competition reports, fee totals, CSV export, `src/server/lib/csv.ts`, `/admin/reports/**`, the `adminReports` namespace.
- **Out, later:** a safeguarding queue for the DSL (116a; add one queue file if 116a is on `M5` at claim, otherwise a follow-up); queue SLAs and overdue alerts (HR-51); cached counts; objective reports (#135).

## Decisions (reversible, recorded)
- **Visibility follows the owning module's policy.** Each queue names the `can()` action that does its work (for example `refund.approve`, not `refund.read`). The actor sees the queue only where that action allows them. Nothing duplicates role lists. **This differs from the M5 test plan** ("competition_manager sees the institutions queue"): 73 lets only staff_admin and super_admin decide institutions, so a competition manager doesn't see that queue. A card that opens a screen the viewer is refused on is a dead end.
- **Scoped roles see scoped counts.** A competition manager scoped to competition A counts only A's entries, artwork, results and refunds. A global grant counts everything.
- **Live counts.** Each count is one indexed query, so there's no 60 s cache at pilot scale. The page is dynamic (staff session).
- The count and the list share **one query definition**, so the count always equals the list length.
- `artwork_arriving` = `requested` + `dispatched` (everything FOA still waits to receive). The card also shows "M overdue" = `requested` past `dispatch_deadline`.
- `results_to_approve` counts every `pending_approval` release. Items the viewer prepared are marked as theirs, because someone else must approve them.
- Queue items carry codes, competition code, waiting-since and a link. They carry **no personal data** (no names, emails or phones). Institution names are organisation data.
- `getAdminHome` needs any staff role, with the staff second factor (60's `secondFactor: "staff"`). A member gets `forbidden`. A staff user with no visible queue gets an empty list and the page shows `ExplainState` "Nothing waiting for your roles".

## Acceptance checks (Seam 1 unless marked: `h.as(actor).<useCase>` on PGlite with real migrations, FakeClock, fakes)
1. **Counts match fixtures.** World: 2 institutions `pending_verification`; 3 entries `submitted_to_foa` plus 1 individual `submitted` entry that 92's deadline drain forwards (count 4 after `clock.set(closesAt)` + `h.drain()`); 2 artworks `requested` past their deadline plus 1 `dispatched`; 1 results release `pending_approval`; 2 refunds `requested`; 1 open gallery report. Super admin's `getAdminHome()` shows each queue's count equal to its fixture, plus noise rows in other statuses that aren't counted.
2. **Lists equal counts.** For every visible queue, `listQueueItems({ key })` returns exactly the fixture's items (ids), oldest first, and its length equals the home count. Keyset pages (`limit`, `cursor`) have no overlap and no gaps.
3. **Oldest age.** Each card carries `oldestWaitingSince` = the earliest waiting-since among its items (institution `created_at`, the entry's arrival at `submitted_to_foa`, artwork `requested_at`, release `submitted_at`, refund `requested_at`, report `reported_at`), or null when empty. Advancing the clock changes nothing stored.
4. **Roles pick queues** (ticket AC 2). finance sees only `refunds_to_approve`; content_manager only `reports_to_review` (per 103c's action); foa_verifier sees `entries_to_verify` (+ `artwork_arriving` per 93); a competition manager sees entries, artwork and results, not refunds or institutions; staff_admin and super_admin see what their policies allow. Each expectation is asserted as "visible iff the owning action allows", plus the literal table above.
5. **Scoped counts.** A competition manager scoped to A sees A's counts only. `listQueueItems` returns no item of competition B, and an item id of B never appears.
6. **Refusals.** A member, a visitor and an institution_admin calling `getAdminHome` get `forbidden`. `listQueueItems` for a queue the actor can't see gets `forbidden`; an unknown key gets `not_found` (zod enum over registry keys → `invalid_input`).
7. **Staff second factor.** A staff user without a confirmed factor gets `enrolment_required` (60's rule), so it isn't re-tested beyond one case.
8. **Authorization per use case**: `getAdminHome` and `listQueueItems` each have one allowed and at least one refused test.
9. **Registry integrity** (unit). Keys are unique; every definition's `action` exists in `POLICY`; every `href` starts with `/admin/`.
10. **Seed** (S1). `h.seed.preview()` gives at least one item in every queue and one staff user per queue role (reuse 59a/73/92/93/99a/80a/103c seeders; `src/server/seed/admin-home.ts` adds only what's missing). Running it twice changes nothing.
11. **Pages** (S2, written, **Not run**). `/admin` shows one card per visible queue (count, oldest age, overdue for artwork, a link). `/admin/queues/[key]` lists the items. `expectRendersAccessibly` on both, light and `.dark`; no horizontal scroll at 320 px; targets ≥ 44 px; the count isn't conveyed by colour alone.

## Files
- **New:** `src/server/modules/reports/queues/{registry,types,scope,admin-home,list-queue-items,policy,index}.ts`; one file per queue under `src/server/modules/reports/queues/sources/<key>.ts`; tests `queues/admin-home.test.ts`, `queues/registry.test.ts`, `queues/scope.test.ts`; `src/server/seed/admin-home.ts`; `src/app/(staff)/admin/page.tsx` + `_components/queue-card.tsx`; `src/app/(staff)/admin/queues/[key]/page.tsx`; `messages/en-IN/adminHome.json`; `tests/e2e/117-admin-home.spec.ts`. No migration (indexes come from the owning tables; add one only if a queue's `where` lacks one, using `--name 117_queue_indexes`).
- **One line each:** `src/server/app.ts` (`adminHomeUseCases`), 59a's `policies.ts` (`...ADMIN_HOME_POLICY`), `seed/index.ts`, `src/i18n/messages.ts`, `src/lib/app-routes.ts`.
- **Hotspots:** H43 (owner; the path is `queues/registry.ts`, not H43's literal `queues.ts`, so each later queue adds one file plus one registry line); H19 (`/admin` may already be 59b's placeholder: replace it, keep 59b's layout); H8 (policy table). The route group `(staff)` comes from 59b; if it isn't there, use `src/app/admin/`. Siblings don't share files: 117b lives under `reports/competition/**` and `reports/domain/**`.

## Design (codebase-design; three candidates)
- **A. Queries in each owning module.** Each module exports `waitingItems(db, scope)`, and the registry imports them. The rules stay with their owner, but 117a would edit six modules' files (H14, H22, M3/M4 module files), and every later queue would too.
- **B. Registry of definitions in the reports module (chosen).** One file per queue: `{ key, action, scopeType: "competition" | null, href, waiting(db, scope) → SQL }`. Status values come from the owning module's exported constants (`INSTITUTION_STATUSES`, `ENTRY_STATUSES`, ...), never string literals, so a renamed status breaks the build. One deep function, `queueQuery(def, scope)`, produces both `count` and keyset `list` from the same `where`, which is what makes AC2 hold. The interface is small: two use cases over a registry. Locality: adding a queue is one file plus one line.
- **C. A materialised `queue_item` table fed by outbox events.** Counts would be cheap, but six event consumers, backfill and drift all cost more than live indexed counts at pilot scale. Rejected (the "cached 60 s" question goes the same way).
- **Scope probe (inside B).** `queueScope(subject, def)`: if `decide(POLICY, subject, def.action, {})` allows, the scope is `all`. Otherwise it probes each id of the subject's grants at `def.scopeType` with `{ scopes: [{ type, id }] }` and keeps the allowed ones (`some`), or hides the queue. The scope comes from the real policy, so it can't drift from the work screens. Table-tested pure in `scope.test.ts`, with a fake policy.

## Interface needs (code against these; adapt names, not shapes)
```ts
// 59a
type Grant = { role: Role; scope: { type: "global" } | { type: "institution" | "competition" | "organisation"; id: string } };
type Subject = { kind: "visitor" } | { kind: "system"; process: string } | { kind: "user"; userId: string; grants: readonly Grant[] };
decide(policy, subject, action, resource?: { scopes?: { type; id: string }[]; ownerId?: string }): { allowed: true; role: Role | null } | { allowed: false };
POLICY; type Action = keyof typeof POLICY;  isStaffRole(role: Role): boolean
loadGrants(db: AppDb, userId: string): Promise<Grant[]>          // what authorize() uses; export it if private
authorize(ctx: UseCaseContext, action: Action, resource?): Promise<{ role: Role | null }>  // throws DomainError("forbidden")
class DomainError extends Error { code: "forbidden" | "not_found" | "invalid_input" | ... }
// 60: policy rule flag secondFactor?: "staff" | "step-up"; harness: h.signIn(staffUser) with a confirmed factor
// 70a: competition { id, code, name }
// 73: institution { id, name, status, createdAt }; INSTITUTION_STATUSES ∋ "pending_verification"; action "institution.decide"
// 85b/92: entry { id, code, competitionId, status }; ENTRY_STATUSES ∋ "submitted_to_foa"; arrival time = 92's arrived-at
//         (entry_transition.at of the move to submitted_to_foa); action for listVerificationQueue
// 93: physicalArtwork { id, code, competitionId, status, requestedAt, dispatchDeadline }; statuses requested|dispatched; action "artwork.receive"
// 99a: resultsRelease { id, competitionId, status, submittedAt, preparedBy }; "pending_approval"; action "results.approve"
// 80a: refund { id, batchId, status, requestedAt, amountMinor, currency } ⋈ paymentBatch { id, competitionId }; "requested"; action "refund.approve"
// 103c: galleryReport { id, galleryItemId, status, reportedAt } ⋈ galleryItem { entryId } ; open status; review action
```
What 117a provides: `QueueDefinition`, `QUEUES` (registry), `queueScope`, `getAdminHome(): Promise<{ queues: { key; count; overdue?; oldestWaitingSince: Date | null; href }[] }>`, `listQueueItems({ key, cursor?, limit? }): Promise<{ items: { id; code; competitionCode: string | null; waitingSince: Date; mine?: boolean; href }[]; nextCursor: string | null }>`.

## Residue
- **HR-51:** queue SLAs (none built; the cards show the oldest age only) and home sections.
- **HR-17:** who holds each staff role (finance, content_manager, foa_verifier, results approvers).
- **G5:** which roles see which queue = the owning actions' policies. Changing who works a queue changes who sees it.

## Test plan
Pure: `queues/scope.test.ts` (global grant → all; scoped grants → those ids only; a grant at another scope type is ignored; duplicate grants are deduped; nothing allowed → hidden; a fake policy with `role()`/`anyOf()`). Unit: `queues/registry.test.ts` (AC9). Seam 1: `queues/admin-home.test.ts` (AC1–8, one world per describe, built with the owning modules' seed builders or their use cases), `src/server/seed/admin-home.test.ts` (AC10). Seam 2 + axe: `tests/e2e/117-admin-home.spec.ts`, **Not run** (no Postgres server; previews fail at `pnpm db:migrate`).

## Slices (size M: one)
1. Admin home queues: registry + six sources + scope probe + both use cases + policy + seed check + `/admin` + `/admin/queues/[key]` + namespace + Seam 2 spec (AC1–11) → `src/server/modules/reports/queues/admin-home.test.ts` (with `scope.test.ts` and `registry.test.ts` written first, red-green, inside the slice).
