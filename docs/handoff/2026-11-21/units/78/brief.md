# Unit 78: individual adult registration and payment, participant dashboard

Issue #78 · M1 · L · flags `$ K E` · keys X5 (site header), X10 (payments) · Q1 (registration schema, after 77a) · Prep commit `7070323` (pure core, 29 tests) is on the branch.
blocked by 77a (and, through it, 75b, 73's codes module, 72, 71, 64, 59a, 58). Branch
`ticket/78-individual-adult-registration-and-payment`, worktree `/root/foa-wt/78`. No siblings: this unit is the whole ticket.

## Scope
**In:** Route B for adults. `/participate` chooser (school card first, marked recommended, with the "enter through your school"
note and why; then "Participate as an Individual"); `/competitions/[slug]/register` (the individual form); a self-owned
participant profile with a **FOA Participant ID** `FOA-P-{YY}{6}`; a registration on route `individual`; consent records for
the competition's attached documents; a payment batch of one at the individual fee (free = confirmed at once); confirmation
on capture with a registration number (77a's capture path); `/participant` dashboard (registrations + status);
`/participant/registrations/[id]/pay`; refusal of under-18s with a come-back pointer; seed; data inventory rows.
**Out:** guardians, minors, teen links (81a/81b own them; they replace the `minor` refusal). Razorpay adapter, Checkout
island, webhook route, CSP (77b). Offline payments, needs-review (79). Refunds (80a). Entries, results, certificates on
the dashboard (85b, 100a, later). Participant ID as a sign-in identifier (old spec D6-1; not in this ticket).

## Acceptance checks (seam)
1. A signed-in adult member registers for a `registration_open` competition with the individual route on: a self-owned
   profile is created, its Participant ID matches `^FOA-P-\d{2}[0-9A-HJKMNP-TV-Z]{6}$` with YY = the IST year of the
   registration instant, and the registration is `pending_payment` (route `individual`). **S1**; format and IST year **pure**.
2. A second registration by the same person (another competition) reuses the profile and Participant ID. **S1**
3. Refused with a reason and nothing written: competition not open (`registration_closed`), institutions only
   (`institutions_only`), already registered for it (`already_registered`), DOB not a real past date (`dob_invalid`),
   a required consent not given (`consent_missing`). **S1**; decision table **pure**.
4. DOB under 18 on the IST calendar date of the registration instant is refused with reason `minor` and the pointer
   (message key `participant.register.minor`, "come back when the guardian route opens"). 18th birthday today = allowed,
   tomorrow = refused; a 29 Feb birthday turns 18 on 1 Mar in a non-leap year. **S1** + **pure**.
5. `payForMyRegistration({ registrationId })` opens one batch with one item at the competition's individual fee and a
   fake gateway order for that amount; a free competition confirms at once with a registration number and no order;
   a second call while a batch is open returns the same open batch (no second order). **S1**
6. Capture through the gateway fake confirms the registration and gives it a number matching
   `^[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}$`; a replayed capture changes nothing. **S1** (77a's machinery, route individual).
7. A registration number is never a sign-in credential: `requestEmailCode` / `requestPhoneCode` given one are refused
   and send nothing (no email in `h.email`, no SMS in the SMS fake). **S1**
8. `listMyRegistrations()` returns only the actor's registrations: competition name, slug, status, Participant ID,
   registration number when confirmed, newest first. **S1**
9. The chooser and the register page show the "enter through your school" note. **S2** (text + `expectRendersAccessibly`)
   and a Vitest check that the message keys exist in `messages/en-IN/participant.json`.
10. Authorization, per new use case: member passes; visitor refused on all three; member B cannot pay for or list
    member A's registration (refused, not "not found" leakage beyond the generic denial). **S1**
11. DOB and phone are ciphertext in raw SQL (`encryptedText`, #58). **S1**
12. Data inventory gains one row per new PD column (dob, phone, pin_code, city, state, country, school_name,
    participant_code, consent rows if new) with purpose and `retention: { period, basis, toConfirm: true }`. **Vitest**
13. Preview seed adds adult individual participants (Asha Rao confirmed with a number; Ravi Kumar pending payment),
    idempotent (`h.seed.preview()` twice = same rows). **S1**
14. axe clean on `/participate`, `/competitions/[slug]/register`, `/participant`, `/participant/registrations/[id]/pay`,
    light and `.dark`. **S2** `tests/e2e/78-individual-registration.spec.ts` (written, Not run here).

## Files
- New: `src/server/modules/participants/**` (domain core landed in prep: `domain/{age,participant-code,individual-eligibility}.ts`
  + tests; then `register-as-individual.ts`, `pay-for-my-registration.ts`, `list-my-registrations.ts`, `index.ts`
  exporting `participantsUseCases`), `src/server/seed/participants.ts`, `messages/en-IN/participant.json`,
  `src/app/participate/page.tsx`, `src/app/competitions/[slug]/register/{page.tsx,_components/*,actions.ts}`,
  `src/app/participant/{page.tsx,registrations/[id]/pay/page.tsx}`, `tests/e2e/78-individual-registration.spec.ts`.
- Touch (registries, one line each): `src/server/app.ts` (`composeUseCases(..., participantsUseCases)`),
  `src/server/seed/index.ts`, `src/server/db/schema/index.ts` only if a new schema file is needed, `src/i18n/messages.ts`,
  `src/lib/app-routes.ts` / `routes.ts`, `can()` policy table, `src/server/privacy/inventory.ts`.
- **Hotspots:** schema `registration.ts` (profile columns pin_code/city/state/country/school_name/phone if 75b lacks them;
  `participant_code` unique; Q1 after 77a); `payments.ts` (X10: no edits planned, only calls); `site-header.tsx`/
  `header-nav.tsx` (X5: "My competitions" link for signed-in members); `src/app/competitions/[slug]/page.tsx`
  (register CTA → `/participate?competition=<slug>`; serialize after 70b/72); `drizzle/**` (one migration `78_individual_registration`).
  `src/proxy.ts` matcher `/competitions/:slug` does not match `/competitions/:slug/register`: no proxy edit.

## Design
Compared: **(a) dedicated individual flow** — three use cases (`registerAsIndividual`, `payForMyRegistration`,
`listMyRegistrations`) over a pure `decideIndividualRegistration` core; **(b) shared registration wizard** —
`registerParticipant({ route })` with per-route strategies for 75b/78/81; **(c) one `registerAndPay` call** returning a
checkout handle. (b) is a hypothetical seam (one adapter until 81b; 75b's coordinator flow has a different actor, batch
and form) and widens every caller's interface. (c) couples registration to payment: a failed or abandoned payment
needs a separate retry entry anyway, and a free competition has no checkout. **Chosen: (a).** Depth sits in the pure
decision (`decideIndividualRegistration`: competition window, route, DOB validity, age in IST, duplicates → one
reason) and in 77a's batch machinery, which the payment use case calls with one item. 81b reuses the decision and
changes only what `minor` leads to. Age reference = the IST calendar date of the registration instant (not the
competition cut-off: that classifies age groups, 75b); 29 Feb → 1 Mar is the conservative safeguarding choice.
The profile is created once per user (`owner_kind = 'self'`, unique `owner_user_id` where owner_kind = self);
details given on a later registration update it.

**Interface needs (coded against; the build pane reconciles names with what landed):**
```ts
// 73 codes module (src/server/codes)
export function randomSymbols(length: number, random?: (n: number) => Uint8Array): string; // Crockford, no I L O U
export function retryOnUniqueViolation<T>(attempt: () => Promise<T>, opts?: { tries?: number }): Promise<T>; // 23505
// 75b registration schema
participantProfile: { id; ownerKind: "institution" | "self" | "guardian"; ownerUserId: string | null; participantCode: string | null /* unique */;
  fullName; dob: encryptedText; phone: encryptedText | null; pinCode; city; state; country; schoolName: string | null }
registration: { id; participantProfileId; competitionId; route: "institution" | "individual"; status: RegistrationStatus;
  registrationNumber: string | null; createdAt }  // RegistrationStatus ⊇ "pending_payment" | "confirmed" (77a)
// 71 + 72 competition terms
export function getRegistrationTerms(db: AppDb, competitionId: string): Promise<null | { name: string; slug: string;
  registrationOpen: boolean; acceptsIndividuals: boolean; individualFee: { amountMinor: bigint; currency: "INR" };
  consentDocuments: readonly { documentVersionId: string; required: boolean }[] }>;
// 64 consent
export function recordConsent(db: AppDb, input: { userId: string; documentVersionId: string; method: "account_checkbox"; at: Date }): Promise<void>;
// 77a payments (inside the caller's transaction)
export function openPaymentBatch(ctx: UseCaseContext, input: { payerUserId: string; route: "institution" | "individual";
  items: readonly { registrationId: string; amountMinor: bigint }[]; currency: "INR" }): Promise<
  | { kind: "order"; batchId: string; gatewayOrderId: string; amountMinor: bigint; currency: "INR" }
  | { kind: "free"; batchId: string } | { kind: "refused"; reason: "already_in_open_batch" | "not_payable" }>;
// harness: h.gateway (fake) with capture(gatewayOrderId) / webhook simulator; h.sms (58)
// 59a: can(actor, "registration.individual.create" | "registration.self.pay" | "registration.self.list", resource?)
// 58: encryptedText(name) column type; normalisePhone(raw: string): string | null (E.164)
// 73: inventory entry { table, column, purpose, retention: { period, basis, toConfirm: true } }
```
Use-case outputs: `registerAsIndividual(input) → { ok: true; registrationId; participantCode; status } | { ok: false; reason }`.

## Residue
- **HR-05** field-encryption keys per environment (DOB, phone ciphertext on previews/staging).
- **HR-09** Razorpay test keys: the batch of one runs on 77b's fallback adapter on previews until then.
- **HR-31** retention periods marked `toConfirm` for the new inventory rows.
- Copy of the "enter through your school" note is agent-written from SPEC.md §6.5.3 (folds into HR-31/R-RET review; no new HR).
- **HR-01** (Seam 2 on previews) for the axe spec; not run here.

## Test plan
- Pure (landed in prep): `domain/age.test.ts` (completed years in IST; 18th birthday boundary at IST midnight = 18:30Z;
  29 Feb; future/invalid dates), `domain/participant-code.test.ts` (format, IST year rollover 31 Dec 18:30Z, body
  validation), `domain/individual-eligibility.test.ts` (decision table, refusal precedence).
- Seam 1 per slice below on `createHarness()`; seeded competition via 70a/72 builders; gateway fake via 77a; SMS fake via 58.
- Seam 2: one spec, four pages, `expectRendersAccessibly` light + dark, plus the school-note text. **Not run** (no Postgres here).

## Slices
1. **Register as an individual adult** (ACs 1–4, 10, 11): migration + profile columns + `registerAsIndividual` + consents.
   Test `src/server/modules/participants/register-as-individual.test.ts`.
2. **Pay as a batch of one, confirmed on capture** (5, 6, 10): `payForMyRegistration` over 77a.
   Test `src/server/modules/participants/pay-for-my-registration.test.ts`.
3. **Participant dashboard read model + registration number is not a credential** (7, 8, 10): `listMyRegistrations`.
   Test `src/server/modules/participants/list-my-registrations.test.ts`.
4. **Pages, messages, nav link, Seam 2 spec** (9, 14): thin server actions → zod → one use case; message-key test
   `src/app/participate/_lib/messages.test.ts`; `tests/e2e/78-individual-registration.spec.ts`.
5. **Seed and data inventory** (12, 13). Test `src/server/seed/participants.test.ts` (+ inventory coverage).
