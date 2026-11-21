# 95b: Judge invitations and onboarding

| Unit | Issue | Branch | Worktree | Blocked by | Size, flags |
|---|---|---|---|---|---|
| 95b | #95 (M3) | `ticket/95-onboarding` | `/root/foa-wt/95b` | 95a; extras #59a (grants, scope enum), #60 (2FA), #64 (consent docs), #74 (invitation pattern, link tokens), #69/#61 (messages), #58 (encrypted columns), #73 (inventory) | L · risk (auth: token → scoped role grant, IDOR across rounds; minors: in-person judging; PD) · key **X7** (role scope enum) · F2 |

**Head start on the branch:** `780f6fe M3 #95: Add judge onboarding domain core` (base `foa/M0` 442dd99), `src/server/modules/judging/domain/`:
`judge-readiness.ts` (`judgeReadiness(facts)` → ready | missing steps, the one gate), `conflict-declaration.ts` (`conflictDeclarationSchema`). 20 unit tests.
Rebase onto `foa/M3` after 95a merges.

## Scope
- **In (95b):** scope type `round` on #59's `role_scope_type` + `ROLE_SCOPE_TYPES.judge`; consent purposes `judge_conduct`, `judge_confidentiality`
  (+ seeded sample documents v1); tables `judge_invitation`, `judge_onboarding`, `judge_conflict` (full shape; 95b writes only `declared` rows);
  use cases `inviteJudge`, `listRoundJudges`, `revokeJudgeInvitation`, `removeJudge`, `viewJudgeInvitation`, `acceptJudgeInvitation`,
  `declineJudgeInvitation`, `getJudgeOnboarding`, `acceptJudgeTerms`, `declareConflicts`, `myJudgeRounds`; the exported gate
  `loadJudgeReadiness(db, { judgeUserId, roundId })`; message `judge_invitation`; audit; inventory rows; seed; pages `/judge`,
  `/judge/invitations/[token]`, `/judge/rounds/[id]/onboarding`, the admin **Judges** tab; `src/app/judge/layout.tsx` (H23); namespace `judging`.
- **95a owns:** rounds and their machine. **95c owns:** pool, assignment, staff entry flags, automatic conflicts and their refusals.
- **#96 owns:** showing entries; it calls 95b's gate before any entry read.

## Acceptance criteria (numbered, with the seam that proves each)
1. Manager of round R's competition calls `inviteJudge({ roundId, email })` on a draft or open round → `{ ok: true, invitationId, expiresAt = now + 14 d }`;
   after `drain()` the email fake holds one message to that address with a `/judge/invitations/<43-char token>` link; audit
   `judging.judge_invited`; raw `select` shows hash + ciphertext only, never the address or token. Locked/cancelled → `round_closed`; inviting
   the same email again revokes the earlier pending invitation; an existing judge of R → `already_judge`. (S1)
2. The invitee, signed in with the invited email, calls `acceptJudgeInvitation({ token })` → holds `judge` scoped to `{ type: "round", id: R }` (one
   `user_role` row, #59's `role.granted` audit + `judging.invitation_accepted`); the invitation reads `accepted`; `authorize(…, "judge.onboard", R)`
   passes and fails for round B. (S1) — ticket AC 2
3. Refusals: another signed-in email → `email_mismatch`, nothing granted; visitor → `sign_in_required`; `clock.advance({ days: 14 })` → `expired`;
   second accept → `already_accepted`; revoked → `revoked`; malformed or unknown token → `not_found` with no detail. `declineJudgeInvitation` →
   `declined`, no role; accepting after declining → `declined`. Accept is one guarded `UPDATE … WHERE status='pending' AND expires_at > now
   RETURNING` + the grant in the same tx. (S1)
4. `getJudgeOnboarding({ roundId })` returns the current published conduct and confidentiality documents and `{ ready: false, missing: ["conduct",
   "confidentiality", "conflicts"] }`. `acceptJudgeTerms({ roundId, conductDocumentId, confidentialityDocumentId })` with current ids writes two
   `consent_event` rows (#64; purposes `judge_conduct` / `judge_confidentiality`, method `web_form`, version recorded) and fills
   `judge_onboarding`; a stale id → `document_outdated`. `declareConflicts` with `{ none: true }` or institutions + statement → ready; an
   empty declaration → `invalid_input`. Re-declaring replaces the declared rows (audited). (S1) — ticket AC 3 (onboarding half)
5. The gate: `loadJudgeReadiness` is false with no role, with the role but no terms, with terms but no declaration, and after `removeJudge`; true when
   all are done. `myJudgeRounds()` lists the judge's rounds with that flag. 95c's assignment and #96's reads call this exact function. (S1)
6. `removeJudge({ roundId, userId })` revokes the round-scoped role (same tx, audit); the removed judge's next `getJudgeOnboarding` fails
   `forbidden` with the same actor object (grants load fresh). Onboarding rows stay as history. (S1)
7. Audit rows (ids only; the conflict statement never enters the audit log): invite, revoke invitation, accept, decline, remove, terms accepted
   (#64's consent audit), conflicts declared (`judging.conflicts_declared`, after = institution ids + `statementGiven: bool`). (S1)
8. Authorization per use case: invite/list/revoke/remove — manager scoped to R's competition and global manager ✓; judge of R, content manager,
   member, manager of another competition ✗. accept/decline — signed-in matching user ✓, visitor ✗. view — bearer: a valid token works for visitor
   and user, a bad token is `not_found`. onboarding/terms/declare — judge of R ✓, member ✗, judge of round B ✗ (IDOR). `myJudgeRounds` — signed in ✓,
   visitor ✗. (S1) — ticket AC 8
9. Inventory: `judge_invitation.email_ciphertext` (+ `email_hash`), `judge_onboarding.conflict_statement` listed with purpose and
   `retention.toConfirm: true` (#73's inventory test passes). (S1)
10. Seed: on 95a's open round, one onboarded judge, one accepted-not-onboarded judge and one pending invitation (fixed ids); sample conduct and
    confidentiality documents v1 published (marked sample, HR-39). Seeding twice changes nothing. (S1)
11. axe clean (light + `.dark`, desktop + mobile): `/judge` (empty + with rounds), `/judge/invitations/[token]` (signed out, ready, mismatch,
    expired/used), `/judge/rounds/[id]/onboarding` (each step), admin Judges tab. (S2, written, **Not run**) — ticket AC 9

## Files
- **New:** `src/server/db/schema/judging-judges.ts` + one barrel line (H1); one generated migration `95_judge_onboarding` (H2) — it carries the
  `ALTER TYPE role_scope_type ADD VALUE 'round'` and two `consent_purpose` values; **grep it: no DDL may reference those three literals** (F2);
  `src/server/modules/judging/judges/{invite,respond,remove,onboarding,readiness,read,index}.ts` + tests; `src/server/seed/judging-judges.ts`
  + one line (H6); `src/app/judge/{layout.tsx,page.tsx,invitations/[token]/{page.tsx,actions.ts},rounds/[id]/onboarding/{page.tsx,actions.ts,
  _components/*}}`; `src/app/(staff)/admin/judging/rounds/[id]/judges/page.tsx` + one tab entry in 95a's `round-tabs.tsx`;
  `messages/en-IN/judging.json` (+ `adminJudging` keys); `tests/e2e/95-judge-onboarding.spec.ts`.
- **Append / shared (X7 wave alone):** #59's `roles.ts` (`SCOPE_TYPES` += `round`, `ROLE_SCOPE_TYPES.judge` += `round`) and its grant schema;
  #64's purpose catalogue (two entries); `can()` policy (H8); event→message map + template seed (H9); `src/server/privacy/inventory.ts` (H5);
  `app.ts`; `app-routes.ts` + nav (H19). `/judge` is already disallowed in `robots.ts`; pages `noindex`.
- **Next traps:** the token page renders at request time under `<Suspense>` after `await connection()`; no session read at the judge layout's top
  level; sign-in round trip uses #57b's safe relative `next`.

## Design (risk-flagged; tournament angles from issues-M3-M4 compared with `codebase-design`)
- **A. #74's invitation pattern + #64 consent rows for the documents.** Reuses link tokens (hash + ciphertext), derived expiry, versioned immutable
  documents, the consent event log and its audit. Small new surface.
- **B. A judge-onboarding aggregate with its own machine** (invited → accepted → onboarded) and one gate `canJudge`. The state is explicit, but it
  duplicates what the role grant, consent events and the declaration already record, so two sources of truth can drift (role revoked, status still
  "onboarded").
- **Chosen: A for storage, plus B's single gate.** No onboarding status column: readiness is derived from facts that already exist (role grant held
  now, two consent events, `conflicts_declared_at`) by the pure `judgeReadiness` (done). One loader `loadJudgeReadiness` feeds it, used by 95c and #96.
  Deep: one function behind which every "may this judge see/score this round" question sits; grant safety comes from #59 (fresh grants per call).
- **Tables:** `judge_invitation` (id, round_id FK, email_ciphertext + email_hash (#58), token_hash unique, token_ciphertext nulled once not pending,
  status enum `judge_invitation_status` pending|accepted|declined|revoked (expired derived), invited_by, created_at, expires_at, responded_at,
  accepted_user_id; partial unique (round_id, email_hash) WHERE status='pending'); `judge_onboarding` (round_id, judge_user_id, PK both,
  conduct_consent_event_id, confidentiality_consent_event_id, conflicts_declared_at, conflicts_none bool, conflict_statement text null (PD), updated_at);
  `judge_conflict` (id, round_id, judge_user_id, institution_id null, entry_id null, source enum `judge_conflict_source` declared|staff, note null,
  created_by, created_at; CHECK exactly one target; unique per target) — enum created here, so 95c's `staff` rows need no migration.
- **Grant path:** accept calls #59's in-transaction grant function (not the `grantRole` use case, which is super-admin only), as #74 does; audit
  `granted_by` = the inviter. Step-up (#60) is **not** required to invite (default; the grant only reaches one round and needs the invitee's own
  sign-in); staff second factor is.
- **Defaults (reversible, write in PR):** TTL 14 days; one onboarding per round (conflicts differ per pool); acceptance of a document version holds for
  that round even if FOA publishes a new version mid-round; judge terms are not withdrawable in the UI (a judge who wants out declines or is removed);
  a judge may hold several rounds; email invitations only (no SMS, so no DLT template).

## Interface needs (code against these; adopt trunk names at claim)
```ts
// 95a
const judgingRound: PgTable<{ id: string; competitionId: string; status: JudgingRoundStatus; name: string }>; acceptsJudges(status): boolean;
// #59a (+ X7 change made here)
type ScopeType = "global" | "institution" | "competition" | "organisation" | "round";
grantRoleInTx(tx: AppDb, ctx: UseCaseContext, g: { userId: string; role: "judge"; scope: { type: "round"; id: string }; grantedBy: string }): Promise<{ changed: boolean }>;
revokeRoleInTx(tx: AppDb, ctx: UseCaseContext, g: { userId: string; role: "judge"; scope: { type: "round"; id: string } }): Promise<{ changed: boolean }>;
holdsGrant(db: AppDb, userId: string, grant: Grant): Promise<boolean>;
authorize(ctx, action, { scopes: [{ type: "round", id }, { type: "competition", id }] }); recordAudit(tx, ctx, e);
// #64 consent
recordConsent(tx: AppDb, ctx: UseCaseContext, i: { subject: { type: "user"; id: string }; purpose: ConsentPurpose; documentId: string; method: "web_form" }): Promise<{ id: string } | { error: "document_outdated" }>;
currentConsentDocument(db: AppDb, purpose: ConsentPurpose): Promise<{ id: string; version: number; title: string; body: unknown } | null>;
// #74 tokens + invitation lifecycle
createLinkToken(): { token: string; tokenHash: string }; hashLinkToken(t: string): string; isWellFormedLinkToken(v: string): boolean;
invitationExpiresAt(sentAt: Date, ttlMs: number): Date; invitationStatus(i: { status; expiresAt }, now: Date): "pending" | "accepted" | "revoked" | "expired"; // add "declined"
// #58: encryptedText(); blindIndex(normalised: string): string   #57: normaliseEmailAddress()
// #61/#69: emit(tx, { type: "judging.judge_invited"; aggregateType: "judge_invitation"; aggregateId; payload: { invitationId } }); template "judge_invitation",
//   audience { kind: "contact", channel: "email", address } resolved at send time. Fallback (as #74): send through the email port after commit.
```

## Residue
- **HR-38 (R-JUDGE-VETTING):** police verification of in-person judges before the pilot's physical round; FOA leadership; the platform records nothing more.
  Goes in the M3 milestone PR's Merge Danger.
- **HR-39 (R-LEGALCOPY):** judge code of conduct, confidentiality terms and conflict-of-interest wording; seeds are drafts marked sample.
- **HR-31 (R-RET):** retention of invitee email and conflict statements (default: 90 days after the round's results; `toConfirm`).
- **HR-28:** real-device checks of the judge pages.

## Test plan
- Unit (done): readiness gate (every missing-step combination), declaration schema. Add a `decline` row to the invitation status table if #74's
  core is reused.
- Seam 1 (`createHarness()`, fake clock, `drain()`, email fake): one file per slice; raw `select` for hash-only storage; IDOR tests across two rounds.
- Seam 2: `tests/e2e/95-judge-onboarding.spec.ts` — manager invites, invitee reads the link from the capture mailbox, signs in by OTP, accepts,
  completes onboarding; `expectRendersAccessibly` light + dark on every page and state. **Not run** here.

## Slices (size L → 3)
1. Invitations and the round-scoped grant: scope enum + purposes migration, `judge_invitation`, invite/revoke/view/accept/decline, message, audit,
   authz (ACs 1, 2, 3, 8 for those) → `src/server/modules/judging/judges/invitations.test.ts`.
2. Onboarding and the gate: `judge_onboarding`, `judge_conflict` (declared), terms, declaration, `loadJudgeReadiness`, `myJudgeRounds`,
   `removeJudge` (ACs 4–7, 8 for those) → `src/server/modules/judging/judges/onboarding.test.ts`.
3. Seed, inventory, pages, judge layout, Judges tab, Seam 2 spec (ACs 9–11) → `src/server/seed/judging-judges.test.ts`,
   `tests/e2e/95-judge-onboarding.spec.ts`.
