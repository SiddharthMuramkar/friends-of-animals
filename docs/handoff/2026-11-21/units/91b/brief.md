# Brief 91b: M2 Seam 2 journey for both submission scopes

Unit 91b of #91 · M2 · M · risk A (a preview-only control must be inert in production), K · keys none · branch
`ticket/91-journey` · worktree `/root/foa-wt/91b` (not created yet: no stand-alone core) · blocked by 91a (and through it
89b, 87, 85b, 92, #70, #71, #75, #78, #81) · gated for **running** on HR-35, HR-08, HR-06, HR-01, HR-10 (F9).
Sources: #91 body + owner decisions, #55 "Seam 2 … M2: submission and the shortlist for both submission scopes",
`issues-M2.md` §3 #91 / F9, spec §1.4 / §1.8, `residue.md` HR-01/02/06/08/10/35.

## Scope
**In (91b):** `tests/e2e/91-submission-scopes.spec.ts`, two `describe` blocks (all participants, shortlist only) covering
submission and shortlisting end to end on the PR preview, with `expectRendersAccessibly` on every page visited (desktop +
Pixel 7); the preview-only tools that make that possible on a preview with real time: `advanceCompetitionPhase` and
`createJourneyCompetition`, behind `createPreviewTools({ deps, appEnv })`, plus a staff page `/admin/preview-tools`
(namespace `previewTools`); journey support helpers; Seam 1 tests proving the tools are inert outside `preview`/`local`.
**Out:** every product behaviour (85b, 87, 89a, 89b, 91a, 92 own it and their Seam 1 tests); 91a's own axe spec;
`e2e.yml` and `playwright.config.ts` (read-only). No new secret or env var (avoids HR-02).

## Acceptance checks
1. **All participants** (S2): run-scoped competition created through the preview tools (scope `all_participants`, a
   confirmed adult individual registration, an institution with a confirmed minor + guardian contact and a confirmed adult
   student). Adult participant signs in by email code read from the capture mailbox, uploads the JPEG fixture, polls
   (≤ 90 s) until the entry shows `submitted` and its Entry ID. Coordinator submits for the minor and the adult student;
   both reach `submitted`. Staff advances the competition to school judging. Coordinator records a panel, shortlists one
   entry with position 1, attests, finalises; the round page shows it finalised and the entry "submitted to FOA". The
   guardian's capture mailbox has the shortlisted message, the adult student's inbox the not-shortlisted one.
2. **Shortlist only** (S2): run-scoped competition, scope `shortlist_only`. The coordinator's submissions page says
   student submission isn't open; the upload route refuses. Staff advances to school judging. Coordinator creates a
   shortlisted entry for the minor with the fixture, position and all declarations; polls until "upload processed";
   finalises; the entry shows "submitted to FOA". The adult student's family gets the not-shortlisted message (by
   registration); no `not_shortlisted` entry appears anywhere.
3. **axe** (S2): `expectRendersAccessibly` on every page the journey visits, on both projects, plus one `.dark` pass per
   distinct page. No `.disableRules()`, `.exclude()`, `.withTags()`, retries, `skip` or `fixme`.
4. **Isolation** (S2): each run creates its own competitions; codes come from the run id (`test.info()` + a timestamp
   passed through the tool), so reruns on one `foa_pr_<n>` DB never collide or depend on earlier runs.
5. **Inert outside previews** (S1): `createPreviewTools({ ...h.deps, appEnv })` with `production` or `staging` → every call
   `not_found`, nothing written; with `preview`/`local` a super admin (and competition manager) passes, a coordinator,
   participant and visitor get `forbidden`. Each call writes an audit row `preview.phase_advanced` /
   `preview.journey_competition_created`.
6. **Real transitions** (S1): `advanceCompetitionPhase({ competitionCode, to: "school_judging" })` moves the key dates so
   the phase is now, then runs the same flip and consumers the schedule would (#71/#88 flip, 89a `openSchoolRounds`) as the
   system actor; refused with the real guard's error when the guard refuses (no bypass of the rubric guard: the tool
   publishes the seeded rubric first through #88's use case).
7. `/admin/preview-tools` calls `notFound()` unless `APP_ENV` is `preview`/`local`; builds as ƒ; `pnpm build` +
   `check:build` pass. *Gate 2; a Seam 2 visit on preview with axe*

## Files and hotspots
- New: `src/server/modules/preview-tools/{index,advance-competition-phase,create-journey-competition}.ts` +
  `preview-tools.test.ts`; `src/server/modules/preview-tools/domain/phase-dates.ts` + test (pure: key dates that put
  `now` inside a target phase, keeping #70's ordering rules); `src/app/admin/preview-tools/{page.tsx,actions.ts,
  _components/*}`; `messages/en-IN/previewTools.json` (+3 lines `messages.ts`, H3); `tests/e2e/91-submission-scopes.spec.ts`;
  `tests/e2e/support/{journey,fixtures}.ts` (fixture = a small JPEG as a base64 constant: no committed image, no credits
  entry).
- Reuse, don't edit: #57's `tests/e2e/support/{a11y,accounts,mailbox}.ts` (append a helper only if missing). Not composed
  into `as(actor)` and no `deps.ts` edit (no X1): the server action passes `env().APP_ENV` into `createPreviewTools`,
  as #57's capture-mailbox route passes it to `readMailbox`.

## Design (risk-flagged: A; compared with codebase-design)
- **A. Phase-parked seed competitions** (simplest): the preview seed parks one competition per scope in each phase. No
  runtime control, so nothing to secure, but no single entry flows from submission to shortlist ("end to end" fails), and
  a rerun on a persistent preview DB finds the round already finalised.
- **B. Raw date/status editor** (preview-only form writing columns directly). Small, but skips the real flip, guards and
  consumers, so the journey proves less than production does, and it's a sharper production hazard.
- **C. Preview tools that drive the real use cases (chosen).** One small interface, `createPreviewTools({ deps, appEnv })`
  → `{ createJourneyCompetition, advanceCompetitionPhase }`, refusing `not_found` outside `preview`/`local` before
  anything else. Inside: move key dates through the pure `phase-dates` planner, then call the same transition and consumer
  code the schedule runs. The journey creates fresh competitions per run (isolation) and exercises production code paths.
  Deletion test: without it each journey re-implements time travel. Seam: the env gate is one check at the factory, tested
  at Seam 1 with an explicit `appEnv`.
- Worker dependency: uploads reach `submitted` only through the scan + media workers (HR-08, HR-35) and outbox consumers
  via `worker-preview` (HR-10). `advanceCompetitionPhase` runs its consumers in-request (`drain` scoped to the competition,
  if 61a exposes one; otherwise the journey polls ≤ 60 s for the round).

## Interface needs (adopt the real names on M2 at claim)
```ts
// #57 Seam 2 support
signInByEmailCode(page: Page, email: string): Promise<void>;           // tests/e2e/support/accounts.ts + mailbox.ts
readMailbox(request: APIRequestContext, to: string): Promise<{ subject: string; text: string }[]>;
expectRendersAccessibly(page: Page, path: string, opts?: { dark?: boolean }): Promise<void>;  // tests/e2e/support/a11y.ts
// #70 / #71 / #88
createCompetition(ctx: UseCaseContext, i: CompetitionDraft & { digitalScope: "all_participants" | "shortlist_only" }): Promise<{ id: string; code: string }>;
runCompetitionFlip(ctx: UseCaseContext, i: { competitionId: string; to: CompetitionStatus }): Promise<void>; // the scheduled handler, system actor, guards on
publishRubric(ctx: UseCaseContext, i: { competitionId: string; discipline: Discipline }): Promise<void>;
// #75 / #77 / #78 / #81 seed builders
seedConfirmedInstitutionRegistration(deps: SeedDeps, i: { competitionId: string; students: { name: string; dob: string; guardianEmail?: string }[] }): Promise<{ id: string; coordinatorEmail: string; registrationIds: string[] }>;
seedConfirmedIndividualRegistration(deps: SeedDeps, i: { competitionId: string; email: string }): Promise<{ registrationId: string }>;
// 61a: drainFor?(ctx, { aggregateId: string }): Promise<void>   (optional; else poll)
```

## Residue (journey written; **Not run** here: no Postgres server, previews fail at `pnpm db:migrate`)
- HR-35 worker-media deployed (HEIC/JPEG derivatives) and HR-08 ClamAV + scan job: uploads never reach `submitted` without them.
- HR-06 non-prod R2 bucket with CORS `PUT` from preview origins. HR-01 `CAPTURE_MAILBOX_TOKEN` (+ `BETTER_AUTH_SECRET`).
- HR-10 `worker-preview` rebuilt from the M2 tip. HR-02 only if a new env var turns out to be needed (design avoids it).
- HR-28 real-device pass of the journey pages. If G6/G7 aren't cleared when 91b is otherwise done, the unit goes
  `factory:needs-human`; the journey is never disabled.

## Test plan
Seam 1 (`preview-tools.test.ts`): env gate matrix × actors, audit rows, the real flip opens rounds, the rubric guard
still refuses. Vitest: `phase-dates.test.ts` (each target phase, ordering kept, `shortlistSubmissionClosesAt` only when
schools take part). Seam 2: the journey spec on both projects, listed under "Not run" with the HR ids above.

## Slices (size M → 1)
1. Preview tools + journey: `createPreviewTools`, phase-dates planner, admin page, support helpers, the two-scope journey
   (AC 1-7) · `preview-tools.test.ts` + `tests/e2e/91-submission-scopes.spec.ts`.
