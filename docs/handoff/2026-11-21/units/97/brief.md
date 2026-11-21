# Brief 97: Rankings, round lock and outcomes (M3 Seam 2 owner)

| Unit | Issue | Branch | Worktree | Blocked by | Size, flags |
|---|---|---|---|---|---|
| 97 | #97 (M3) | `ticket/97-rankings-round-lock-and-outcomes` | `/root/foa-wt/97` | #96 (and through it 95a/b/c, #94, #88, #86, #72, #59, #60, #61) | L · risk · journey (J) · no siblings |

Head start already on the branch: `5bd75f8 M3 #97: Add rankings, round lock and outcome domain core` (base `foa/M0` 442dd99), in `src/server/modules/judging/domain/`:
`rational.ts` (exact BigInt fractions, 2 dp half-up), `ranking.ts` (`isSheetComplete`, `sheetTotal`, `rankEntries`, `TIE_BREAK_RULE`), `round-lock.ts`
(`ROUND_STATUSES`, `roundAllows(status, action)`, `decideRoundLock`), `outcomes.ts` (`ROUND_OUTCOMES`, `AWARD_SCHEMES`, `advances`, `prefillOutcomes`, `outcomeTagProblems`).
There are 58 unit tests, including the hand-computed fixture. Build on these and don't re-derive them. Rebase onto `foa/M3` before slice 1. If 95a exports its own `RoundStatus`/table, make
`round-lock.ts` import it and keep only the action table.

## Scope
**In:** combining the scores into rankings per partition (discipline, category, age group) with the stated tie-break; locking the round (complete, or overridden by a staff admin with a reason, audit-logged);
freezing the ranking snapshot at lock; the DB trigger that makes a locked round's scores immutable; tagging outcomes after lock (prefilled from the award scheme); the physical-readiness filter
on every view; the `judging_round.locked` event; the outcome-model ADR; the preview seed; three admin views; **the M3 Seam 2 journey**.
**Out (owner):** round creation, open and cancel (95a); invitations and onboarding (95b); pool, assignment and conflicts (95c); blind scoring, `saveScore` and the viewer (#96); pool flow into the next round on
`judging_round.locked` (#98); results approval and publishing (99a); certificates (100a).

## Acceptance criteria (numbered, with the seam that proves each)
1. Rankings match the hand-computed fixture (4 entries × 3 judges × 4 criteria, 0–10; A 82.83 r1, B 70.00 r2 by score, C 70.00 r3 by theme, D 70.00 r3 shared). Unit test (done) plus Seam 1 `getRoundRankings` on the seeded copy.
2. Only finished sheets count toward the mean. An entry with no finished sheet is listed as unscored, by entry code only. Unit test (done) plus Seam 1.
3. `lockRound` on an open round with 1 unscored assignment is refused with `unscored_assignments` and a count. The error has no entry or participant data. Seam 1.
4. A staff admin's override with a reason of 10–500 characters locks the round. The audit row carries `{reason, unscoredAssignmentIds, withheldEntryIds}`. A blank or short reason is refused, and a competition manager's override is refused. Seam 1.
5. Lock is synchronous and runs in one transaction: status locked, a `judging_round_lock` row (mode, reason, tie-break rule id), and `round_entry_result` rows (score num/den, rank, decided_by). One `judging_round.locked` outbox row. Seam 1.
6. After lock, `saveScore` is refused (#96 checks `roundAllows(status,"score")`). A raw SQL INSERT, UPDATE or DELETE on `score_sheet` or `criterion_score` of that round raises from the trigger, and so does an UPDATE of the result's score columns. Seam 1.
7. `setRoundOutcomes` works only on a locked round. The form starts from `prefillOutcomes(awardScheme, …)`, and `outcomeTagProblems` is enforced. `advances` is stored, and the save is audit-logged with before and after values. On an open round it's refused with `round_not_locked`. Seam 1.
8. In a round that judges the physical work, an entry that isn't physically ready is never shown. Before lock it's left out of the live ranking. At lock it's withheld: no result row, and its assignments don't block the lock. If its artwork moves to `discrepancy` after lock, it disappears from rankings and outcomes, and tagging it is refused. Seam 1.
9. Round transition table: open→locked (complete), open→locked (override), draft→locked, locked→locked and cancelled→locked refused, scoring refused when not open. Unit test (done, `domain/round-lock.test.ts`) plus Seam 1 rows through `lockRound`.
10. Authorization, allow and deny per use case. Rankings: competition manager ✓, judge ✗. Lock: manager ✓, judge ✗. Override: staff admin or super admin ✓, manager ✗. Outcomes: manager ✓, content manager ✗. Seam 1.
11. Preview seed has an open round ready to lock, an open round with one unscored assignment, and a locked round with tagged outcomes, plus the fixture round for AC 1. Seam 1 seed test.
12. Seam 2: `tests/e2e/97-m3-blind-scoring.spec.ts` builds a fresh world (M34-4). A judge signs in by OTP through the capture mailbox. The dashboard lists only assigned entries and no seeded names. The judge opens the viewer, scores every criterion and reloads, and the values persist. Then a manager (OTP + preview TOTP) locks the round and sees "Locked". `expectRendersAccessibly` runs, light and `.dark`, on every page visited plus rankings, the lock dialog and outcomes, in both projects. **Not run** here.
13. An ADR "Round outcome model" is added via `domain-modeling` (docs/adr, next number), and GLOSSARY gets Ranking, Round lock and Outcome.

## Files
- New: `src/server/db/schema/judging-results.ts` + 1 barrel line (H1); generated migration `97_round_results` (enum `round_outcome`, all 5 values; tables below); custom `97_locked_round_scores` (trigger + CHECKs) (H2);
  `src/server/modules/judging/{rankings,lock-round,round-outcomes}.ts` + tests; `src/server/seed/judging-results.ts` + 1 line (H6);
  `src/app/(staff)/admin/judging/rounds/[id]/{rankings,outcomes}/page.tsx` + `_components/lock-dialog.tsx` (native `<dialog>`; follow 95a's actual route group);
  `messages/en-IN/adminJudgingResults.json` + registry lines (H3: a new namespace rather than growing 95a's `adminJudging`); `tests/e2e/97-m3-blind-scoring.spec.ts`; `docs/adr/NNNN-round-outcome-model.md`.
- Append-only: `can()` actions (H8); outbox event union `judging_round.locked` (H9); use-case registration (judging module object or one `composeUseCases` entry in `src/server/app.ts`); admin round tabs (95a's layout).
- Serialize with: #96 (same module folder, before us by dependency); #98 (reads `round_entry_result.advances` and consumes the event); `tests/e2e/support/*` (#57, #60).

## Design (compared with `codebase-design` vocabulary)
- **A. A pure `rankEntries` over exact rationals, with a snapshot written at lock (chosen, built).** One deep module hides normalisation, means, the three-step tie-break and shared ranks behind
  `rankEntries(criteria, entries) → {ranked[{entryId, score, rank, sheetsCounted, decidedBy}], unscored}`. The live view (before lock), `lockRound`, #98 and 99a all read that shape (leverage).
  A rule change touches one file (locality). The hand fixture tests the interface directly. `decidedBy` makes every tie explainable on the page ("ahead on Theme", "shared").
- B. SQL aggregation (numeric + window functions, tie-break in TS). This splits the rule across SQL and TS, rounding in numeric(12,6) can create or hide ties, PGlite and PG can differ, and the fixture would need a DB. Rejected.
- C. Incremental: #96's `saveScore` keeps the entry totals up to date. That couples scoring to aggregation (shotgun surgery on any rule change) and needs a backfill on rubric pinning. Rejected.
- **Storage:** results go in a separate `round_entry_result` (round_id, entry_id) PK + FK → `round_entry`. M34-5 suggested columns on 95c's `round_entry` instead. With a separate table, a row exists exactly when the round is locked, so the snapshot is explicit and 95c's table needs no edit (H22).
  The trigger then covers only the frozen columns.
  Columns: partition_key, score_num/score_den bigint null, rank smallint null, sheets_counted, decided_by text (`score|criterion:<id>|median|shared`), outcome default 'none', award_position smallint null,
  advances bool (written by the use case from `advances()`), suitable_for_auction bool default false, tagged_by, tagged_at. `judging_round_lock` (round_id PK, locked_at, locked_by, mode, override_reason,
  tie_break_rule); CHECK `(mode = 'override') = (override_reason IS NOT NULL)`. CHECKs that name `round_outcome` values go in the custom migration. The type is created, never ALTERed, so this is safe, but it keeps to the rule.
- **Defaults (reversible, recorded):** a ranking shows entry codes only (no names); scores show 2 dp while the order uses exact values; withheld entries don't block the lock; an override offered when nothing is unscored
  locks as complete; an empty round needs an override; grades start untagged; the snapshot is never recomputed after lock (only filtered by readiness).

## Interface needs (what this unit codes against; adapt names at claim)
```ts
// 95a: judging_round { id, competitionId, status: RoundStatus, judgesPhysical: boolean, awardScheme: AwardScheme, … }; judging_round_rubric { roundId, discipline, rubricId }
type RoundStatus = "draft" | "open" | "locked" | "cancelled";                  // enum judging_round_status, all four on trunk
function transitionRound(tx: AppDb, i: { roundId: string; from: RoundStatus; to: RoundStatus }): Promise<boolean>; // guarded UPDATE … WHERE status = from
// #88: rubric_criterion { id: string; rubricId: string; position: number; weight: number; minScore: number; maxScore: number }  (≡ ScoringCriterion + position)
// 95c: round_entry { roundId, entryId } unique; round_assignment { id, roundId, judgeUserId, entryId } unique triple
// #96: score_sheet { id, roundId, entryId, judgeUserId, complete, version }; criterion_score { scoreSheetId, criterionId, value: number }
//      saveScore refuses unless roundAllows(round.status, "score")      (import domain/round-lock.ts)
// #84/#92: entry { id, code, discipline, categoryLabel, ageGroupLabel }  (partition = discipline + category + age group)
// #94:
function physicallyReadyEntryIds(db: AppDb, entryIds: readonly string[]): Promise<ReadonlySet<string>>;
// #59:
type JudgingAction = "judgingRound.viewRankings" | "judgingRound.lock" | "judgingRound.overrideLock" | "judgingRound.tagOutcomes";
function can(ctx: UseCaseContext, action: JudgingAction, resource: { type: "competition"; id: string }): Promise<boolean>;
function writeAudit(tx: AppDb, e: { actor: Actor; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }): Promise<void>;
// #61:
function emit(tx: AppDb, e: { type: "judging_round.locked"; aggregateId: string;
  payload: { roundId: string; competitionId: string; lockedAt: string; mode: "complete" | "override" } }): Promise<void>;
// #72: type AwardScheme = "grades_ab" | "medals_gsb" | "ranked_123";   (95a copies it onto the round)
// Harness (M34-4, #57/#61/#60): a preview-only fixture route that builds a fresh judging world per journey run; capture-mailbox and preview-TOTP helpers in tests/e2e/support/
```
Use cases this unit adds: `getRoundRankings({roundId})`, `lockRound({roundId, override?: {reason}})`, `getRoundOutcomes({roundId})`, `setRoundOutcomes({roundId, tags: {entryCode, outcome, awardPosition, suitableForAuction}[]})`.

## Residue
- HR-40 (FOA, M3 defaults): the tie-break rule and its wording (`TIE_BREAK_RULE` v1), override reason length 10–500, award prefill (top 3 → winner/runners-up; grades untagged), withheld entries not blocking a lock, codes-only rankings.
- HR-01 (owner, D0): the Seam 2 journey on previews needs `BETTER_AUTH_SECRET` and `CAPTURE_MAILBOX_TOKEN`. Until then, and always here (no Postgres server), it's **Not run**.
- Not HR: if no M0 fixture route exists at claim (`ls tests/e2e/support`, `grep -rn "APP_ENV" src/app/api`), the orchestrator files the M34-4 harness ticket. The fallback is seeded `JRNY-01..20` worlds.

## Test plan
- Unit (done): rationals, ranking fixture plus median, rubric order, shared ranks, unfinished sheets; the full status × action table; lock decisions; outcome prefill and validation.
- Seam 1 (`createHarness()`, PGlite with real migrations, fake clock, `drain()`): one file per slice; authz allow and deny per use case; trigger proven through raw `h.db` writes.
- Seam 2: AC 12's journey plus axe (light and dark, desktop and Pixel 7). **Not run** here.

## Slices (ordered; each = one behaviour, one test file)
1. Schema, migration and live `getRoundRankings` (partitions, unscored list, progress, physical filter before lock) plus authz (ACs 1, 2, 8a, 10) → `src/server/modules/judging/rankings.test.ts`.
2. `lockRound`: complete, override, audit, snapshot, event, trigger, transition rows (ACs 3–6, 8b, 9, 10) → `src/server/modules/judging/lock-round.test.ts`.
3. `getRoundOutcomes`/`setRoundOutcomes`: prefill, validation, readiness after lock, audit (ACs 7, 8c, 10) → `src/server/modules/judging/round-outcomes.test.ts`.
4. Preview seed, the three admin views, namespace, ADR and glossary (ACs 11, 13) → `src/server/seed/judging-results.test.ts`.
5. M3 journey plus axe (AC 12) → `tests/e2e/97-m3-blind-scoring.spec.ts`.
