# Unit 74: Institution coordinators (#74, M1, L, risk)

Branch `ticket/74-institution-coordinators`, worktree `/root/foa-wt/74`, base `foa/M0` (442dd99). Blocker: 73 (and,
through it, 57–61, 69). No siblings: this unit owns all of #74. Prepped 2026-11-21 by pane foa-p74. Head start
on the pushed branch: ac0e8f8 `M1 #74: Add invitation domain core` (invitation lifecycle, link token, masking; 26
tests). These files load under plain Node (relative imports, no `server-only`) so the seeder can use them. Rebase or
merge onto `foa/M1` once 73 lands.

## Scope
- In: invite a coordinator by email or phone (authorised person of a **verified** institution only); view and accept an
  invitation through `/invitations/[token]` with the sign-in/sign-up round trip; the accepted user holds
  `institution_coordinator` scoped to that one institution; list coordinators and pending invitations; remove a
  coordinator (role revoked at once, audit row); withdraw a pending invitation; expiry (7 days) and single use;
  data-inventory rows; preview seed; two pages + Seam 2 spec.
- Out: telling the principal about competition registration (#75a); anything a coordinator *does* for the institution
  (#75+); changing the authorised person; a coordinator leaving by themselves (later, if asked).

## Acceptance checks (seam)
1. Authorised person of verified X invites `t@school.test` → `{ ok: true, invitationId, expiresAt = now + 7 d }`, the
   email fake (after drain) has one message to that address with a `/invitations/<43-char token>` link, and one audit
   row `institution.coordinator_invited`. (S1)
2. Invitee signs in (existing account) or signs up with that email, calls `acceptInvitation({ token })` → holds exactly
   one new role `institution_coordinator` with scope institution X; `can()` passes for X and fails for Y; the
   invitation reads `accepted`; audit row `institution.invitation_accepted` (+ #59's own `role.granted`). (S1–2)
3. Coordinator of A is refused `forbidden` by `listCoordinators`, `inviteCoordinator`, `removeCoordinator`,
   `revokeInvitation` and #73's institution read for B, while #73's read for A passes. (S3)
4. `removeCoordinator({ institutionId: A, userId })` → the removed user's **next** call on A is refused (same session,
   no cache); role row gone; audit row `institution.coordinator_removed` with actor, IP, user agent, before/after. (S3)
5. Accept at 7 d − 1 ms passes; at exactly 7 d is refused `expired` (fake clock). Domain table proves the boundary. (S2)
6. A second accept (same or other user) is refused `already_accepted`; a withdrawn link `revoked`; re-inviting the same
   identifier withdraws the earlier pending link (old token → `revoked`, new one works). (S2–3)
7. Institution pending, rejected or suspended → invite refused `institution_not_verified`; no row, no message. (S1)
8. Acceptor whose verified email/phone is not the invited identifier → `identifier_mismatch`, nothing granted; visitor →
   `sign_in_required`; unknown or malformed token → `not_found` (view and accept), with no detail leaked. (S2)
9. Authorization per use case: invite/list/remove/revokeInvitation — authorised person of X passes; coordinator of X,
   plain member and authorised person of Y refused. accept — matching signed-in user passes, visitor refused.
   viewInvitation — bearer read: valid token passes for visitor and user, bad token `not_found`. (S1–3)
10. Phone invite: SMS enabled → SMS fake gets the link; `sms.enabled` false → `sms_disabled` (email path unaffected). (S1)
11. Inventory lists every new PD column with purpose and `retention.toConfirm: true` (#73's inventory test passes). (S4)
12. Seed: every seeded verified institution has ≥ 1 coordinator (fixed ids) and one pending invitation; seeding twice
    changes nothing (`seed.test.ts`). (S4)
13. axe clean (light + dark): `/institution/coordinators` (list, empty, invite errors) and `/invitations/[token]`
    (signed out, ready, mismatch, expired/used). Seam 2 spec written; **Not run** here. (S4)

## Design (codebase-design, compared inline)
- **D1 roles are membership (chosen).** One new table `institution_invitation`; the scoped `user_role` row from #59 *is*
  the membership. A `coordinators` module exposes 6 use cases; inside it, one pure core (`domain/invitation.ts`)
  decides every lifecycle move, and a generic `tokens/link-token.ts` mints and hashes bearer links (#81 teen links and
  #83 consent links reuse it). Accept = one conditional `UPDATE … WHERE status='pending' AND expires_at > now RETURNING`
  (the race guard; PGlite hides races) + `grantRole` in the same transaction.
- D2 member table + mirrored role: two writes per change and a drift class of bugs; fails the deletion test (nothing
  reads it that can't read roles + invitation). Only if #73 already landed `institution_member`: then write it from
  the same module function, in the same transaction, and keep authorization on roles alone.
- D3 token possession + OTP to the invited identifier: bigger interface (OTP send, limits, DLT for phone) for no extra
  assurance — the account's own OTP sign-in already verified its email/phone. Rejected; identifier binding (D1) wins.
- Status: enum `institution_invitation_status` = pending | accepted | revoked (stored); **expired is derived** from
  `expires_at <= now` — no job, no worker skew. Partial unique index `(institution_id, identifier_hash) WHERE
  status='pending'`; inviting again revokes the old pending row first.
- Token: 32 random bytes, base64url (43 chars); DB keeps `token_hash` (SHA-256 hex, unique) for lookup and
  `token_ciphertext` (#58 `encryptedText`, nulled once not pending) so the message is built at send time; the outbox
  payload carries ids only. Identifier: `identifier_ciphertext` + `identifier_hash` (#58 blind index), `channel`.
- Defaults (reversible, write in PR): TTL 7 days (old SPEC §6.4.3); coordinators can't see the member list; can't
  invite yourself or an existing coordinator (`already_coordinator`); a user may coordinate several institutions;
  removal keeps the institution's data; the authorised person is not removable here.

## Interface needs (code against these; rename to what lands)
```ts
// #59 roles, policy, audit
type RoleScope = { type: "global" } | { type: "institution"; id: string } /* | competition | organisation */;
can(ctx: UseCaseContext, action: "institution.coordinators.manage" | "institution.read", resource: { type: "institution"; id: string }): Promise<boolean>;
grantRole(tx: AppDb, ctx: UseCaseContext, g: { userId: string; role: "institution_coordinator"; scope: RoleScope }): Promise<void>;
revokeRole(tx: AppDb, ctx: UseCaseContext, g: { userId: string; role: "institution_coordinator"; scope: RoleScope }): Promise<boolean>;
usersWithRole(db: AppDb, role: Role, scope: RoleScope): Promise<{ userId: string; name: string; grantedAt: Date }[]>;
writeAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entityType: string; entityId: string; before: unknown; after: unknown }): Promise<void>;
// #58 encryption + phone
encryptedText(): PgCustomColumn<string>;  blindIndex(normalised: string): string;
normalisePhoneNumber(raw: string): string | null /* E.164 */;  settings.get("sms.enabled"): Promise<boolean>;
// #57 identity
normaliseEmailAddress(a: string): string;  user.email (normalised), user.phone_hash + phone_verified (#58)
// #61 outbox / #69 notify
emit(tx: AppDb, e: { type: "institution.coordinator_invited"; aggregateType: "institution_invitation"; aggregateId: string; payload: { invitationId: string } }): Promise<void>;
// #69 map row: event → template "coordinator_invitation", audience { kind: "contact", channel, address } (non-user),
// variables resolved at send time by a module resolver: { institutionName, inviterName, link, expiresAt }
// #73
institution: { id, name, status: "pending_verification" | "verified" | "rejected" | "suspended" }; institution_admin role scoped to it
seed: seedInstitutions + SEED_IDS.institution.*; builder h.seed.institution({ status, admin? })
// #57b: sign-in/sign-up honour a safe relative `next` (returns to /invitations/<token>)
```
Fallback if #69 has no contact audience or resolver hook: the invite use case sends through the email/SMS ports after
the transaction commits (state it in the PR as a deviation, residue none).

## Use cases (one module `coordinatorsUseCases`, one line in `app.ts`)
`inviteCoordinator({ institutionId, identifier })`, `listCoordinators({ institutionId })` → coordinators + pending
invitations (effective status), `removeCoordinator({ institutionId, userId })`, `revokeInvitation({ invitationId })`,
`viewInvitation({ token })` → `{ institutionName, status, channel, maskedIdentifier }`, `acceptInvitation({ token })`.
Results `{ ok: true, … } | { ok: false, reason }` as in docs/agents/seam-1.md. First line of each: `can()`.

## Files
- New: `src/server/institutions/domain/{invitation,mask-identifier}.ts` + tests (**done**), `src/server/tokens/link-token.ts`
  + test (**done**), `src/server/db/schema/institution-invitations.ts` (own file, not #73's), `src/server/institutions/
  coordinators/*.ts` + tests, `src/server/seed/coordinators.ts`, `src/app/institution/coordinators/{page.tsx,
  _components/*, actions.ts}`, `src/app/invitations/[token]/{page.tsx,actions.ts}`, `messages/en-IN/coordinators.json`,
  `tests/e2e/74-institution-coordinators.spec.ts`, `drizzle/NNNN_74_institution_coordinators.sql`.
- Hotspots (append one line/entry each): schema barrel, `seed/index.ts` (seeder after #73's + builders `coordinator()`,
  `invitation()`), `app.ts`, `src/i18n/messages.ts`, signed-in route registry (`app-routes.ts`), `can()` policy, #69
  event→message map seed, `src/server/privacy/inventory.ts`, `drizzle/meta/*` (merge queue). Avoid `src/proxy.ts` (X2)
  unless #65 needs a matcher entry for the dynamic token page.
- Next traps: token page renders at request time under `<Suspense>` after `await connection()`; `noindex`; no session
  read at layout top level; read `node_modules/next/dist/docs/01-app/02-guides/{authentication-with-cache-components,
  forms,data-security}.md` first.

## Residue
- HR-14: phone invitations need DLT templates (URL whitelisted); `sms.enabled` stays false, phone invites refused
  `sms_disabled` in production until then. Email works now.
- HR-31: retention of invitee identifier (default 90 days after accept/expiry/revoke, `toConfirm: true`).
- HR-05 (inherited from #58): field-encryption + blind-index keys per environment.

## Test plan
- Pure (done): `invitation.test.ts` full table (4 effective statuses × accept/revoke, expiry boundary, TTL),
  `link-token.test.ts` (length, alphabet, entropy source, hash stability, well-formedness), `mask-identifier.test.ts`.
- Seam 1: one file per slice below; drain the outbox to assert messages; raw `select` shows ciphertext, never the
  invitee address or token; audit rows asserted by action/entity/actor.
- Seam 2: `tests/e2e/74-institution-coordinators.spec.ts` — seeded authorised person invites, reads the link from the
  capture mailbox, seeded member accepts; `expectRendersAccessibly` on both pages, all states, `.dark` run. Not run here.

## Slices
1. Invite — schema + migration + `inviteCoordinator` (verified-only, supersede, email + phone/SMS flag, message, audit,
   authz). `src/server/institutions/coordinators/invite-coordinator.test.ts` (ACs 1, 7, 9, 10)
2. Accept — `viewInvitation` + `acceptInvitation` (binding, expiry, single use, scoped grant, audit).
   `…/accept-invitation.test.ts` (ACs 2, 5, 6, 8, 9)
3. Manage + isolation — `listCoordinators`, `removeCoordinator`, `revokeInvitation`, cross-institution refusals.
   `…/manage-coordinators.test.ts` (ACs 3, 4, 6, 9)
4. Seed, inventory, pages — seeder + builders, inventory rows, two pages, messages namespace, Seam 2 spec.
   `src/server/seed/seed.test.ts` (extend) + `tests/e2e/74-institution-coordinators.spec.ts` (ACs 11, 12, 13)
