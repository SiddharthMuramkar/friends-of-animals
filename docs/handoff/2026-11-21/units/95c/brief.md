# 95c: Round pool, assignment and conflict refusals

| Unit | Issue | Branch | Worktree | Blocked by | Size, flags |
|---|---|---|---|---|---|
| 95c | #95 (M3) | `ticket/95-assignment` | `/root/foa-wt/95c` | 95b (and through it 95a, #94); extras #92 (FOA-verified status), #85b entries, #75 institution registrations, #78/#81a profiles + guardian links, #59a roles | M · risk (blind-judging leaks, minors) · no conflict key |

**Head start on the branch:** `5151e09 M3 #95: Add round pool and assignment domain core` (base `foa/M0` 442dd99), `src/server/modules/judging/domain/`:
`conflicts.ts` (`conflictSources`, `isConflicted` over judge ties × entry facts), `pool-admission.ts` (`decidePoolAdmission`), `assignment.ts`
(`decideAssignment`, fixed refusal order). 27 unit tests. Rebase onto `foa/M3` after 95b merges.

## Scope
- **In (95c):** tables `round_entry` (pool) and `round_assignment`; staff entry-level conflicts (`judge_conflict` rows with source `staff`, table
  from 95b); automatic conflicts read live; use cases `admitToPool`, `getRoundPool`, `assignEntries`, `unassignEntry`, `flagConflict`,
  `listAssignments`, `listRoundConflicts`; the set-based loaders `loadJudgeConflictFacts`, `loadEntryConflictFacts` and `conflictedEntryIds` exported
  for #96's read-time check; audit; seed; admin tabs Pool, Assignments, Conflicts on `/admin/judging/rounds/[id]`.
- **95a owns:** rounds. **95b owns:** invitations, onboarding, the declaration, `loadJudgeReadiness`, `judge_conflict` (schema + `declared` rows).
- **Out:** removing an entry from a pool (default: not offered; #97 filters entries whose artwork leaves "ready"), balanced auto-distribution
  (old spec `minJudgesPerEntry`; not in the ticket), participation-consent gating (#82, not a #95 AC), scoring and the blind views (#96).

## Acceptance criteria (numbered, with the seam that proves each)
1. Physical round: `admitToPool({ roundId, entryIds })` admits an entry whose artwork is verified, and refuses one in `discrepancy` and one with no
   artwork (`not_physically_ready`) and an entry not FOA-verified (`not_foa_verified`); result `{ admitted: n, refused: [{ entryId, reason }] }`.
   Non-physical round admits every FOA-verified entry regardless of artwork. Omitting `entryIds` admits every eligible entry of the competition;
   repeating is a no-op (unique round+entry). Draft or open rounds only (`round_closed`). (S1) — ticket AC 5
2. Judge J declared institution X: `assignEntries({ roundId, judgeUserId: J, entryIds: [eX, eY] })` → eY assigned, eX refused `{ entryId, reason:
   "conflict" }`; the serialised result contains no participant name, school, city or registration number (string search over the JSON). (S1) — ticket AC 4
3. Automatic conflicts, with nothing declared: J holds `institution_coordinator` (or `institution_admin`) at Z → Z's entries refused; J is an active
   guardian of participant P → P's entries refused; J's own participant profile's entry → refused. A role granted to J *after* onboarding still
   refuses. (S1)
4. `flagConflict({ roundId, judgeUserId, entryId, note? })` (staff, after reading J's statement) → later assignment of that pair refused; an existing
   assignment of the pair is deleted in the same tx; audit `judging.conflict_flagged` (note kept out of the audit log). (S1)
5. A judge who is not ready (no round role, role but onboarding incomplete, removed) → the whole call fails `judge_not_ready`, no rows. (S1) — ticket AC 3 (assignment half)
6. Entry not in the pool → `not_in_pool`; already assigned → counted `already_assigned`, no duplicate; locked/cancelled round → `round_closed`. (S1)
7. Omitting `entryIds` assigns J every non-conflicted pool entry; the result gives counts (`assigned`, `conflicted`, `alreadyAssigned`) and no ids for
   conflicted entries. (S1)
8. Isolation: an entry in round A's pool can't be assigned in round B until admitted to B; a judge of A is `judge_not_ready` in B. (S1)
9. `unassignEntry` removes one pair (audited); `listAssignments` and `getRoundPool` show code, category, discipline, admitted/assigned at and per-entry
   assignment counts; `listRoundConflicts` shows each judge's declared institutions, statement and staff flags (staff only). (S1)
10. Audit rows: admit (one row per call, admitted ids), assign (one per call, pairs), unassign, flag. (S1)
11. Authorization per use case: manager scoped to the round's competition and global manager ✓; judge, content manager, member, manager of another
    competition ✗; reads also staff admin ✓. (S1) — ticket AC 8
12. Seed: the open round's pool holds the seeded verified artworks' entries; the onboarded judge is assigned every non-conflicted one; one declared
    institution conflict leaves one entry unassigned. Idempotent. (S1)
13. axe clean (light + `.dark`, desktop + mobile) on the Pool (with a refused list), Assignments and Conflicts tabs. (S2, written, **Not run**) — ticket AC 9

## Files
- **New:** append `round_entry` and `round_assignment` to `src/server/db/schema/judging-rounds.ts` (95a's file; serial natively, H22); one generated
  migration `95_round_assignment` (H2); `src/server/modules/judging/assignment/{admit,assign,flag,read,conflict-facts,index}.ts` + test;
  `src/server/seed/judging-assignment.ts` + one line (H6); `src/app/(staff)/admin/judging/rounds/[id]/{pool,assignments,conflicts}/page.tsx` +
  `_components/*` + three tab entries; `adminJudging` keys; `tests/e2e/95-round-assignment.spec.ts`.
- **Append-only:** `app.ts`, `can()` policy (H8). No enum changes (the `staff` source exists from 95b).

## Design (risk-flagged; tournament angles from issues-M3-M4 compared with `codebase-design`)
- **A. Conflicts as rows:** institution-level + staff entry-level rows, plus automatic rows written when memberships/guardianships are created.
  Easy to list, but automatic rows go stale (a coordinator added later never gets a row unless every role grant and guardian link writes one: a
  cross-module coupling into #59, #74 and #81).
- **B. Conflict as a pure function** over (judge facts, entry facts), evaluated at assignment and at read time. Always current; nothing to sync.
- **Chosen: B, with the human statements as rows.** Declared institutions (95b) and staff flags are facts with provenance, so they stay rows;
  institution roles, guardianships and own profiles are read live. All five meet in one pure function (`conflictSources`, done). Two loaders make it
  set-based (no N+1): one query per tie kind for the judge, one join for the entries in question. #96 calls `conflictedEntryIds(db, roundId,
  judgeUserId)` before listing or showing assignments, so a tie made after assignment still hides the entry.
- **Tables:** `round_entry` (round_id FK, entry_id FK, admitted_by, admitted_at; PK both); `round_assignment` (round_id, judge_user_id, entry_id,
  assigned_by, assigned_at; PK triple; FK (round_id, entry_id) → `round_entry`). The FK makes "assigned but not in the pool" impossible in the DB.
- **Assignment write:** lock the round row `FOR UPDATE` (status check), load readiness (95b) + facts, `decideAssignment` per entry (done), insert the
  allowed pairs `ON CONFLICT DO NOTHING`, one audit row. The refusal order (round → judge → pool → conflict → duplicate) means an outsider learns
  nothing about conflicts.
- **Defaults (reversible, write in PR):** pool and assignment work in draft and open rounds; a physical round also requires FOA verification
  (defensive: physical artwork is only requested for verified entries); every judge may score every entry they're assigned (no per-category judge
  limits); managers see conflict sources, judges never; flagging a conflict removes the pair's assignment (#96 must refuse once a score exists).

## Interface needs (code against these; adopt trunk names at claim)
```ts
// 95a / 95b
const judgingRound: PgTable<{ id; competitionId; status: JudgingRoundStatus; judgesPhysical: boolean }>; acceptsJudges(status): boolean;
loadJudgeReadiness(db: AppDb, i: { judgeUserId: string; roundId: string }): Promise<JudgeReadiness>;
const judgeConflict: PgTable<{ id; roundId; judgeUserId; institutionId: string | null; entryId: string | null; source: "declared" | "staff"; note: string | null; createdBy; createdAt }>;
// #94 physical readiness (set-based)
physicallyReadyEntryIds(db: AppDb, competitionId: string): Promise<Set<string>>;   // status ∈ {verified, on_exhibition, retained}; no artwork → absent
// #85b entries + #92 verification
const entry: PgTable<{ id; code; competitionId; participantProfileId; institutionRegistrationId: string | null; categoryKey; disciplineKey; status: EntryStatus }>;
// foaVerified ⇔ status === "foa_verified" (#92)
// #75 registrations, #78 profiles, #81a guardians
const institutionRegistration: PgTable<{ id; institutionId: string; competitionId: string }>;
const participantProfile: PgTable<{ id; ownerUserId: string | null; loginUserId: string | null }>;
const guardian: PgTable<{ id; userId: string }>; const guardianLink: PgTable<{ guardianId; participantProfileId; revokedAt: Date | null }>;
// #59a
scopesOfRoles(db: AppDb, userId: string, roles: Role[], scopeType: "institution"): Promise<string[]>;  // or a direct user_role query
authorize(ctx, action, { scopes: [{ type: "round", id }, { type: "competition", id }] }); recordAudit(tx, ctx, e);
```

## Residue
- None ticket-specific. Conflict-of-interest wording is HR-39 (95b). Defaults above go in the PR body (append to HR-40 if FOA wants them reviewed).
- HR-28: real-device checks of the three tabs.

## Test plan
- Unit (done): every conflict source and their order, institution ties never matching individual entries, pool admission truth table (8 rows),
  assignment refusal order.
- Seam 1 (`createHarness()`, fake clock): `src/server/modules/judging/assignment/assignment.test.ts` with a world of two institutions, an
  individual entrant, a guardian-judge, a coordinator-judge, verified / discrepancy / no-artwork entries (#93/#94 builders), two rounds; JSON
  no-PII string search for AC 2.
- Seam 2: `tests/e2e/95-round-assignment.spec.ts` — manager admits, assigns, sees a refused conflict; `expectRendersAccessibly` light + dark on
  the three tabs. **Not run** here. The M3 journey that uses these assignments is #97's.

## Slices (size M → 1)
1. Pool, conflicts and assignment end to end: schema + migration, seven use cases, loaders, audit, authz, seed, three tabs, Seam 2 spec
   (ACs 1–13) → `src/server/modules/judging/assignment/assignment.test.ts`.
