# Brief 121: Clubs (#121, M6)

| | |
|---|---|
| Issue / milestone | #121 / M6 · size M · risk K (club members are mostly minors; personal data) · no conflict key |
| Blockers | unit **119** (timeline write seam, `/admin/community` layout). Also needs on trunk: 57a/57b, 59a/59b, 61a, 62, 69, 73, 74, 75b, 81a, 114 |
| Branch / worktree | `ticket/121-clubs` · `/root/foa-wt/121` (cut from `foa/M0` 442dd99; rebase onto `foa/M6` at build) |
| Head start on branch | `6ae6062`: `src/server/modules/clubs/domain/{status,membership,application}.ts` + 66 Vitest tests (pure; `pnpm check` green) |

## Scope
**In:** the Clubs module. A student or teacher applies to start a club at their own verified institution. The community manager approves, declines, suspends, reinstates or closes it (status machine). Students and teachers of that institution join and leave an approved club; each join/leave writes a #119 timeline entry. The community manager (and the institution's admins/coordinators) see members and an activity feed. Setting `clubs.maxPerInstitution` (default 1). Decision messages through #69, audit, inventory rows, preview seed, 5 pages, nav links.
**Out:** #120's `start_club` invitation action (it links to `/clubs/apply`); #135b reports that read clubs; removing members when a student leaves the school; club posts, chat or events; guardians joining for an under-13 (an under-13 has no login, so no path).
**Siblings:** none (one unit).

## Defaults decided here (reversible, recorded in the PR)
- Transitions (code: `domain/status.ts`): applied→approved | declined | withdrawn; approved→suspended | closed; suspended→approved (outcome `reinstated`) | closed. Declined, withdrawn, closed are final. Withdraw is the applicant's; the rest are staff's.
- Approved and suspended clubs hold one of the institution's places, so only applied→approved checks the limit; reinstating never needs a free place. Applying is allowed at the limit (the setting may rise before the decision).
- Decline, suspend and close need a reason (trimmed, ≤ 1000); approve and withdraw take an optional one.
- "Teacher" = `institution_admin` or `institution_coordinator` scoped to the institution; "student" = enrolled through it (75b), on their own login (adult, or 13–17 linked by 81a). Teacher wins when both. Affiliation is checked at apply and at join, not re-checked for existing members.
- On approval the applicant joins automatically if still affiliated. Closing ends every active membership (timeline `club_left`). Suspending keeps members; nobody joins while suspended.
- Visibility (HR-55, strict): members see the club name, institution and member count, never other members' names. Community manager, super admin and the institution's admins/coordinators see the member list: display name, student/teacher, joined date. No email, phone or age anywhere in clubs.
- Deciders: `community_manager` and `super_admin` (59a's super admin is not a wildcard, so the rule names it). `staff_admin` and coordinators are refused.

## Acceptance criteria as testable checks
1. **Verified institution only** (S1). `as(student).applyForClub({ institutionId, name })` for a verified institution → `{ clubId }`, status `applied`, `applicant_kind` from affiliation. For a pending/rejected/suspended institution → `institution_not_verified`, no row. Not at that institution → `not_at_institution`. Second undecided application → `application_pending`. Bad name → `invalid_input` (`clubNameSchema`, 3–80).
2. **Limit at approval** (S1). With one approved club at X, `as(cm).approveClub` on a second → `club_limit_reached`, nothing written. After `changeSetting({ key: "clubs.maxPerInstitution", value: 2 })` the same call passes. A suspended club counts; reinstating it at the limit passes. Lock order in code: institution row `FOR UPDATE`, then the club row, then count.
3. **Join/leave on the timeline** (S1). `joinClub` → active membership + one `club_joined` timeline entry for the member's #119 subject; `leaveClub` → `left_at` set + one `club_left` entry. Rejoin makes a new row. Same `sourceKey` twice → still one entry. Member of another institution → `not_at_institution`; club not approved → `club_not_open`; double join → `already_member`; leave when not a member → `not_member`.
4. **Transition table** (unit, **done**: all 30 status × action pairs, limit, reason rules) + S1: one refused pair (`declined` + approve) → `transition_not_allowed`, no row changed, no audit row.
5. **Seam 1 only**: every check above is `as(actor).<useCase>` on PGlite, real migrations, `FakeClock`, fakes; no mocks of our modules.
6. **Authorization, every use case** (S1). apply/join/leave: student and teacher pass, visitor fails. withdraw: applicant passes, another member fails. approve/decline/suspend/close: community manager passes; coordinator of the institution and staff_admin fail. listClubMembers/getClubActivity: community manager and the institution's coordinator pass; a club member and another institution's coordinator fail. listClubsForReview: cm passes, member fails. Under-13: no login, so no actor (asserted by the seed having no club row for the seeded child). Refusals write nothing.
7. **Inventory, seed, axe.** Inventory rows for every PD column below (unit test from #114 passes). `seedPreview` twice → same clubs, members and timeline rows. `tests/e2e/121-clubs.spec.ts`: `expectRendersAccessibly` on all 5 pages, light and dark (written, **Not run**).
8. **Decision message** (S1). After approve/decline/suspend/close/reinstate and `h.drain()`, the applicant has one email and one inbox item naming the outcome (and the reason when given).

## Files
- **Have:** `src/server/modules/clubs/domain/{status,membership,application}.ts` + tests.
- **New:** `src/server/db/schema/clubs.ts`; migration `--name 121_clubs`; `src/server/modules/clubs/{use-cases,apply,change-status,membership,queries,affiliations,policy,events}.ts` + `clubs.test.ts`; `src/server/seed/clubs.ts` (+ test); `messages/en-IN/clubs.json`; `src/app/clubs/apply/**`, `src/app/dashboard/clubs/**` (+ `[clubId]`), `src/app/(staff)/admin/community/clubs/**` (+ `[clubId]`); `tests/e2e/121-clubs.spec.ts`.
- **Schema:** `club` (id uuidv7, institution_id FK, name, applicant_user_id FK user null-on-delete, applicant_kind enum `club_member_role` [student, teacher], status enum `club_status` [6], applied_at, decided_by_user_id, decided_at, decision_reason, created_at, updated_at; index (institution_id, status); partial unique (applicant_user_id, institution_id) WHERE status = 'applied'). `club_membership` (id, club_id FK cascade, user_id FK cascade, role `club_member_role`, status enum `club_membership_status` [active, left], joined_at, left_at; CHECK (status = 'left') = (left_at IS NOT NULL); partial unique (club_id, user_id) WHERE left_at IS NULL; index user_id). All enums are created whole in this migration (CREATE TYPE, never ADD VALUE), so the predicates are safe (F2).
- **Hotspots (append only):** H1 barrel, H2 `drizzle/meta`, H3 `messages.ts`, H5 inventory, H6 `seed/index.ts`, H7 settings catalogue, H8 policy table, H9 event union + #69 routes/templates seed, H19 dashboard + `/admin/community` menu, H20 timeline kinds, `app.ts` `composeUseCases`, `src/lib/app-routes.ts`.

## Chosen design (codebase-design, compared in context)
- **Status changes.** (a) Shallow: each of 5 use cases re-checks `from` inline, so rules are spread over 5 places (fails locality). (b) **Chosen:** the deep pure `decideClubStatus({ from, action, reason, slotsHeld, maxPerInstitution })` holds every rule; one internal `changeClubStatus(ctx, { clubId, action, reason })` locks, counts, decides, updates, audits, emits (and auto-joins on approve) in one transaction. The 5 named use cases are one-line wrappers with their own policy action, so authz tests read per use case. (c) A generic state-machine library: one adapter, hypothetical seam; rejected (as #73).
- **Who is affiliated.** (A) **Chosen:** one adapter `loadAffiliations(tx, userId): Promise<Affiliations>` reads `user_role` (teacherOf) and 75b's `participant_profile`/`registration` (studentOf); the pure `affiliationAt` decides. Coupling to two schemas lives in one file. (B) Snapshot on the membership and never re-check: stale and unauditable. (C) An institutions read model: doesn't exist; swap it in behind (A) if 75b exports one.
- **Member key.** (i) **Chosen:** `club_membership.user_id` (joining needs a login) and #119's subject resolved when writing the timeline. (ii) Store #119's subject ref: couples the schema to #119's open tournament.
- **Activity feed.** `getClubActivity` merges `audit_log` rows for entity `club` (status history) with membership joins/leaves, newest first, ties by id, 50 per page; no third table (a `club_event` table would duplicate the audit log).

## Interface needs (code against these; rename to what lands)
```ts
// 57a/57b: createHarness(), h.as, h.seed, h.clock, h.drain(); UseCaseContext = Deps & { actor }; uuidv7(at); DomainError(code)
// 59a
authorize(ctx, action: "clubs.apply" | "clubs.withdraw" | "clubs.decide" | "clubs.join" | "clubs.leave" | "clubs.members.view" | "clubs.review.list" | "clubs.view",
  resource?: { scopes?: { type: "institution"; id: string }[]; ownerId?: string }): Promise<{ role: Role | null }>;
recordAudit(tx, ctx, { action: `club.${"applied" | ClubOutcome | "member_joined" | "member_left"}`; entity: { type: "club"; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
userRole: pgTable // user_id, role, scope_type, scope_id: teacherOf = roles institution_admin|institution_coordinator @ institution
h.seed.grant(user, { role: "community_manager" | "institution_coordinator", scope }); h.seed.superAdmin(); h.signIn(user)
// 61a
emit(tx, clock, { type: "club.applied" | `club.${ClubOutcome}` | "club.member_joined" | "club.member_left"; aggregate: { type: "club"; id: string }; payload: { clubId: string; userId: string } }): Promise<void>;
// 62
SETTINGS["clubs.maxPerInstitution"] = integerSetting({ default: 1, min: 1, max: 20 }); readSetting(tx, "clubs.maxPerInstitution"): Promise<number>;
// 69: message_route rows club.{approved,declined,suspended,closed,reinstated} → audience "club_applicant" (resolver: payload.userId) → template clubs.decision.<outcome> (email + in_app)
// 73: institution { id, name, status: "pending_verification" | "verified" | "rejected" | "suspended" }; h.seed.institution({ status }); SEED_IDS.institutions
// 75b / 81a: participant_profile { id, login_user_id: string | null, managing_institution_id }, registration { participant_profile_id, route: "institution", status }
// 119 (H20)
type SubjectRef = { type: "participant_profile" | "user"; id: string };
subjectForUser(tx: AppDb, userId: string): Promise<SubjectRef>;
recordTimelineEntry(tx: AppDb, clock: Clock, e: { subject: SubjectRef; kind: "club_joined" | "club_left"; occurredAt: Date;
  ref: { type: "club"; id: string }; params: { clubName: string }; sourceKey: `club_membership:${string}:${"joined" | "left"}` }): Promise<{ created: boolean }>;
// 114: INVENTORY.push({ table, column, purpose, retention: { period, basis, toConfirm: true }, ... })
```

## Residue
- **HR-57:** `clubs.maxPerInstitution` = 1; teens (13–17) join on their own login with no guardian step.
- **HR-55:** club member visibility (strict default above); no path for under-13s.
- **HR-56 (append):** copy for the five club decision messages.
- **HR-31:** retention, to confirm: memberships deleted 2 years after `left_at`; applicant/decider ids set null 2 years after a club ends (declined, withdrawn, closed).
- Not run: the Seam 2 spec (no Postgres server here); a real two-connection approval race (PGlite is one connection; the lock is reviewed, not run).

## Test plan
- **Unit (done):** `domain/status.test.ts`, `domain/membership.test.ts`, `domain/application.test.ts`.
- **Seam 1:** `src/server/modules/clubs/clubs.test.ts` (ACs 1–6, 8) and `src/server/seed/clubs.test.ts` (seed twice); #114's inventory coverage test.
- **Seam 2 (Not run):** `tests/e2e/121-clubs.spec.ts`: seeded student applies, the community manager approves a club at a free institution and is refused at the full one, the student joins and leaves; axe on all 5 pages, light and dark.

## Slices (size M → one)
1. **Clubs end to end** (ACs 1–8), test file `src/server/modules/clubs/clubs.test.ts`. Build order inside it: schema + migration + setting → `applyForClub`/`withdrawClubApplication` → `changeClubStatus` and the 4 staff wrappers (lock, limit, audit, emit, auto-join) → `joinClub`/`leaveClub` with timeline → reads (`listMyClubs`, `getClub`, `listClubsForReview`, `listClubMembers`, `getClubActivity`) → #69 routes/templates → inventory + seed → 5 pages, `clubs` namespace, nav, `tests/e2e/121-clubs.spec.ts`.
