# Unit 81b: minor registrations wait for the guardian; messages about a minor go to the guardian

Issue #81 · M1 · L · flags `A K` · no file key · Q1 (registration schema + `registration_status`, after 81a, before 82) ·
blocked by **81a** (and through it 78, 77a, 69). Branch `ticket/81-minor-reg`, worktree `/root/foa-wt/81b`.
Sibling **81a** owns guardians, children, teen logins, encryption of guardian details, the guardian pages and the seed.

## Scope
**In (81b):** #78's under-18 refusal is relaxed: a minor's **individual registration** goes through. Who may register:
a linked teen (13–17) themselves, or a verified guardian for any of their children; an under-13 never registers
alone. If the subject has a verified guardian the registration starts `pending_payment` (78's path); otherwise it is
held **`pending_guardian`**: a teen who has no guardian yet ("minor registering alone", #55 story 50) gives the
guardian's name, relationship and email or phone; 81b sends a **guardian request** (81a's `guardian_invitation`, kind
`guardian_request`); the guardian signs in or up by OTP, verifies (81a), accepts → link created, the teen's profile
becomes guardian-owned, every `pending_guardian` registration of that child → `pending_payment`. Pay and confirm are
refused while `pending_guardian` (free competitions too). The registration transition table gains the state.
**Messages about a minor reach the guardian's channels** through a `guardian_of_participant` resolver in #69.
**Out:** consent per purpose and the participation-consent confirm guard (#82), school-route students (#75/#83:
institution audiences), the guardian pages themselves (81a), purging stale pending requests (retention job, #114).

## Acceptance checks (seam)
1. **Age rule relaxed.** Adult unchanged (78). Linked teen, guardian verified → `pending_payment`. Verified guardian
   registers their 9-year-old → `pending_payment`, registration's profile is the child's. Under-13 member registering
   themselves → `under_13_needs_guardian`, nothing written. Guardian registering an adult "child" → `adult_registers_self`. **S1** + pure.
2. **Held pending.** Unlinked 15-year-old member registers with guardian details → registration `pending_guardian`;
   guardian contact stored encrypted (+ blind index); after drain, one message to the guardian address with a
   `/guardian/requests/<token>` link; `listMyRegistrations()` shows the pending status. Teen naming their own
   address → `guardian_contact_is_self`. **S1**
3. **Not payable before the guardian verifies.** `payForMyRegistration` on `pending_guardian` → `awaiting_guardian`,
   no batch, no gateway order; a free competition is not auto-confirmed; capture/confirm paths refuse it. **S1**
4. **Guardian verifies → release.** Guardian signs up with the requested address, verifies (81a), `acceptGuardianRequest({
   token, relationship })` → `guardian_link` active, profile owner = guardian with `login_user_id` = teen, the
   registration `pending_payment` (now payable), audit `guardian.request_accepted` + `registration.status_changed`.
   Refused with nothing changed: different signed-in address (`contact_mismatch`), unverified guardian
   (`guardian_not_verified`), reused/expired token, the teen accepting their own request. **S1**
5. **State machine table** covers every allowed and forbidden move with `pending_guardian`: → `pending_payment`
   (guardian verified), → `cancelled` (if 75b/77a define it); `pending_guardian` → `confirmed` forbidden; nothing
   moves back into `pending_guardian`. **S1** table test (extends 75b/77a/78's table).
6. **Messages about a minor go to the guardian.** A registration message (e.g. 77a's confirmation) about the teen
   reaches the guardian's email (+ in-app), the teen gets an in-app copy only; about the 9-year-old → guardian only;
   about an adult → the adult; minor with no active guardian → no delivery, `message_delivery` row `suppressed`
   reason `no_guardian`. **S1** (FakeEmail, inbox rows) + pure resolver table.
7. **Authorization, every new use case:** teen registers self; teen cannot register a sibling or another child
   (`forbidden`); guardian B cannot register or accept for A's child; member C cannot read A's pending
   registration; visitor refused. **S1**
8. **Inventory** rows for the request's guardian name, relationship, contact (+ hash), retention "30 days after the
   request expires or is answered", `toConfirm`. **Vitest**
9. **Seed**: the seeded teen (81a) has one `pending_guardian` registration under a second, unlinked teen
   `teen2@example.test` with a pending request; idempotent. **S1**
10. **Pages, axe clean light + dark:** `/guardian/requests/[token]` (signed out, ready, mismatch, expired), the
    guardian-details step of 78's `/competitions/[slug]/register`, the pending state on `/participant` and
    `/guardian/children/[id]` (register entry). **S2** `tests/e2e/81-minor-registration.spec.ts`, written, **Not run**.

## Files
- **New:** `src/server/modules/participants/domain/minor-registration.ts` + test (**done in prep**);
  `src/server/modules/guardians/domain/minor-audience.ts` + test (**done in prep**); `src/server/modules/guardians/
  guardian-request.ts` + test; `src/server/modules/participants/register-minor.test.ts`; custom migration
  `81_pre_enum_registration_pending_guardian` (`ALTER TYPE "registration_status" ADD VALUE IF NOT EXISTS 'pending_guardian';`)
  and, if a column is needed, `81_minor_reg`; `src/app/guardian/requests/[token]/{page.tsx,actions.ts}`;
  `tests/e2e/81-minor-registration.spec.ts`.
- **Touch:** 78's `decideIndividualRegistration` (the `minor` branch calls `decideMinorRegistration`; move the minor
  check after `already_registered`/consents or keep order and document), `registerAsIndividual`, `payForMyRegistration`,
  78's form (guardian-details step) and dashboard; 77a's confirm/capture guard; 75b/77a's transition table; #69's
  audience registry (`guardian_of_participant`) + map rows; `guardian.json`, `participant.json`, `registration.json`;
  inventory; seed; `can()` rules.
- **Hotspots:** Q1 `registration.ts` / `registration_status` (enum step 1 only; no DDL in this PR uses the value);
  77a's payments guard (X10 holders 78/79/80: serialize); #69 audiences; `drizzle/meta/*` (merge queue).

## Design
Compared: **(a) `pending_guardian` status + guard in the registration machine, routing as a #69 resolver** over two
pure functions — `decideMinorRegistration` (who may register a minor and the starting status) and `minorAudience`
(who hears about a profile); **(b) a separate `guardian_approval` request entity + a `MinorContactPolicy` object that
`notify` consults** — a second state machine beside the registration one, and a policy object with one caller.
**Chosen: (a).** The AC literally extends the registration table; one status column keeps "can't confirm before the
guardian verifies" a single guard every payment path already reads. The request reuses 81a's `guardian_invitation`
(kind `guardian_request`, declared by 81a) instead of a new entity. `minorAudience` sits behind #69's resolver
seam: one adapter for dispatch, the same function for tests. Reversible defaults (write in the PR): the teen gets
an in-app copy of messages about them (old SPEC §12.7, HR-32 to confirm); age counted at the registration instant
in IST (78's rule); release happens in the accept transaction, not via a job (no worker skew on previews).

**Interface needs (code against these; rename to what landed):**
```ts
// 81a guardians module
guardian: { id; userId; verifiedAt: Date | null };  guardianLink: { guardianId; participantProfileId; relationship; revokedAt: Date | null };
guardianInvitation: { id; kind: "teen_login" | "guardian_request"; status: "pending" | "accepted" | "revoked"; contactHash; tokenHash; expiresAt };
confirmGuardianVerification(input: { code: string }): Promise<{ ok: true } | { ok: false; reason: string }>;  // use case
activeGuardiansOf(db: AppDb, profileId: string): Promise<{ guardianId: string; userId: string; verified: boolean }[]>;
// 78 participants
decideIndividualRegistration(r: IndividualRegistrationRequest): IndividualRegistrationDecision;  // reason "minor" today
ageAt(dateOfBirth: CalendarDate, at: Date): number;
registerAsIndividual(input): Promise<{ ok: true; registrationId: string; status: RegistrationStatus } | { ok: false; reason: string }>;
// 77a payments: openPaymentBatch(...) refuses unless registration.status === "pending_payment"
// 75b/77a registration machine: transition(from: RegistrationStatus, to: RegistrationStatus, why): { ok } | { ok: false }
// #69 notifications
type AudienceResolver = (db: AppDb, ref: { aggregateType: string; aggregateId: string }) =>
  Promise<{ userId: string; channels?: "all" | "in_app_only"; vars?: Record<string, string> }[]>;
registerAudience(key: "guardian_of_participant", resolver: AudienceResolver): void;
```
Use cases: `registerAsIndividual` (extended, input `{ forChildId? , guardian? }`), `viewGuardianRequest({ token })`,
`acceptGuardianRequest({ token, relationship })`.

## Residue
- None new (AFK A). Appends: **HR-30** (holding a minor's registration before guardian consent; the request's
  retention), **HR-31** (request contact retention), **HR-32** (teen gets copies of messages about them).

## Test plan
- Pure (**landed in prep**): `minor-registration.test.ts` (decision table: age × who registers × guardian state, refusal
  precedence), `minor-audience.test.ts` (adult, teen, under-13, revoked/none guardians, dedupe, order).
- Seam 1 on `createHarness()` with 81a's `h.seed.guardian`, 78's competition builder, 77a's gateway fake, drain.

## Slices
1. **Minor registers; starting status** (ACs 1, 7). Enum migration, 78's decision rewired.
   Test `src/server/modules/participants/register-minor.test.ts`.
2. **Teen asks a guardian; held `pending_guardian`** (2, 7, 8). Request on 81a's table, message.
   Test `src/server/modules/guardians/guardian-request.test.ts`.
3. **Payment guard and release on accept; transition table** (3, 4, 5). Test `src/server/modules/participants/
   pending-guardian.test.ts` (+ the registration machine table file).
4. **Messages about a minor reach the guardian** (6). Resolver + map rows. Test `src/server/modules/guardians/minor-messages.test.ts`.
5. **Pages, seed, Seam 2** (9, 10). Test `src/server/seed/guardians.test.ts` (extended), `tests/e2e/81-minor-registration.spec.ts`.

## Head start landed (prep)
`a62e960` on `ticket/81-minor-reg` (from `foa/M0`, no PR):
- `src/server/modules/participants/domain/minor-registration.ts` — `decideMinorRegistration({ ageYears, registrant:
  { kind: "self"; guardian: "verified" | "unverified" | "none" } | { kind: "guardian"; verified } })` →
  `{ ok: true, status: "pending_payment" | "pending_guardian", askGuardian }` or `under_13_needs_guardian |
  adult_registers_self | not_a_minor` (adult self = 78's path). Local 13/18 constants: import 81a's/78's once on `M1`.
- `src/server/modules/guardians/domain/minor-audience.ts` — `minorAudience({ minor, loginUserId, guardians })` →
  `{ kind: "deliver", recipients: { userId, channels: "all" | "in_app_only" }[] }` or `{ kind: "suppress", reason:
  "no_guardian" | "no_login" }`. Plug into #69 as `guardian_of_participant`.
Rebase onto `M1` after 81a merges.
