# Unit 81a: guardian sign-up, managed under-13 children, linked 13–17 logins

Issue #81 · M1 · L · flags `A K E` · key **X5** (site header) · Q1 (registration schema, after 78) · blocked by **78**
(and through it 77a, 75b, 74, 73, 69, 64, 59a, 58, 57). Branch `ticket/81-guardians`, worktree `/root/foa-wt/81a`.
Sibling **81b** (minor registration waits for the guardian) is blocked by this unit.

## Scope
**In (81a):** a signed-in user becomes a **Guardian**: declares full name, optional phone and "I am 18 or older and the
parent or lawful guardian", then **verifies by a one-time code** sent to their own verified contact (direct send, not the
outbox). A verified guardian adds one or more children, each with first name, last name, date of birth and the
guardian's **relationship** to that child. Under 13 → a guardian-managed profile with **no login**. 13–17 → the guardian
**invites the teen** to their own login (email or phone); the teen accepts at `/invitations/[token]` after signing in
or up by OTP, and the profile's login is linked to the guardian. Guardian details encrypted; data inventory rows;
preview seed (a guardian with an under-13 child and a linked teen); the guardian role; header link (X5); 5 pages + teen accept.
**Out (81b owns):** individual registration of minors, `pending_guardian`, the pay/confirm guard, #78's age rule
relaxed, the teen-initiated "ask my guardian" request (reuses this unit's invitation table, kind `guardian_request`),
messages about a minor routed to the guardian. **Out (later):** per-purpose consent (#82), coordinator consent links (#83),
claiming a school-managed profile, a second guardian per child (schema allows it; no UI), the child turning 18 (#115).

## Acceptance checks (seam)
1. **Guardian verifies by one-time code.** Member calls `registerAsGuardian({ fullName, phone?, adultDeclared: true })` →
   unverified guardian; `startGuardianVerification()` → one code to the member's verified email (`h.email`, not via
   drain); `confirmGuardianVerification({ code })` → `verifiedAt = clock.now()`, method `email_otp`, `guardian` role
   granted, audit `guardian.verified`. Wrong code `invalid`; after the code TTL (fake clock) `expired`; repeated
   failures lock per 57b's limiter; `adultDeclared: false` → `adult_declaration_required`. **S1**
2. **Several children.** Verified guardian `addChild` ×2 (a 9-year-old and a 15-year-old, ages on the IST date of
   `clock.now()`), `listChildren()` returns both: `{ id, firstName, lastName, kind: "managed" | "linked", login:
   "none" | "invited" | "linked" }`. Unverified guardian → `guardian_not_verified`, nothing written. **S1**
3. **Under-13 has no login.** Profile `login_user_id` is null; `inviteTeenLogin` for the 9-year-old → `under_13`.
   Boundaries (pure + S1): 13th birthday today (IST) → linked; tomorrow → managed; 29 Feb → 1 Mar (78's `ageAt`);
   18 or over → `adult` (adults register themselves); future/invalid DOB → `dob_invalid` (78's `parseDateOfBirth`).
4. **13–17 gets an own login, linked.** `inviteTeenLogin({ childId, email })` → invitation (7-day TTL, single use) and
   one message with a `/invitations/<43-char token>` link to that address (after drain); the teen signs up by OTP and
   `acceptTeenInvitation({ token })` → profile `login_user_id` = teen, invitation `accepted`, teen holds `participant`
   role, audit `guardian.teen_linked`; `as(teen).myGuardians()` lists the guardian. Refusals with nothing changed:
   reused/expired/withdrawn token, signed-in address ≠ invited address (`contact_mismatch`), the guardian accepting
   their own invite (`guardian_cannot_accept`), a user already linked to another profile (`already_linked`), the
   child no longer 13–17 at accept time. Inviting the guardian's own address → `invitee_is_guardian`. **S1**
5. **Encrypted.** Raw SQL on `guardian`, `participant_profile` (guardian-owned rows) and `guardian_invitation`
   shows no plaintext full name, phone, DOB or invited address; lookups use #58's blind index. **S1**
6. **Authorization, every new use case:** guardian A manages own children; guardian B → `forbidden` on A's child
   (`getChild`, `addChild` on A's profile ids, `inviteTeenLogin`); plain member → `forbidden` on `addChild`; linked teen →
   `forbidden` on `addChild`/`inviteTeenLogin` ("teen cannot add siblings"); visitor → `forbidden`. **S1**
7. **Audit rows** for register, verify, child added, invite sent/withdrawn, teen linked (actor, before/after). **S1**
8. **Data inventory**: one entry per new PD column (below) with purpose and `retention: { period, basis, toConfirm: true }`. **Vitest**
9. **Preview seed**: guardian `guardian1@example.test` (verified) with an under-13 managed child and a linked teen
   `teen1@example.test`; `h.seed.preview()` twice = same rows; builder `h.seed.guardian({ children })`. **S1**
10. **Pages, axe clean light + dark**: `/guardian/register` (declare, code step), `/guardian` (children, empty state),
    `/guardian/children/new`, `/guardian/children/[id]` (profile; invite login when 13–17), `/invitations/[token]`
    teen variant (signed out, ready, mismatch, expired). **S2** `tests/e2e/81-guardians.spec.ts`, written, **Not run**.

## Files
- **New:** `src/server/modules/guardians/domain/children.ts` + test (**done in prep**); `src/server/modules/guardians/
  {register-guardian,verify-guardian,children,teen-login,index}.ts` + tests; `src/server/db/schema/guardians.ts`;
  migration `81_guardians`; `src/server/seed/guardians.ts`; `messages/en-IN/guardian.json`; `src/app/guardian/**`
  (`page.tsx`, `register/`, `children/new/`, `children/[id]/`, `_components/`, `actions.ts`); `tests/e2e/81-guardians.spec.ts`.
- **Touch, one line each:** `src/server/app.ts` (`guardiansUseCases`), `schema/index.ts`, `seed/index.ts` (seeder after
  participants), `src/i18n/messages.ts`, `src/lib/app-routes.ts`, the `can()` rules file, `src/server/privacy/inventory.ts`,
  #69's event→message map seed (template `teen_login_invitation`), #74's `/invitations/[token]` (dispatch by kind).
- **Hotspots:** **X5** `site-header.tsx`/`header-nav.tsx` ("My children" link for guardians; serialize with 69/73/78);
  Q1 `registration.ts` only if 75b/78 lack `login_user_id` or `owner_kind = 'guardian'` (then an enum step-1 custom
  migration, no DDL using it); `drizzle/meta/*` regenerated in the merge queue.

## Design
Compared (codebase-design vocabulary): **(a) guardian invites the teen** — one `guardians` module, 9 use cases,
depth in a pure `domain/children.ts` (child kind, add/invite/accept decisions with refusal precedence) plus #74's
link-token and #58's cipher; **(b) teen signs up, then links** — needs a DOB at sign-up (edits 57b's M0 identity flow)
and leaves unlinked minor accounts between steps; under-13s still need path (a), so two paths for one AC;
**(c) household aggregate** — a `household` entity owning guardians and children: an entity #55's schema doesn't name,
which #82 (consent keyed by subject + giver) and #115 (rights) would have to cross; fails the deletion test for one
guardian per child. **Chosen: (a).** No minor account exists without a verified guardian; the teen's own OTP sign-in
proves the contact (no second OTP, as #74 D1). 81b adds the reverse direction (teen names a guardian) on the same
invitation table, so `guardian_invitation_kind` declares **both** `teen_login` and `guardian_request` now.
Reversible defaults (write in the PR): verify before adding any child (no child data before verifiable consent);
verification = fresh code to the guardian's own verified email (phone once #58's SMS is on) + adult declaration,
separate from sign-in so the record shows the moment of declaration; relationship per link, enum
`guardian_relationship` = mother | father | legal_guardian | grandparent | other_relative; `guardian` role global scope,
per-child access from an active `guardian_link` inside `can()`; invitation TTL 7 days, expired derived from `expires_at`.
Tables: `guardian` (id, user_id unique, full_name enc, phone enc null, phone_hash null, adult_declared_at,
verified_at null, verification_method enum `guardian_verification_method` email_otp|phone_otp null, created/updated_at);
`guardian_link` (guardian_id, participant_profile_id, relationship, created_at, revoked_at; partial unique active pair);
`guardian_invitation` (id, kind, guardian_id, participant_profile_id, status enum pending|accepted|revoked,
contact_ciphertext, contact_hash, channel, token_hash unique, token_ciphertext null, expires_at, accepted_by, timestamps;
partial unique `(participant_profile_id, kind) WHERE status='pending'`).

**Interface needs (code against these; rename to what landed):**
```ts
// #78 participants/domain (on M1 before this unit)
ageAt(dateOfBirth: CalendarDate, at: Date): number;  parseDateOfBirth(text: string, at: Date): CalendarDate | null;
// #75b/#78 registration schema
participantProfile: { id; ownerKind: "institution" | "self" | "guardian"; ownerUserId: string | null; loginUserId?: string | null;
  firstName; lastName; dob: encryptedText; createdBy; createdAt }   // add loginUserId if 78 only has ownerUserId
// #57b identity OTP (wrap Better Auth's emailOTP if no FOA service exists)
issueOneTimeCode(ctx: UseCaseContext, i: { channel: "email" | "phone"; to: string; purpose: "guardian_verification" }):
  Promise<{ ok: true; expiresAt: Date } | { ok: false; reason: "rate_limited" }>;
checkOneTimeCode(ctx: UseCaseContext, i: { channel: "email" | "phone"; to: string; purpose: "guardian_verification"; code: string }):
  Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "locked" }>;
// #58: encryptedText(): PgCustomColumn<string>; blindIndex(normalised: string): string; normalisePhoneNumber(raw): string | null
// #59a
can(ctx: UseCaseContext, action: `guardian.${"register" | "children.manage" | "children.read"}` | "guardian.invitation.accept",
  resource?: { type: "participant_profile"; id: string }): Promise<boolean>;
grantRole(tx: AppDb, ctx: UseCaseContext, g: { userId: string; role: "guardian" | "participant"; scope: { type: "global" } }): Promise<void>;
writeAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entityType: string; entityId: string; before: unknown; after: unknown }): Promise<void>;
// #74: newLinkToken(): { token: string; tokenHash: string }; hashLinkToken(token: string): string;  /invitations/[token] page
// #61/#69: emit(tx, clock, { eventType: "guardian.teen_invited"; aggregateType: "guardian_invitation"; aggregateId; payload: { invitationId } })
//   map row → template "teen_login_invitation", audience { kind: "contact", channel, address } resolved at send time
// #73: inventory entry { table, column, purpose, retention: { period, basis, toConfirm: true } }
```
Use cases: `registerAsGuardian`, `startGuardianVerification`, `confirmGuardianVerification`, `addChild`, `listChildren`,
`getChild`, `inviteTeenLogin`, `withdrawTeenInvitation`, `acceptTeenInvitation`, `myGuardians`. Results
`{ ok: true, … } | { ok: false, reason }`; first line `can()`.
Inventory rows: `guardian.full_name`, `guardian.phone`, `guardian_link.relationship`, `guardian_invitation.contact_ciphertext`
(+ `contact_hash`); default retention "while a linked child's profile exists + 1 year", invitations "30 days after
accepted/revoked/expired", all `toConfirm`.

## Residue
- **HR-05** reuses #58's `FIELD_ENCRYPTION_KEYS`/`FIELD_HMAC_KEY`; nothing new.
- **HR-30** append: guardian OTP + self-declared relationship as verifiable parental consent; own login from 13;
  29 Feb → 1 Mar; what happens at 18 (claim at majority, #115).
- **HR-31** append: retention of the rows above.
- **HR-32** safeguarding sign-off of the guardian, teen and under-13 flows; gates the M1 release PR, never this merge.

## Test plan
- Pure (**landed in prep**): `domain/children.test.ts` — child kind at 12/13/17/18, add-child, invite and accept
  decision tables with refusal precedence.
- Seam 1 on `createHarness()` + #58 SMS fake + drain (#61); seed builders `member`, `guardian`. Seam 2 spec written, Not run.

## Slices
1. **Guardian declares and verifies by code** (ACs 1, 6, 7). Schema `guardian` + enums, migration `81_guardians`, role
   grant. Test `src/server/modules/guardians/verify-guardian.test.ts`.
2. **Add and list children; under-13 managed** (2, 3, 5, 6, 7). `guardian_link`, guardian-owned profiles.
   Test `src/server/modules/guardians/children.test.ts`.
3. **Teen login invitation and acceptance** (4, 5, 6, 7). `guardian_invitation`, map row, accept.
   Test `src/server/modules/guardians/teen-login.test.ts`.
4. **Seed and inventory** (8, 9). Test `src/server/seed/guardians.test.ts`.
5. **Pages, `guardian` namespace, header link, Seam 2** (10). Test `tests/e2e/81-guardians.spec.ts`.

## Head start landed (prep)
`5e38735` on `ticket/81-guardians` (from `foa/M0`, no PR): `src/server/modules/guardians/domain/children.ts` + test —
`MINOR_LOGIN_MIN_AGE`, `ADULT_AGE`, `childKindForAge(ageYears)`, `decideAddChild({ guardianVerified, ageYears | null })`,
`decideTeenInvite({ ageYears, childHasLogin, inviteeIsAGuardian })` → `under_13 | adult | child_has_login |
invitee_is_guardian`, `decideTeenAcceptance({ invitation | null, now, accepter, child })` → `not_found | already_used |
withdrawn | expired | guardian_cannot_accept | contact_mismatch | already_linked | child_has_login | under_13 | adult`.
Rebase onto `M1` once 78 lands; feed ages from 78's `ageAt`.
