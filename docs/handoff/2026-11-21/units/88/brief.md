# Brief 88: Published rubrics gate the school round

| Unit | Issue | Branch | Worktree | Blocked by | Size, flags |
|---|---|---|---|---|---|
| 88 | #88 (M2) | `ticket/88-published-rubrics-gate-the-school` | `/root/foa-wt/88` | #69, #71 (and through them #59, #61, #70a; soft #74, #75) | L · SQL (custom trigger) · no risk flag · no siblings |

Head start already on the branch: `4ef7b71 M2 #88: Add rubric domain core` (base `foa/M0` 442dd99), `src/server/modules/judging/domain/`:
`rubric-status.ts` (draft → published → superseded table, `isRubricEditable`), `rubric-criteria.ts` (draft schema, `publishProblems`,
`defaultRubricCriteria` from `src/content/judging.ts` + showcase copy, 0–10), `rubric-coverage.ts` (guard rule). 35 unit tests. Build on these; don't re-derive them.
Rebase onto `foa/M2` (or whatever trunk holds #69/#71) before slice 1.

## Scope
**In:** the FOA judging module's rubrics (#55 module row "FOA judging: … rubrics (draft → published)"): create, edit, publish, revise per discipline;
DB-enforced immutability; the IN_PROGRESS → SCHOOL_JUDGING guard; the **generic** blocked-flip mechanism (record, tell the manager, automatic re-run);
the coordinator judging guide (framework + published rubrics); audit; seed; three pages; Seam 2 spec.
**Out (owner):** the machine, scheduling, stale-job rule and the other flips (#71); SCHOOL_JUDGING → FOA_JUDGING and its guard (#90, registers on this
mechanism); opening school rounds on entry to SCHOOL_JUDGING (#89a); FOA-round rubrics (#95); scoring per criterion (#96/#97); SMS (#69 flag).
**Runtime check at claim (F7):** `grep -rn "SCHOOL_JUDGING\|school_judging" src/server` on trunk. If #71 already schedules the flip at `submissionClosesAt`,
reuse it and add only the guard; otherwise add the flip row to #71's schedule table. Adopt trunk names for statuses (case), disciplines and routes.

## Acceptance criteria (numbered, with the seam that proves each)
1. A competition manager creates a draft for an enabled discipline (pre-filled with `defaultRubricCriteria()`), edits it, and publishes it. Seam 1.
2. A published rubric is read-only: `updateRubricDraft` on it fails `rubric_not_editable`; a direct UPDATE/DELETE raises from the trigger, asserted through the use case's error mapping. Seam 1.
3. `startRubricRevision` copies the published criteria into draft v+1; publishing it marks v `superseded` in the same transaction; old criteria unchanged. Seam 1.
4. Publishing with problems (`no_criteria`, `weights_total`) fails and names them; nothing changes. Seam 1.
5. Rubric transition table: every allowed and forbidden pair. Unit (done, `rubric-status.test.ts`).
6. Competition IN_PROGRESS with DRAWING + ESSAY, only DRAWING published: `clock.set(submissionClosesAt)`, `drain()` → status stays IN_PROGRESS; one unresolved
   `competition_transition_block` with `missingDisciplines: ["ESSAY"]`; audit row with the system actor. Competition transition table row: IN_PROGRESS → SCHOOL_JUDGING allowed only with the guard passing. Seam 1.
7. In the same run the scoped and the global competition managers get the `competition_transition_blocked` message naming ESSAY (email fake + in-app inbox); a second drain doesn't repeat it. Seam 1.
8. Publishing ESSAY's rubric, then `drain()` with no clock movement → SCHOOL_JUDGING, block resolved, normal status-change audit. Publishing the first of two missing rubrics leaves it blocked. Seam 1.
9. If `submissionClosesAt` was moved into the future after the block, publishing doesn't flip early; the rescheduled job does. Seam 1.
10. An individuals-only competition is blocked and then passes exactly the same way (owner, 2026-11-19). Seam 1.
11. `publishRubric` writes one audit row (`rubric.published`, entity `rubric`, before/after `{status, version}`). Seam 1.
12. A coordinator of an institution registered for the competition reads `getJudgingGuide`: the published rubric per enabled discipline (drafts never shown). Seam 1; the framework copy renders on the page (Seam 2).
13. Authz, allow + deny per use case: manager (competition-scoped or global) passes; a manager scoped to another competition, a coordinator, a member fail
    for the write cases; for `getJudgingGuide`, a coordinator of an unregistered institution, a participant and a visitor fail. Seam 1.
14. axe clean (light + `.dark`) on the two admin rubric pages and the judging-guide page. Seam 2 (written, **Not run** here).
15. Preview seed: one competition with every rubric published, one with ESSAY missing, one discipline with a superseded v1 + published v2 + draft v3. Seam 1 (seed test).

## Files
- New: `src/server/db/schema/judging.ts` + one barrel line (H1); one generated migration `88_rubrics`, one custom `88_rubric_immutability` (H2); `src/server/modules/judging/**`
  (use cases, `guards.ts` exporting `schoolJudgingNeedsPublishedRubrics`); `src/server/seed/judging.ts` + one line (H6);
  `src/app/(staff)/admin/competitions/[code]/rubrics/{page.tsx,[discipline]/page.tsx,_components/*}`; `src/app/institution/competitions/[ref]/judging-guide/page.tsx` (H27);
  `messages/en-IN/{adminRubrics,judgingGuide}.json` + 3 lines each in `src/i18n/messages.ts` (H3); `tests/e2e/88-rubrics.spec.ts`.
- Generic mechanism (H24, #88 owns the guard part): `src/server/modules/competitions/transition-guards.ts` (guard list, `attemptCompetitionTransition`,
  retry consumer) and schema `competition_transition_block` in a new `schema/competition-transitions.ts` (keeps H17 untouched).
- Append-only touches: `can()` action table (H8), outbox event union + consumer registry + event→template seed (H9), admin/institution nav (H19), app-routes.
- Serialize with: #84a (H9, H19 unions), #90 (H24, after us by dependency), #89a (H27 subfolders).

## Design (compared with `codebase-design` vocabulary)
- **A. Guard list + block record + guard-declared re-run (chosen).** Competitions owns one deep module: `attemptCompetitionTransition` runs the
  guards for (from, to), records/resolves `competition_transition_block`, emits `competition.transition_blocked` once, audits as system. Each guard
  declares `retryOn` events; the competitions consumer re-attempts unresolved blocks whose due instant (current date column) has passed. Judging exports one
  guard and emits only its own `rubric.published`. #90 adds one guard line and gets block/notify/re-run free (leverage); blocked-flip logic in one place (locality).
- B. Direct check in the flip handler, re-enqueue the scheduled job on publish. Least code, but competitions imports judging queries, "told" leaves no record
  for the admin page, and #90 copies the re-run (shotgun surgery). Fails the deletion test in reverse: deleting it would scatter nothing; adding #90 would.
- C. No block table: derive "blocked" from status + date + guard, dedupe the notice by outbox key. Hidden state; admin page must recompute guards; dedupe key brittle.
- Dependency direction: judging imports only the schema barrel (never the competitions module); competitions' guard list imports judging's guard. No port:
  everything is in-process or PGlite (local-substitutable), so no new seam with one adapter.
- Judging framework = messages namespace `judgingGuide` (copy, HR-36), drafted from `schools.json`/`showcase.json`; not DB content.
- Schema: enum `rubric_status` with all three values now (F2). `rubric` (id, competition_id fk, discipline, version, status, created_by, created_at,
  updated_at, published_by, published_at); unique (competition_id, discipline, version); partial uniques `WHERE status='draft'` and `WHERE status='published'`
  via drizzle `uniqueIndex().where()`; `rubric_criterion` (id, rubric_id fk, position, label, description, weight, min_score, max_score) with CHECKs mirroring
  `rubric-criteria.ts`; unique (rubric_id, position). Custom trigger: rubric UPDATE allowed when `OLD.status='draft'`, or only `status` published→superseded;
  DELETE only of drafts; any criterion write refused unless its rubric is a draft. `competition_transition_block` (id, competition_id, from/to status, reason text
  from a zod registry, details jsonb, blocked_at, resolved_at), partial unique (competition_id, to_status) `WHERE resolved_at IS NULL`.
- Defaults (reversible, recorded): drafts save half-finished, publish needs weights = 100; no publish/revise once the competition is in SCHOOL_JUDGING or later
  (`rubric_locked_by_judging`); zero enabled disciplines = covered (can't happen, #70 needs ≥1); coordinator read = institution with a non-cancelled registration.

## Interface needs (what this unit codes against; adapt names at claim)
```ts
// #70a / #71: competition, statuses, disciplines, schedule
type CompetitionStatus = "IN_PROGRESS" | "SCHOOL_JUDGING" | …;         // enum competition_status must already hold SCHOOL_JUDGING
type Discipline = "DRAWING" | "PAINTING" | "ART" | "CRAFT" | "ESSAY" | "PHOTOGRAPHY" | "VIDEOGRAPHY";
// schema: competition { id, code, name, status, submissionClosesAt: Date, disciplines (column or competition_discipline rows) }
function transitionCompetition(tx: AppDb, input: { competitionId: string; to: CompetitionStatus; actor: Actor }): Promise<void>; // status + audit + event
// schedule row: { from: "IN_PROGRESS", to: "SCHOOL_JUDGING", dueAt: (c) => c.submissionClosesAt }; job data { competitionId, to, dueAt }; stale if dueAt ≠ column
// #71 (extended here, H24)
type GuardOutcome = { pass: true } | { pass: false; reason: string; details: Record<string, unknown> };
interface CompetitionTransitionGuard { from: CompetitionStatus; to: CompetitionStatus; retryOn: readonly OutboxEventType[];
  check(db: AppDb, competition: { id: string; status: CompetitionStatus; disciplines: readonly Discipline[] }): Promise<GuardOutcome>; }
// #59: policy and audit
function can(actor: Actor, action: "rubric.manage" | "judgingGuide.read", resource: { type: "competition"; id: string }): Promise<boolean>;
const AuditLog: { write(tx: AppDb, e: { action: string; entityType: string; entityId: string; before: unknown; after: unknown }): Promise<void> }; // system actor allowed
// roles used: competition_manager (competition or global scope), institution_coordinator (institution scope)
// #61: outbox + jobs + drain
function emit(tx: AppDb, e: { type: "rubric.published"; aggregateId: string; payload: { competitionId: string; discipline: Discipline; version: number } }): Promise<void>;
// consumer registry: register("rubric.published", handler); harness.drain()
// #69: event → message map row + template; recipients = role-scoped resolver
// { event: "competition.transition_blocked", template: "competition_transition_blocked", channels: ["email", "in_app"],
//   recipients: { role: "competition_manager", scope: { type: "competition", id: payload.competitionId }, includeGlobal: true } }
// #75 (soft): function isCoordinatorOfRegisteredInstitution(db: AppDb, userId: string, competitionId: string): Promise<boolean>;
```

## Residue
- HR-36 (G3): judging framework text and the `competition_transition_blocked` wording; FOA signs off. Agent drafts from existing site copy.
- HR-37 (G5): weights must total 100; default range 0–10; at most 10 criteria; revisions locked once school judging starts; which registration states count as "registered".
- HR-14: n/a by default (staff notice goes by email + in-app, no SMS form, so no DLT template). Reopen only if FOA wants it by SMS.
- Operational, not residue: managers enter the real rubrics in the app.

## Test plan
- Unit (done): rubric transitions, criteria rules, defaults, coverage.
- Seam 1 (`createHarness()`, PGlite, fake clock, `drain()`): one file per slice below; authz allow + deny per use case; trigger proven via the use case.
- Seam 2: `tests/e2e/88-rubrics.spec.ts`: seeded manager edits + publishes on both admin pages; seeded coordinator opens the judging guide; `expectRendersAccessibly`
  light + dark on all three. **Not run** here (no Postgres server; previews fail at `pnpm db:migrate`).

## Slices (ordered; each = one behaviour, one test file)
1. Rubric drafts, publishing, immutability, revisions, audit (ACs 1–4, 11, 13 writes) → `src/server/modules/judging/rubrics.test.ts`.
2. School-judging guard + blocked-flip record + manager notice (ACs 6, 7, 10 blocked half) → `src/server/modules/competitions/transition-guards.test.ts`.
3. Automatic re-run on publish, date-moved case (ACs 8, 9, 10 passing half) → `src/server/modules/judging/school-judging-rerun.test.ts`.
4. Coordinator judging guide read + authz (ACs 12, 13 reads) and preview seed (AC 15) → `src/server/modules/judging/judging-guide.test.ts`, `src/server/seed/judging.test.ts`.
5. Pages, namespaces, nav, Seam 2 spec + axe (AC 14) → `tests/e2e/88-rubrics.spec.ts`.
