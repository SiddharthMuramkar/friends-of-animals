# Brief 89a: school round opening, panel, positions and shortlist picks

Unit 89a of #89 · M2 · L · risk K, PD · key X11 (`src/server/modules/school-round/**`, owner) · branch `ticket/89-picks` ·
worktree `/root/foa-wt/89a` · blocked by #87, #88 (and transitively 85b, #75, #74, #70, #71, #69, #59, 61a).
Sources: #89 body + owner decisions (2026-11-19), `issues-M2.md` §2.1 / §3 #89 / F2 / F14 / F15, spec §1.9, §2.4, §3.3.

## Scope
**In (89a):** the School round module, its schema (all four `school_round_status` values up front, F2) and every #89
column (judging attestation and finalise columns too, so 89b needs no migration and takes no schema slot); system consumer
`openSchoolRounds`; use cases `getSchoolRound`, `recordPanel`, `saveShortlist` (picks and positions for one category);
the coordinator page `/institution/competitions/[ref]/school-round` in its open state; namespace `schoolRound`; preview seed
with an open round. **Pure core already built on this branch** (see "Head start").
**Out:** 89b owns the judging attestation, `finaliseSchoolRound`, the `open → finalised` row, entry transitions,
`school_round.shortlist_finalised`, family messages, the outcomes query (moved from 89a: it is only meaningful once a round
can be finalised) and the finalised page state. #90 owns overdue / close on behalf / reopen; 91a the shortlist-only scope.

## Acceptance checks
1. Competition enters SCHOOL_JUDGING → after `h.drain()`, one `open` round per **confirmed** institution registration,
   including one with zero entries; none for an unconfirmed one; redelivering the event adds nothing; one
   `school_round_transition` row (none) → `open`, system actor. *Seam 1*
2. Coordinator records a panel of 2 (full name + designation); saving again replaces the list; 0 members →
   `panel_empty`; > 10 → `panel_too_large`; blank or > 120-char fields refused by zod. *Seam 1*
3. Coordinator saves a category shortlist of 5 `submitted` entries (shortlist size 5); a 6th → `shortlist_full`; a
   `processing`/`rejected`/`failed` entry → `not_submitted`; another category's entry → `wrong_category`; an entry outside
   this round → `unknown_entry`; a repeated entry → `duplicate_entry`. Rejected saves change no rows. *Seam 1*
4. Positions 1–3 (setting 3) on shortlisted entries are stored; position 4 → `position_out_of_range`; two entries at 1 →
   `position_taken`; a competition whose setting is 2 refuses 3. Positions are optional. *Seam 1*
5. Round status machine: every (from ∈ none + 4 values) × (to ∈ 4 values) pair; only (none) → `open` allowed. *Vitest
   table (done)*; only `open` rounds are editable (`round_not_editable`). *Vitest (done)*
6. Authz on `getSchoolRound`, `recordPanel`, `saveShortlist`: coordinator of the institution passes; coordinator of
   another institution, a participant and a competition manager get `forbidden`. *Seam 1*
7. `/institution/competitions/[ref]/school-round` (open round with panel and picks) renders accessibly, light + dark,
   no horizontal scroll at 320 px. *Seam 2 `tests/e2e/89-school-round.spec.ts` (written, Not run here)*
8. `h.seed.preview()` twice leaves one SCHOOL_JUDGING competition with the seeded coordinator's open round, a panel of 2
   and picks with positions. *Seam 1*

## Files and hotspots
- Head start (committed): `src/server/modules/school-round/domain/{status,picks}.ts` + `.test.ts`.
- New: `src/server/db/schema/school-round.ts` (+ one barrel line, H1); one migration `--name 89_school_round` (H2);
  `src/server/modules/school-round/{index,open-school-rounds,get-school-round,record-panel,save-shortlist}.ts` + tests;
  `src/server/seed/school-round.ts` (+ `seeders` line, H6); `messages/en-IN/schoolRound.json` (+3 lines in
  `src/i18n/messages.ts`, H3); `src/app/institution/competitions/[ref]/school-round/{page.tsx,_components/*,actions.ts}`;
  `tests/e2e/89-school-round.spec.ts`; GLOSSARY terms via `domain-modeling`: School round, Shortlist, School position,
  Panel, Category.
- Append-only edits: `composeUseCases(...)` in `src/server/app.ts`; consumer registry (H9); `can()` table (H8); coordinator
  nav + `src/lib/app-routes.ts` (H19, H27). Schema imports the enum tuple from `domain/status.ts` by relative path: keep
  `domain/*` free of `server-only`, `@/` and Next imports.

## Design (risk-flagged: three designs compared)
- **A. Incremental commands** (spec proposal): `setShortlistPick`, `removeShortlistPick`, `setPosition`, `clearPosition`.
  Shallow: four interfaces, each re-checking part of the invariants; four authz matrices; a row-per-click UI.
- **B. Category draft replace over a pure core (chosen).** One command `saveShortlist({ roundId, categoryKey, picks:
  [{ entryId, position | null }] })` loads the category's entries, calls `checkCategoryPicks` and, if clean, replaces that
  category's `school_round_pick` rows in one transaction. A row exists ⇔ shortlisted; position is a nullable attribute
  (positions ⊆ shortlist, HR-37 default). Deep: one small interface, every rule in one tested function (locality), and
  91a (`createShortlistedEntry`) and #90 (close on behalf) reuse the same function and rows (leverage). UI: one form per
  category (checkbox + position select per entry) that works without JS and shows every problem at once.
- **C. SchoolRound aggregate with separate shortlist and position tables**, loaded and saved whole. A repository over
  Drizzle (spec §10.8 forbids it), two tables that can disagree, more joins. Rejected.
- DB backstops: `school_round_pick` PK `entry_id`; partial unique `(round_id, category_key, position) WHERE position IS
  NOT NULL`; CHECK `position >= 1`; `school_round.institution_registration_id` UNIQUE (idempotent opening). Writers take
  `SELECT … FOR UPDATE` on the `school_round` row (F15).
- Tables: `school_round` (id, competition_id, institution_registration_id UNIQUE, status, opened_at,
  judging_attested_by_user_id, judging_attested_at, judging_statement_version, finalised_by_user_id, finalised_at,
  created_at, updated_at); `school_round_panel_member` (id, round_id, sort_order, full_name, designation; UNIQUE
  (round_id, sort_order)); `school_round_pick` (entry_id PK, round_id, category_key, position, picked_by_user_id,
  picked_at); `school_round_transition` (id, round_id, from_status null, to_status, actor_kind, actor_user_id, reason, at).
- Round opening is an outbox consumer (not lazy on first view): the round exists for the deadline job (#90) and for
  zero-entry schools that never visit.

## Interface needs (expected names; adopt the real ones found on `M2` at claim, R1)
```ts
// 61a outbox + harness
emit(tx: AppDb, event: OutboxEvent): Promise<void>;
registerConsumer<T extends OutboxEvent["type"]>(type: T, handle: (ctx: UseCaseContext, e: Extract<OutboxEvent, { type: T }>) => Promise<void>): void;
h.drain(): Promise<void>;
// #71 / #88: emitted in the flip's transaction
type CompetitionStatusChanged = { type: "competition.status_changed"; competitionId: string; from: CompetitionStatus; to: CompetitionStatus };
// #70 (F14: category key); if the two settings are missing, read 5 / 3 from a module constant and record residue
getCompetitionRoundSettings(db: AppDb, competitionId: string): Promise<{ code: string; shortlistSize: number; schoolPositions: number; submissionScope: "all_participants" | "shortlist_only" }>;
// #75
listConfirmedInstitutionRegistrations(db: AppDb, competitionId: string): Promise<{ id: string; institutionId: string }[]>;
// #59 / #74
can(actor: Actor, action: "schoolRound.manage", resource: { institutionId: string }): Promise<void>; // throws ForbiddenError
// 85b / #87
listInstitutionEntries(db: AppDb, input: { institutionRegistrationId: string }): Promise<{ entryId: string; code: string; registrationId: string; categoryKey: string; status: EntryStatus }[]>;
```

## Head start (pure core, Vitest only): `65ee75c` on `ticket/89-picks`, 38 tests, `pnpm check` green
- `domain/status.ts`: `SCHOOL_ROUND_STATUSES` (4 values, for `pgEnum`), `SCHOOL_ROUND_TRANSITIONS` (one row; 89b and #90
  append), `canTransitionSchoolRound`, `assertSchoolRoundTransition` (`SchoolRoundTransitionError`),
  `isSchoolRoundEditable`. The test's expected table is literal: each ticket edits both lists.
- `domain/picks.ts`: `checkCategoryPicks({ categoryKey, candidates, picks, limits })` → `{ ok, picks }` or `{ ok: false,
  problems }` with every `PickProblem` (`unknown_entry`, `wrong_category`, `not_submitted`, `duplicate_entry`,
  `shortlist_full`, `position_out_of_range`, `position_taken`); `RangeError` on impossible limits. Candidates carry
  `submitted: boolean`, not 85b's enum, so the core needs nothing unbuilt.

## Residue
- HR-37: positions only on shortlisted entries; no contiguity rule (2nd without 1st allowed); panel = name + designation,
  1–10 members, no contact data; editing only while `open` (#90 decides `overdue`).
- HR-31: retention for panel member names (PD), "to confirm" in the data inventory.
- HR-36: page copy in `schoolRound` (drafted from `messages/en-IN/schools.json`).

## Test plan
Vitest for the core (done). Seam 1 through `createHarness()`: `as(coordinator).saveShortlist(...)` etc. on PGlite with
real migrations, `h.drain()` for opening, seed builders for competitions, registrations and entries in each status.
Authz matrix per use case. Seam 2 spec written with `expectRendersAccessibly` (+ `.dark`), listed under "Not run".

## Slices (ordered)
1. Schema + migration + `openSchoolRounds` consumer (AC 1) · `open-school-rounds.test.ts`.
2. `getSchoolRound` + `recordPanel` with authz (AC 2, 6) · `record-panel.test.ts`.
3. `saveShortlist` over `checkCategoryPicks`, limits from the competition, authz (AC 3, 4, 6) · `save-shortlist.test.ts`.
4. Page, actions, `schoolRound` namespace, nav line, preview seed, e2e spec (AC 7, 8) · `seed/school-round.test.ts` +
   `tests/e2e/89-school-round.spec.ts`.
