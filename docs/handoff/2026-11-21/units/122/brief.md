# Brief 122: Ambassadors (#122, M6)

Branch `ticket/122-ambassadors` · worktree `/root/foa-wt/122` · cut from `foa/M0` 442dd99 (rebase onto `foa/M6` at build) · size M · risk (PD; minors if the age floor is lowered) · keys none · blocker **119** (Community module, `recordEngagement`, `/admin/community` layout); through it and the ticket body: 62 (settings), 69 (messages), 59a (`can()`/audit), 61a (outbox), 114 (inventory), 78 (`ageAt`). No siblings: unit 122 is the whole issue.
Sources: #122 body (no comments); #55 has no M6 decision; `issues-M6-M8.md` #122 + §0.2/§0.3; spec §1.9–1.11; #119 brief + head start `ea2df05`.
**Head start on the branch:** `d24f207 M6 #122: Add ambassador application domain core` (62 tests, `pnpm check` green): the pure core in `src/server/modules/community/ambassadors/domain/` (see "Pure core"). Keep it and build on it.

## Scope
**In:** `ambassador_application` table and enum; use cases `getAmbassadorEligibility`, `applyForAmbassador`, `withdrawAmbassadorApplication`, `listAmbassadorApplications`, `getAmbassadorApplication`, `approveAmbassador`, `declineAmbassador`; 3 settings keys (+ the `choices` kind and `years` unit in #62's definitions); the ambassador milestone through #119's `recordEngagement`; `ambassador.approved` / `ambassador.declined` messages (email + in-app) through #69's routes; inventory rows + one retention policy; preview seed; pages `/dashboard/ambassador`, `/admin/community/ambassadors`, `/admin/community/ambassadors/[applicationId]`; namespace `ambassadors`; e2e spec.
**Out:** the ladder, timeline and `/admin/community` layout (**#119**); the volunteer milestone the default rule reads (**#124**); revoking an ambassador (not asked; milestones are history per #119); guardian consent for under-18 applicants (only needed if FOA lowers the age floor, see HR-57); ambassador perks, badges and public profiles; a staff alert on new applications (the queue shows them).

## Acceptance criteria as testable checks
1. **Ineligible can't apply; rule named** (pure + S1). Truth table, each threshold failing alone: not a member, member for < `minMembershipDays`, age < `minAgeYears`, no date of birth on record, none of `qualifyingMilestones`, already an ambassador, open application → `applyForAmbassador` returns `{ ok:false, error:"not_eligible", failing:[<rule>] }` and writes nothing. All passing → one `submitted` row with `eligibility_at_apply` snapshot, audit `ambassador.applied`, outbox `ambassador.applied`.
2. **Thresholds come from settings** (S1). `changeSetting("ambassador.minMembershipDays", 30)` turns a 45-day member from ineligible to eligible on the next `getAmbassadorEligibility`, with no restart; same for `minAgeYears` and `qualifyingMilestones` (empty list = no milestone needed).
3. **Approve adds the milestone** (S1). `approveAmbassador({ applicationId })` → status `approved`, `closed_at`, `decided_by`, `eligibility_at_decision`; one `ambassador` milestone keyed by the applicant's user and its `milestone.ambassador` timeline entry (via `recordEngagement`), audit, outbox `ambassador.approved`; after `h.drain()` the applicant has the approved email + inbox item. Re-approving → `transition_not_allowed`, still one milestone. Recheck fails (e.g. left the community) → `no_longer_eligible`, nothing written.
4. **Decline records a reason and tells the applicant** (S1). No/blank reason → `invalid_input` (`reason_required`); > 1000 chars → `reason_too_long`; valid → status `declined`, `decision_reason` stored trimmed, audit, outbox `ambassador.declined`; after `h.drain()` the applicant's inbox and email carry the reason. No milestone.
5. **Transition table** (pure + S1). Every (status × decision) pair: only `submitted` → approve/decline/withdraw moves; every other pair → `transition_not_allowed`. Withdraw by the applicant closes the application; they may apply again (new row; the partial unique index allows one open row per user).
6. **Authorization, every use case** (S1). `applyForAmbassador`/`withdraw…`/`getAmbassadorEligibility`: signed-in member allowed, visitor `forbidden`; withdrawing someone else's application → `not_found`. `list…`/`get…`/`approve…`/`decline…`: `community_manager` allowed; plain member, `staff_admin`, the applicant on their own application and a visitor → `forbidden`.
7. **One open application** (S1). Two `applyForAmbassador` in `Promise.all` → one row, the other `not_eligible` (`no_open_application`) or the unique violation mapped to it.
8. **Inventory** (S1, #114 coverage test). Entries for `motivation`, `decision_reason`, `user_id`, `decided_by_user_id`, both snapshots; the rest on `NON_PERSONAL`. Retention policy `community.ambassador_application`: declined/withdrawn rows deleted 365 days after `closed_at`; approved kept for the account's life. All `toConfirm`.
9. **Seed** (S1). `h.seed.preview()` twice: one eligible member with no application, one ineligible (joined 10 days ago), one `submitted`, one `declined` with a reason, one approved ambassador with the milestone; identical rows both times.
10. **axe** (S2, written, **Not run**). `tests/e2e/122-ambassadors.spec.ts`: eligible member applies, community manager declines with a reason, member sees the reason in the inbox; ineligible member sees which rule fails; `expectRendersAccessibly` light + dark on all three pages; no horizontal scroll at 320 px.

## Files
- **Exists (head start):** `src/server/modules/community/ambassadors/domain/{application-status,eligibility,inputs}.ts` + tests.
- **New:** `src/server/db/schema/ambassadors.ts` (`ambassador_application_status` enum (4 values, complete up front); `ambassador_application`: id uuidv7, user_id FK, motivation text, status, eligibility_at_apply jsonb, eligibility_at_decision jsonb null, submitted_at, decided_by_user_id FK null, decided_at null, decision_reason null, closed_at null, created_at, updated_at; `uniqueIndex(user_id) WHERE closed_at IS NULL`; index `(status, submitted_at)`; CHECKs on lengths only). The partial-index predicate uses `closed_at`, not an enum literal, so the F2 question never arises. One migration `--name 122_ambassadors`, no custom SQL.
- `src/server/modules/community/ambassadors/{index,eligibility-facts,apply,decide,queries,use-cases,events,retention}.ts` + Seam 1 tests; `src/server/seed/ambassadors.ts`; `messages/en-IN/ambassadors.json`; `src/app/dashboard/ambassador/**`; `src/app/admin/community/ambassadors/{page.tsx,[applicationId]/page.tsx,actions.ts,_components/*}`; `tests/e2e/122-ambassadors.spec.ts`.
- **Hotspots (one line or entry each):** schema barrel (H1); `seed/index.ts` after #119's seeder (H6); `app.ts` (`ambassadorUseCases`); #62 catalogue + `definition.ts` (`choicesSetting`, `"years"` unit) + `adminSettings` labels (H7); #59 policy table (`community.ambassador.{apply,withdraw,eligibility,review,decide}`, H8); #61 event union (H9); #69 route + template seed for `ambassador.approved`/`ambassador.declined` (H9); #114 inventory + policy (H5); `src/i18n/messages.ts` (H3); `/admin/community` menu + dashboard nav + `app-routes.ts` (H19). No change to #119's timeline registry: `milestone.ambassador` is already there (H20).

## Design (risk-flagged; compared with codebase-design vocabulary; chosen = A)
- **A. One deep eligibility function (chosen).** `checkAmbassadorEligibility({ facts, thresholds, now, purpose })` returns every rule's outcome; a thin adapter `loadEligibilityFacts(db, userId, now)` gathers membership, milestones over all of #119's person keys, `ageAt(dob, now)` from #78, and the open application. Dashboard, apply and approve all call the same function (`purpose` `"apply"` or `"approve"`; approve skips the open-application rule, because the open application is the one being decided). The interface is small, the rules live in one place, and the truth table is tested without a DB.
- **B. Pluggable rule registry** (`{ id, evaluate }[]` other tickets append to). More interface for an extension nobody asked for: the ticket wants thresholds in settings, not new rule types. Rejected; A keeps its rules as an internal ordered list, so moving to B later is mechanical.
- **C. Eligibility as one SQL query.** Can't be tested as a table, and the DOB is encrypted (#75), so age can't be computed in SQL. Rejected.
- **Write path:** `approveAmbassador` = `authorize` → one transaction: select application `FOR UPDATE` → load facts → `decideAmbassadorApplication` → update row → `recordEngagement(tx, ctx, { milestone: "ambassador", subject: { kind:"user", userId } })` → `recordAudit` → `emit("ambassador.approved")`. Decline is the same without the milestone. The applicant is told through #69's routes, never by calling the email port directly.
- **Snapshots** hold rule outcomes and thresholds, never the age (only "minimum age met: yes/no"), so a snapshot isn't more sensitive than the application.
- **Settings:** `ambassador.minMembershipDays` (default 90, 0–3650 days), `ambassador.minAgeYears` (default 18, 13–100 years), `ambassador.qualifyingMilestones` (choices from participant, school_winner, foa_finalist, volunteer; default `["foa_finalist","volunteer"]`; empty = none needed). Defaults and bounds are exported by the head start (`AMBASSADOR_THRESHOLD_DEFAULTS`, `…_BOUNDS`) so the catalogue imports them. **Age 18 by default** because the ticket has no guardian step; lowering it below 18 needs a guardian-consent follow-up. Fallback if #62 refuses a new input kind: four boolean keys `ambassador.qualifies.<kind>`.
- **Defaults (reversible, in the PR):** one open application per user; may reapply right after a decline or withdrawal; approve blocked when the recheck fails (decline instead); no step-up to decide (approval grants no role); the applicant is told on approve as well as decline; membership days = whole elapsed days since the current spell's `joined_at`.

## Interface needs from blockers (code against these; adopt the real names on `M6`)
```ts
// 119 (head start ea2df05 + brief)
recordEngagement(tx: AppDb, ctx: UseCaseContext, fact: { type: "milestone"; subject: Subject; kind: MilestoneKind; competitionId: null; occurredAt: Date; source: { type: "ambassador_application"; id: string } }): Promise<{ created: boolean }>;
personKeys(db: AppDb, userId: string): Promise<Subject[]>;                 // the user + profiles they own as self or log into
findMembership(db: AppDb, subject: Subject): Promise<{ status: "active" | "left"; joinedAt: Date } | null>; // joinedAt = current spell
listMilestoneKinds(db: AppDb, subjects: Subject[]): Promise<MilestoneKind[]>;
MILESTONE_KINDS; type MilestoneKind; type Subject;                         // QUALIFYING_MILESTONES gets `satisfies readonly MilestoneKind[]`
// 78 / 81a
ageAt(dateOfBirth: CalendarDate, at: Date): number;
findDateOfBirth(db: AppDb, userId: string): Promise<CalendarDate | null>; // self-owned or logged-into profile; decrypted
// 59a
authorize(ctx, action: `community.ambassador.${"apply" | "withdraw" | "eligibility" | "review" | "decide"}`, resource?): Promise<{ role: Role | null }>; // throws DomainError("forbidden")
recordAudit(tx, ctx, { action: "ambassador.applied" | "ambassador.withdrawn" | "ambassador.approved" | "ambassador.declined"; entity: { type: "ambassador_application"; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
// 61a
emit(tx: AppDb, clock: Clock, event: { type: "ambassador.applied" | "ambassador.approved" | "ambassador.declined" | "ambassador.withdrawn"; aggregate: { type: "ambassador_application"; id: string }; payload: { applicationId: string; userId: string } }): Promise<void>;
// 62
readSetting(db, "ambassador.minMembershipDays" | "ambassador.minAgeYears"): Promise<number>; readSetting(db, "ambassador.qualifyingMilestones"): Promise<QualifyingMilestone[]>;
integerSetting({ default, min, max, unit: "days" | "years" }); choicesSetting<T extends string>({ options: readonly T[]; default: readonly T[] }): SettingDefinition<T[]>;
// 69: route rows { eventType: "ambassador.approved" | "ambassador.declined", audience: "subject_user" (payload.userId), templateKey: same, channels: ["email","in_app"] }; event context loader adds { reason } for declined
// 114: INVENTORY.push({ table, column, category, purpose, subject, retention: { policyKey, defaultDays, basis, toConfirm: "counsel" }, action }); NON_PERSONAL; registerRetentionPolicy(...)
// 57b / 59a seed: h.signIn(user) → user Actor; h.seed.grant(user, { role: "community_manager", scope: { type: "global" } })
```

## Residue
- **HR-57** (append): ambassador thresholds `minMembershipDays` 90, `minAgeYears` 18, qualifying milestones FOA finalist or volunteer; reapply allowed at once after a decline; approve blocked when no longer eligible. All settings, confirm with FOA.
- **HR-31** (append, G1): retention of motivation, decline reason and snapshots (declined/withdrawn 365 days after closing; approved for the account's life), `toConfirm`.
- **HR-36-style copy:** FOA approves the approved/declined message wording and the eligibility explanation (G3; ships as plain drafts).
- **HR-10:** previews show seeded inbox items until `worker-preview` runs M6's dispatcher. **HR-01/HR-02:** Seam 2 on previews needs the secrets. **HR-28:** real devices for the three pages.

## Test plan
- Pure (**landed in prep**): `application-status.test.ts` (full transition table, reasons), `eligibility.test.ts` (truth table, each rule failing alone, purpose, snapshot has no age, thresholds bounds), `inputs.test.ts` (motivation/reason trimming, CRLF, limits, control chars).
- Seam 1 (`createHarness()`, fake clock, `h.drain()`, 59a grants, #119 seed for members and milestones): ACs 1–9.
- Seam 2 (written, Not run): AC 10. Gates: `pnpm check`; build with empty DB vars + `check:build`; clean tree.

## Slices (size M → 1)
1. **Apply, decide and show** (AC 1–10): schema + migration, settings keys, eligibility facts adapter, the seven use cases with authz, approve → milestone, decline → message routes, inventory + retention, seed, three pages, namespace, e2e spec. Test files: `src/server/modules/community/ambassadors/ambassadors.test.ts` (Seam 1) + `tests/e2e/122-ambassadors.spec.ts`.

## Pure core (head start, `src/server/modules/community/ambassadors/domain/`)
- `application-status.ts`: `AMBASSADOR_APPLICATION_STATUSES` (for the `pgEnum`), `AMBASSADOR_DECISIONS`, the transition table, `allowedDecisions`, `isOpenApplication`, `decideAmbassadorApplication` (`transition_not_allowed`, `reason_required`, `reason_too_long`, `no_longer_eligible`).
- `eligibility.ts`: `QUALIFYING_MILESTONES`, `AmbassadorThresholds` + defaults + bounds, `checkAmbassadorEligibility`, `membershipDays`, `toEligibilitySnapshot` + `eligibilitySnapshotSchema` (reads the jsonb back for the review page).
- `inputs.ts`: `applyForAmbassadorInput`, `declineAmbassadorInput` (zod, strict, trimmed, CRLF → LF, code-point limits as #119 counts them).
