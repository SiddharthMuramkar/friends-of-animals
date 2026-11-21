# Unit 71: the schedule changes competition status automatically (#71, M1)

Branch `ticket/71-the-schedule-changes-competition-status`, worktree `/root/foa-wt/71`, base `foa/M0` 442dd99 (no `M1` yet: rebase onto `foa/M1` once 70a and 61a are in it). Size L, risk false, key X9. Blocked by **61a** (outbox, jobs, drain) and **70a** (competitions module). No siblings. Head start on the branch: `f575be4 M1 #71: Add competition status machine domain core` (pure core, 63 Vitest cases, `pnpm check` green).

## Scope
- **In:** two new statuses, `registration_open` and `registration_closed`, in their own migration. Status jobs scheduled when a competition is published or its dates are edited. A system-only use case that runs a status job: it ignores stale jobs, catches up every passed step and writes an audit row per move. Status label and an honest countdown on the public list, the public detail page and the admin competition page. Preview seed with a competition in each status.
- **Out:** the school-judging, FOA-judging, results and archived states (M2 and later reuse `RULES` in `status-schedule.ts`). `cancelled` belongs to #80. 70b owns the public pages and their DB read model and caching; this unit adds one status-and-countdown element to them. 61b deploys the worker (HR-07). Reminders (#84) reuse `isStale` and the job shape.
- **Decisions (reversible, recorded here):** status only ever moves forward. Editing a date that has already passed never moves the status back. A moved date leaves its old job queued; that job sees it is stale and does nothing, so nothing is ever cancelled in pg-boss. Every key date that is set gets a job, even one no status change depends on yet, so later tickets need only add a rule.

## Acceptance criteria → testable checks
1. **Opens and closes on time** (Seam 1). Publish with open at T1 and close at T2, both later than now. Draining before T1 changes nothing. `h.clock.set(T1)`, then drain: the status is `registration_open`. Set the clock past T2 and drain: the status is `registration_closed`.
2. **Rescheduling** (Seam 1). After publishing, `updateCompetition` moves open from T1 to T1+1d. At T1, drain: still `published`, no audit row (the old job is stale). At T1+1d, drain: `registration_open`. A date moved earlier opens at the new instant, and the old job then does nothing.
3. **Transition table** (unit plus Seam 1). Done: `status-machine.test.ts` checks every ordered pair of statuses for both causes (manager, schedule). Seam 1: a job for a draft does nothing, and no use case lets a person set `registration_open` or `registration_closed`.
4. **Audit by the system** (Seam 1). Each automatic move writes exactly one `audit_log` row: system actor, action `competition.status_changed`, `before {status}`, `after {status, keyDate, at}`. Publishing after both dates have passed writes 2 rows in order on the first drain. Draining twice adds no rows.
5. **Public pages show the status** (Vitest on the pure helper, plus Seam 2). The chip shows the stored status as icon plus word. The countdown shows the absolute IST time and a relative phrase. When `upcomingChange` returns `due`, it says "opening shortly" instead of a negative time. Seam 2 `tests/e2e/71-competition-status.spec.ts` runs `expectRendersAccessibly` on `/competitions` and one detail page per seeded status (**Not run** here).
6. **Seam** (meta). All behaviour goes through `h.as(actor).<useCase>` on PGlite with real migrations, `h.clock` and `h.drain()`.
7. **Authorization** (Seam 1). `advanceCompetitionStatus` works as `{kind:"system",process:"worker"}`. As a competition manager, as a member and as a visitor it returns `forbidden`, and no status or audit row changes. 70a's authz tests for publish and update stay green.
8. **Seed** (Seam 1). `seedPreview` adds one competition per status: draft, published, registration_open, registration_closed. Each one's dates agree with its status at the seed clock (so draining changes nothing). Running it twice gives the same rows.

## Files
- New: `src/server/modules/competitions/domain/{status-machine,status-schedule}.ts` plus tests (**done**). Also `src/server/modules/competitions/status-jobs.ts` (emit plus handler), its tests, `src/components/competitions/status-countdown.tsx` with a pure `countdown-text.ts` and test, `messages/en-IN/competitionStatus.json` (new namespace, not the shared `competitions.json`), `tests/e2e/71-competition-status.spec.ts`, and one generated migration `71_competition_status_schedule` holding only `ALTER TYPE … ADD VALUE` (never used in DDL).
- Touch (X9, held): 70a's `schema/competitions.ts` (append enum values; import `COMPETITION_STATUSES` and `KEY_DATE_KINDS` from `domain/`, or rename the domain lists to 70a's names), 70a's publish and update use cases (one emit call each, inside their transactions), 70a's admin competition page (next change), and 70a's seed file.
- Merge-ordered: the job/handler registry (61a; shared with 69, 80), the `can()` table, `src/i18n/messages.ts` (3 lines), the seed barrel, and the public `/competitions` and `[slug]` pages (70b; whichever merges second rebases and keeps the other's read model).
- Never: `src/test/harness.ts`, `deps.ts` (X1, 61a's), `src/proxy.ts`, `next.config.ts`.

## Chosen design (codebase-design vocabulary; three candidates)
- **A. One delayed job per instant, carrying `dueAt` (chosen).** Publish emits `statusJobs()` and an edit emits `rescheduledJobs()`, as outbox rows with `availableAt = dueAt` in the same transaction. The handler calls `planStatusJob()`, which returns `stale`, `early` (re-emit at `dueAt`) or `advance(transitions)`. It matches the ticket's words ("jobs are scheduled… editing a date reschedules its job") and AC2 directly. The flip happens on the instant, so the countdown stays honest.
- **B. A periodic tick** (pg-boss schedule every minute that reconciles every competition from its dates). Idempotent by construction, but it flips up to a minute late, scans every competition each minute, needs the drain to fire schedules, and gives #84's reminders no per-instant job to hang on. Rejected.
- **C. A plus a tick as a safety net.** A already handles a worker that is down: overdue jobs run on restart and catch up every step. A second adapter with no failure to cover is a hypothetical seam. Rejected; it can be added later behind the same `dueTransitions()`.
- **Depth.** The module's interface is three functions: `statusJobs`, `rescheduledJobs` and `planStatusJob`, plus `upcomingChange` for pages. Behind it sit the rules table, staleness, early runs, ordering-independent catch-up and forward-only moves, all pure (locality: one table that later tickets append to). The use case is a thin adapter: load `FOR UPDATE`, plan, apply, audit.
- **Caching note for 70b.** The worker can't call `revalidateTag`, so public status freshness rests on `cacheLife` of 300 s or less (as `cachedNow`). The `due` state covers the gap honestly. The countdown is server-rendered with no client island (no CSP or JS-budget cost).

## Interface needs (signatures to code against; adapt names to what landed)
```ts
// 61a outbox / jobs
emit(tx: AppDb, e: { type: "competition.status_due"; aggregateType: "competition"; aggregateId: string;
  payload: { competitionId: string; kind: KeyDateKind; dueAt: string /* ISO */ }; availableAt?: Date }): Promise<{ id: string }>;
JOB_HANDLERS["competition.status_due"] = (deps: Deps, payload) =>
  createApp(deps).as({ kind: "system", process: "worker" }).advanceCompetitionStatus(payload);
h.drain(): Promise<unknown>; // runs rows whose available_at <= h.clock.now(); if 61a ignores availableAt, `early` re-emits
// 70a competitions
pgEnum("competition_status", ["draft", "published"]); // 71 appends 2 values
competitionKeyDate { competitionId: uuid; kind: KeyDateKind; at: timestamptz } // unique (competition_id, kind)
publishCompetition(i: { competitionId: string }); updateCompetition(i: { competitionId: string; keyDates: { kind: KeyDateKind; at: string }[]; … });
loadForUpdate(tx: AppDb, id: string): Promise<{ id: string; status: CompetitionStatus; keyDates: KeyDates } | null>;
// 59a access / audit
can(actor: Actor, "competition.advance_status", { type: "competition"; id: string }): boolean; // system only
AuditLog.write(tx: AppDb, { actor: Actor; action: string; entityType: "competition"; entityId: string; before: object | null; after: object | null }): Promise<void>;
// must accept actor.kind === "system" (actor_type system, actor_id null); else 71 adds that in its migration
```

## Residue
- **HR-07**: worker roles, secrets and `docker/workers.yml` on the VPS (owner). Until then no status moves outside Seam 1.
- **HR-10/M1**: rebuild `worker-preview` from the M1 tip so the `competition.status_due` handler runs on previews (preview skew).

## Test plan
- Unit (done): `domain/status-machine.test.ts` (every pair × cause), `domain/status-schedule.test.ts` (jobs, reschedule, stale, early, catch-up, countdown).
- Seam 1: `src/server/modules/competitions/status-jobs.test.ts` (ACs 1, 3, 4, 7), `reschedule-status.test.ts` (AC 2, plus publishing after the dates pass), `src/server/seed/competition-statuses.test.ts` (AC 8). Use the fake clock only, never sleeps.
- Pure UI: `src/components/competitions/countdown-text.test.ts` (scheduled, due, null; IST absolute time).
- Seam 2 (**Not run**: no Postgres, previews fail at `pnpm db:migrate`): `tests/e2e/71-competition-status.spec.ts`, light and dark.
- Gates: `pnpm check`; `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build` (public pages stay ○/◐); `git status --porcelain` empty.

## Slices (in order; each is one behaviour and one test file)
0. **Done (f575be4):** status machine and schedule planning, pure.
1. **Publishing schedules jobs; the drain opens and closes registration** with a system audit row; system-only authz. Enum migration, `status-jobs.ts`, handler registration, the emit in `publishCompetition`. → `status-jobs.test.ts` (ACs 1, 3, 4, 7).
2. **Editing a date reschedules:** the emit in `updateCompetition`; stale old jobs; catch-up when publishing late; idempotent drain. → `reschedule-status.test.ts` (AC 2).
3. **Seed has a competition in each status**, with dates consistent with its status. → `competition-statuses.test.ts` (AC 8).
4. **Status chip and honest countdown** on the public list and detail page and the admin page; `competitionStatus` namespace; Seam 2 spec. → `countdown-text.test.ts` plus `tests/e2e/71-competition-status.spec.ts` (AC 5).
