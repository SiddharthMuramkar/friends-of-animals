# Brief 119: community membership and engagement timeline

Unit 119 of #119 · M6 · L · risk K, PD · tournament P+B2 · creates H20 (timeline-kind registry + write seam) · branch
`ticket/119-community-membership-and-engagement-timeline` · worktree `/root/foa-wt/119` · blocked by **100a**, **114**
(and through them 99a, #89, #97, 81a/81b, 61a, 59a, 57a). No siblings. Fan-out: #121, #122, #124, #125c, #126 call this seam.
Sources: #119 body (no comments), #55 decisions (none touch #119), `issues-M6-M8.md` #119 + §0.2/§0.3, spec §1.9–1.11, §2.8.

## Scope
**In:** the Community module: schema (`community_member`, `engagement_milestone`, `timeline_entry`, both enums complete up
front, F2); the write seam `recordEngagement`; use cases `joinCommunity`, `updateMemberProfile`, `leaveCommunity`,
`getMyCommunity`, `getTimeline`, `listMembers`, `rebuildMilestones`; the `certificate.issued` consumer (results rungs);
inventory rows + one retention policy; preview seed; pages `/dashboard/community`, `/dashboard/timeline`,
`/guardian/children/[id]/timeline` (81a's guardian tree), `/admin/community/members` (creates the `/admin/community` layout
and menu that #120–#122, #126 append to); namespace `community`. **Pure core already on the branch** (see Head start).
**Out:** volunteer rung + entries (#123/#124), ambassador rung (#122), clubs (#121), event entries (#125c), invitations
(#120), segments (#126); withdrawing a milestone when #101 revokes a certificate (milestones are history; #101 may add a
`certificate.revoked` consumer); member-to-member visibility (HR-55, #121).

## Acceptance checks
1. `as(member).joinCommunity({ displayName, about? })` → one `active` membership keyed by the user, a `community_member`
   milestone, a `milestone.community_member` timeline entry, audit `community.member_joined`, outbox `community.member_joined`
   + `engagement.milestone_recorded`, all in one transaction. *S1*
2. `as(guardian).joinCommunity({ childId, displayName })` for a linked under-13 child (no login) → membership keyed by the
   child's profile; a child with an own login → `child_joins_themselves`; an unlinked child → `forbidden`. *S1* (decision
   table done in Vitest)
3. Active member joining again → `already_member`; `leaveCommunity` → `left` + `left_at`; joining again reactivates the same
   row and adds **no** second `community_member` milestone or entry. *S1*
4. `updateMemberProfile` stores trimmed name/about; invalid input → `invalid_input`, nothing written. *S1* (schema done)
5. Results: seeded competition (2 adults, 1 minor, 3 institution students; school positions; final snapshot with winner,
   runner-up, finalist) → 99a publishes → `h.drain()` → exactly: `participant` for every participation certificate,
   `school_winner` for each school position, `foa_finalist` for finalist/runner-up/winner, on the certificate's participant
   profile; nobody else gets a rung. Table-driven. *S1*
6. Replay: redeliver the same `certificate.issued` and drain twice → milestone and entry counts unchanged;
   `rebuildMilestones({ competitionId })` twice after the live run → identical rows (shared source key). *S1*
7. `as(member).getTimeline()` returns the entries of every key the person has (their user, their self-owned profile, the
   profile their login is linked to), oldest first, ties by id, grouped by IST year, each with its category. *S1* (+ Vitest done)
8. `as(guardian).getTimeline({ childId })`: linked child → the child's entries (profile + the child's login, if any);
   unlinked child → `forbidden`; teen reading a sibling → `forbidden`. *S1*
9. `as(communityManager).listMembers({ status?, page })` → name, joined/left, status, subject kind; no DOB, contact or about
   of minors. *S1*
10. Authz, every use case: allowed role passes, ≥ 1 disallowed fails (`member` on `listMembers`, `visitor` on all,
   `community_manager` on `rebuildMilestones` (super admin / system only)). *S1*
11. Inventory: every PD column below has an entry with `toConfirm`; 114's coverage test passes. Retention policy
   `community.left_member` anonymises name/about 365 days after `left_at`. *Vitest + S1 (sweep with fake clock)*
12. `h.seed.preview()` twice: seeded member joined with participant + school_winner rungs from the seeded published
   competition; seeded guardian's child has a timeline; same rows both times. *S1*
13. The four pages render accessibly, light + dark, no horizontal scroll at 320 px. *S2* `tests/e2e/119-community.spec.ts`
   (written, Not run here).

## Files and hotspots
- Head start (committed): `src/server/modules/community/domain/{subject,milestones,membership,timeline}.ts` + tests.
- New: `src/server/db/schema/community.ts`; one migration `--name 119_community` (no custom SQL: drizzle 0.45 has
  `unique().nullsNotDistinct()` and `check()`); `src/server/modules/community/{index,engagement,join-community,
  member-profile,timeline,members,certificate-milestones,rebuild-milestones,retention}.ts` + tests;
  `src/server/seed/community.ts`; `messages/en-IN/community.json`; `src/app/dashboard/{community,timeline}/**`,
  `src/app/guardian/children/[id]/timeline/**`, `src/app/admin/community/{layout.tsx,members/**}`; e2e spec.
- One line each: `app.ts` (`communityUseCases`), H1 barrel, H6 `seeders` (after certificates + guardians), H3 messages,
  H5 inventory, H8 policy actions, H9 handler registry (`certificate.issued` → `community.certificate_milestone`), H19 +
  `src/lib/app-routes.ts` (dashboard, guardian child, admin links). H2 regenerated in the merge queue.
- Keep `domain/*` free of `server-only`, `@/`, Next imports (schema imports the tuples by relative path).

## Design (risk-flagged: compared with codebase-design vocabulary)
- **Write seam. A** two shallow writers `recordMilestone` + `recordTimelineEntry` (spec): each caller must remember both
  and pick a source key; five tickets duplicate that. **B (chosen)** one deep `recordEngagement(tx, ctx, fact)`: a
  milestone fact writes the milestone (unique) and its entry (source key = `milestoneSourceKey`, so live, replay and
  backfill converge); a plain entry fact writes the entry only. Later tickets add a registry line in `domain/timeline.ts`
  and call one function: high leverage, locality in one module. **C** union-query timeline over certificates, events,
  volunteering: every later ticket edits the read query, guardian scoping repeated per branch. Rejected.
- **Subject.** Dual key (`subject_user_id` | `subject_profile_id`, CHECK `num_nonnulls(...) = 1`) chosen over
  profile-always (would force DOB + #78 profile rows on adults who only join, Q1 hotspot). Rule: membership keyed by the
  login when the person has one, else by the profile; results rungs keyed by the certificate's profile. Reads expand a
  person to all keys (`personKeys(db, userId)` / `childKeys(db, profileId)`), so the split is invisible to callers.
- **Results source (R15 deviation):** consume `certificate.issued`, not `results.published`. A sibling consumer of
  `results.published` can run before 100a has issued; certificates already hold FOA's eligibility rules (participation,
  school merit, finalist set), so #119 maps type → rung (`milestoneForCertificateType`) instead of re-deriving from #89/#97.
  Backfill = scan non-revoked certificates. Fallback if 100a emits no per-certificate event: one `emit` line in 100a's
  issuing transaction (append-only).
- Tables: `community_member` (id, subject_user_id → user, subject_profile_id → participant_profile, joined_by_user_id,
  display_name, about null, status `community_member_status`, joined_at, left_at, created_at, updated_at; unique subject
  NULLS NOT DISTINCT); `engagement_milestone` (id, subject ×2, kind `engagement_milestone_kind`, competition_id null,
  achieved_at, source_type, source_id null; unique (subject ×2, kind, competition_id) NULLS NOT DISTINCT; CHECK per-
  competition kinds ⇔ competition_id set, literals from the same CREATE TYPE); `timeline_entry` (id, subject ×2, kind text,
  occurred_at, ref_type, ref_id, params jsonb ids/labels only, source_key unique, created_at; index (subject, occurred_at, id)).
  Writers use `INSERT … ON CONFLICT DO NOTHING`.

## Interface needs (adopt the real names on `M6` at claim)
```ts
// 59a
authorize(ctx: UseCaseContext, action: `community.${"join" | "profile.update" | "leave" | "timeline.read" | "members.list" | "milestones.rebuild"}`, resource?: Resource): Promise<{ role: Role | null }>; // throws DomainError("forbidden")
recordAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entity: { type: string; id: string }; before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
// 61a
emit(tx: AppDb, clock: Clock, event: DomainEvent, options?: { availableAt?: Date }): Promise<void>;  h.drain(): Promise<DrainReport>;
type CommunityEvents = { type: "community.member_joined"; aggregate: { type: "community_member"; id: string }; payload: { memberId: string } }
  | { type: "engagement.milestone_recorded"; aggregate: { type: "engagement_milestone"; id: string }; payload: { milestoneId: string } };
// 81a/81b
participantProfile: { id: string; ownerKind: "institution" | "self" | "guardian"; ownerUserId: string | null; loginUserId: string | null };
guardianLink: { guardianId: string; participantProfileId: string; revokedAt: Date | null };  guardian: { id: string; userId: string };
// 100a
certificate: { id: string; type: "participation" | "school_merit" | "finalist" | "winner" | "runner_up" | "volunteer_service"; status: "issued" | "revoked" | "superseded"; competitionId: string; participantProfileId: string; issuedAt: Date };
type CertificateIssued = { type: "certificate.issued"; aggregate: { type: "certificate"; id: string }; payload: { certificateId: string } };
h.seed.publishedCompetition(...): Promise<{ competitionId: string; profiles: Record<string, string> }>; // 99a/100a seed builder
// 114
type InventoryEntry = { table: string; column: string; category: string; purpose: string; subject: { kind: string; via: string }; retention: { policyKey: string; defaultDays: number; basis: string; toConfirm: "counsel" }; action: "delete" | "anonymise" | "retain" };
registerRetentionPolicy(p: { key: string; table: string; eligible(now: Date, days: number): SQL; action: "delete" | "anonymise"; anonymise?: Record<string, unknown> }): void;
```

## Residue
- **HR-57** append: teens join on their own login, a guardian joins a child under 13; "school winner" = any school position
  (school-merit certificate); every finalist, runner-up and winner is an "FOA finalist"; milestones stay when a certificate
  is revoked; timeline reads oldest first.
- **HR-31** append (G1): retention of member name/about (365 days after leaving), milestones and entries (life of the
  subject's account/profile), all `toConfirm`.

## Test plan
Vitest for the pure core (done, 57 tests). Seam 1 on `createHarness()` with `h.drain()`, the 99a/100a seed for a published
competition, 81a's guardian builder, 59a grants: one authz table per use case. Seam 2 spec with `expectRendersAccessibly`
(+ `.dark`) on the 4 pages, listed under "Not run".

## Slices (ordered)
1. Schema + migration + `recordEngagement` + join/leave/profile/`getMyCommunity` with authz (AC 1–4, 10) ·
   `src/server/modules/community/join-community.test.ts`.
2. `certificate.issued` consumer + `rebuildMilestones` (AC 5, 6, 10) · `certificate-milestones.test.ts`.
3. `getTimeline` (own + guardian child) + `listMembers` (AC 7–10) · `timeline.test.ts`.
4. Inventory + retention policy + preview seed (AC 11, 12) · `src/server/seed/community.test.ts`.
5. Pages, `community` namespace, nav/app-routes lines, `/admin/community` layout, e2e spec (AC 13) ·
   `tests/e2e/119-community.spec.ts`.

## Head start: `ea2df05` on the branch (from `foa/M0`, no PR), 57 tests, `pnpm check` green
- `subject.ts`: `Subject` (user | profile), `subjectKey`.
- `milestones.ts`: `MILESTONE_KINDS` (6, ladder order, for `pgEnum`), `isPerCompetition`, `milestoneIdentity` (throws
  `MilestoneScopeError`), `milestoneSourceKey`, `milestoneForCertificateType`.
- `membership.ts`: `COMMUNITY_MEMBER_STATUSES`, `canTransitionMembership`, `decideJoin` (`not_guardian`,
  `child_joins_themselves`, `already_member`), `decideLeave`, `memberProfileSchema`.
- `timeline.ts`: `TIMELINE_CATEGORIES`, `TIMELINE_ENTRY_KINDS` registry (H20), `isTimelineEntryKind`,
  `timelineKindForMilestone`, `timelineCategory`, `groupTimelineByYear` (IST).
