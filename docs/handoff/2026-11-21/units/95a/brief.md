# 95a: FOA rounds — configuration and the round status machine

| Unit | Issue | Branch | Worktree | Blocked by | Size, flags |
|---|---|---|---|---|---|
| 95a | #95 (M3) | `ticket/95-rounds` | `/root/foa-wt/95a` | 94 (native); extras #88 rubrics, #72 award schemes, #70a competitions, #59a/#60 policy + audit + 2FA | M · risk · no conflict key |

**Head start on the branch:** `3e39d9b M3 #95: Add FOA round domain core` (base `foa/M0` 442dd99), `src/server/modules/judging/domain/`:
`round-status.ts` (draft/open/locked/cancelled, the move table, `isRoundEditable`, `acceptsJudges`), `round-settings.ts` (levels, entry sources,
`roundSettingsSchema` with the pilot defaults, `roundNameKey`), `rubric-pins.ts` (`pinRubrics`). 47 unit tests. Rebase onto `foa/M3` before slice 1; build on these.

## Scope
- **In (95a):** enums `judging_level`, `judging_round_status` (all 4 values, F2), `round_entry_source` (both values, F2); tables `judging_round`,
  `judging_round_rubric`; use cases `createJudgingRound`, `updateJudgingRound`, `openJudgingRound`, `cancelJudgingRound`, `listJudgingRounds`,
  `getJudgingRound`; audit; the round seed; admin pages `/admin/judging/rounds`, `/admin/judging/rounds/new`, `/admin/judging/rounds/[id]` (settings
  panel + the tab bar that 95b/95c extend); namespace `adminJudging`; Seam 2 spec.
- **95b owns:** invitations, the round-scoped judge role, onboarding (conduct, confidentiality, conflicts), `/judge/**`, the Judges tab.
- **95c owns:** the pool (`round_entry`), assignment, staff and automatic conflicts, the Pool / Assignments / Conflicts tabs.
- **Later:** `open → locked` + lock guard (#97 appends the row), `round_finalists` source and `source_round_id` use (#98), scoring (#96).

## Acceptance criteria (numbered, with the seam that proves each)
1. A competition manager scoped to competition C calls `createJudgingRound({ competitionId, name, level, judgesPhysical, awardScheme })` →
   `{ ok: true, roundId }`; row is `draft`; one `judging_round_rubric` pin per enabled discipline = its latest published version. Omitted fields take
   the defaults: national, physical, `verified_entries`, award scheme = C's `foa_final` scheme from #72, else `ranked_123`. (S1) — ticket AC 1
2. If any enabled discipline lacks a published rubric, creation fails `{ ok: false, reason: "rubric_missing", missing: [...] }` and writes nothing. (S1)
3. Invalid input fails `invalid_input` (name empty or > 120, unknown level/scheme, `round_finalists` source); a second round whose `roundNameKey`
   matches one in C fails `name_taken`. Two rounds with different names in C both succeed. (S1)
4. `updateJudgingRound` changes settings of a draft; on `open`, `locked` or `cancelled` it fails `round_not_editable`. (S1)
5. `openJudgingRound` moves draft → open, sets `opened_at/by`, re-pins every discipline to its latest published version (so a revision published while
   drafting is used); missing one → `rubric_missing`. After opening, publishing a new rubric version leaves the pins unchanged. (S1)
6. `cancelJudgingRound({ roundId, reason })` from draft or open → `cancelled`, `cancelled_at/by`, reason 1–500 chars (`reason_required`). (S1)
7. Transition table: every one of the 16 status pairs (unit, **done** in `round-status.test.ts`); through use cases, open-twice and cancel-a-cancelled
   fail `round_transition_not_allowed` (guarded `UPDATE … WHERE status = from`). (unit + S1) — ticket AC 6
8. Create, update, open and cancel each write one audit row: `judging_round.created|updated|opened|cancelled`, entity `judging_round`, before/after
   = settings, status and pin ids (no PD). (S1)
9. Authorization per use case: competition manager scoped to C and global competition manager pass; manager scoped to another competition, content
   manager, member and visitor fail `forbidden`. Reads also allow staff admin and super admin. Staff without a fresh second factor fail
   `second_factor_required` (#60). (S1) — ticket AC 8
10. Seed: the preview pilot competition has a national, physical, `ranked_123` round in `draft` and one in `open` (fixed ids in `SEED_IDS.judging`),
    so 95b/95c seed onto them. Seeding twice changes nothing. (S1, `seed.test.ts`)
11. axe clean (light + `.dark`, desktop + mobile) on the three pages, including the empty list and the `rubric_missing` error. (S2, written, **Not run**) — ticket AC 9

## Files
- **New:** `src/server/db/schema/judging-rounds.ts` (own file, so #88's `judging.ts` stays untouched) + one barrel line (H1); one generated migration
  `95_judging_rounds` (H2); `src/server/modules/judging/rounds/{create,update,open,cancel,read,index}.ts` + `rounds.test.ts`;
  `src/server/modules/judging/policy.ts` (or append to #88's judging policy if it exists); `src/server/seed/judging-rounds.ts` + one `seeders` line
  after #88's and #94's seeders (H6); `src/app/(staff)/admin/judging/rounds/{page.tsx,new/page.tsx,[id]/page.tsx,[id]/_components/round-tabs.tsx,
  _components/*,actions.ts}` (use 59b's admin route group, whatever it is called on trunk); `messages/en-IN/adminJudging.json` + registry (H3);
  `tests/e2e/95-rounds.spec.ts`.
- **Append-only:** `src/server/app.ts` (`judgingRoundsUseCases`), `can()` policy table (H8), admin nav + `app-routes.ts` (H19), `docs/` none.
- **Hotspots:** H22 judging module (serial with #96–#98 natively); route tabs component is extended by 95b/95c (they append tab entries).
- **Next traps:** pages read the session under `<Suspense>` after `await connection()`; Server Actions: authenticate → zod → one use case;
  `redirect()` for denial (no `forbidden()`); read `node_modules/next/dist/docs/01-app/02-guides/{forms,data-security,authentication-with-cache-components}.md`.

## Design (risk-flagged; three shapes compared with `codebase-design`)
- **A. Columns + pin table + pure machine (chosen).** `judging_round` holds each setting as a typed column (enums, FK to competition, nullable self-FK
  `source_round_id` for #98); `judging_round_rubric` (round_id, discipline, rubric_id FK → #88's `rubric`; unique round+discipline). All rules sit in
  the pure domain (done); use cases stay thin: `authorize` → zod → load → domain → guarded write + audit in one tx. Leverage: 95c reads
  `judges_physical` as a column, #97 adds lock columns, #98 uses `entry_source`/`source_round_id` without a migration of meaning.
- B. Settings as a zod-validated `jsonb` blob. Flexible, but enums, the rubric FK and the self-FK leave the database; 95c/#97/#98 query through json
  paths. Fails "constraints over code" (§1.9: PGlite hides races; enforce invariants in the DB).
- C. A `judging_plan` aggregate per competition owning ordered rounds. Natural for #98's chain, but an entity no ticket names; `source_round_id`
  already expresses the chain. Fails the deletion test (deleting it removes nothing a round can't hold).
- **Pinning:** at creation (so the "missing rubric" refusal comes early, per the ticket's test plan) and again at open (picks up revisions), frozen
  after. Pins are rows, never copies of criteria: #88's published rubrics are immutable by trigger.
- **Columns:** `id` uuidv7, `competition_id` FK, `name`, `name_key` (unique with competition_id), `level`, `status` default draft, `judges_physical` bool,
  `award_scheme` (#72's `award_scheme` enum), `entry_source` default verified_entries, `source_round_id` null self-FK, CHECK
  `(entry_source = 'round_finalists') = (source_round_id IS NOT NULL)` and `source_round_id <> id`, `created_by/at`, `updated_at`, `opened_by/at`,
  `cancelled_by/at`, `cancel_reason`. Enum literals in CHECKs are fine here: the enum is *created* in this migration, not altered (F2 is about `ADD VALUE`).
- **Defaults (reversible, write in PR):** only competition managers write (super admin is not a wildcard in #59's policy); no competition-status gate on
  create or open (FOA may set rounds up early; #90 owns the competition's FOA_JUDGING flip); a physical round covers every enabled discipline, so
  essays/videos never pass physical readiness (mixed competitions use two rounds); rounds are never deleted, only cancelled.

## Interface needs (code against these; adopt trunk names at claim)
```ts
// #57a harness (PR #140): createHarness(), h.as(actor), h.seed.*, uuidv7(at), Clock; composeUseCases(...modules)
// #59a / #60
authorize(ctx: UseCaseContext, action: JudgingAction, resource?: Resource): Promise<{ role: Role | null }>; // throws DomainError forbidden | second_factor_required
type Resource = { scopes?: readonly ScopedScope[]; ownerId?: string };  // round resources pass [{ type: "competition", id }]
recordAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entity: { type: string; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
// harness helpers expected: h.seed.grant(user, { role: "competition_manager", scope: { type: "competition", id } }); h.signIn(user) (+ #60 second factor)
// #70a competitions
const competition: PgTable<{ id: string; code: string; name: string; status: CompetitionStatus }>;
function enabledDisciplines(db: AppDb, competitionId: string): Promise<Discipline[]>;   // or a column/child table, read directly
// #72 award schemes
const awardScheme: PgEnum<["grades_ab", "medals_gsb", "ranked_123"]>; type AwardScheme;
const competitionAwardScheme: PgTable<{ competitionId: string; roundKey: string /* "school" | "foa_final" */; scheme: AwardScheme }>;
// #88 rubrics
const rubric: PgTable<{ id: string; competitionId: string; discipline: Discipline; version: number; status: "draft" | "published" | "superseded" }>;
// #94 (95a needs nothing from it at code level; it is the native blocker)
```

## Residue
- None blocking. Defaults above go in the PR body under "Defaults FOA may revisit" (append to HR-40, M3 FOA defaults): who may manage rounds, pilot
  defaults, physical rule covering every discipline. HR-28 (real-device checks) applies to the three pages.

## Test plan
- Unit (done): status table (16 pairs), editability, `acceptsJudges`, settings schema + defaults, name key, rubric pinning.
- Seam 1 (`createHarness()`, PGlite, fake clock): `src/server/modules/judging/rounds/rounds.test.ts` covers ACs 1–9; seed AC 10 in
  `src/server/seed/judging-rounds.test.ts` (or the shared `seed.test.ts`). No outbox events in 95a (no consumer needs one).
- Seam 2: `tests/e2e/95-rounds.spec.ts` — seeded manager lists rounds, creates one, opens it; `expectRendersAccessibly` light + dark on all three pages.
  **Not run** here (no Postgres server; previews fail at `pnpm db:migrate`).

## Slices (size M → 1)
1. Round configuration and status machine end to end: schema + migration, six use cases, audit, authz, seed, three pages, namespace, Seam 2 spec
   (ACs 1–11) → `src/server/modules/judging/rounds/rounds.test.ts`.
