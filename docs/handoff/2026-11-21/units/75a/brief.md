# Unit 75a: An institution registers for a competition (#75, M1, M, risk K)

Branch `ticket/75-institution-reg`, worktree `/root/foa-wt/75a`, base `foa/M0` today (rebase onto `foa/M1` when the build
pane starts). Blockers 71, 74 (and through them 70a, 73, 69, 61a, 59a, 58, 57). Sibling **75b** owns students, the
participant profile, the `registration` table, age categories, encrypted student fields, the coordinator dashboard and
the registration status table. Prepped 2026-11-21 by pane foa-p75; the domain core is on the branch ("Head start").

## Scope
- **In:** `institution_registration` (schema + one migration); module `src/server/modules/registration/` with
  `listCompetitionsForInstitution` and `registerInstitutionForCompetition`; the reference `{CODE}-I-{5 Crockford}`; the
  window rule (refused before open and after close); the principal's message through the outbox; audit; `can()` rules;
  data-inventory row; preview seed (one seeded verified institution registered for the seeded open competition);
  page `/institution/competitions` (list + register + "registered, reference X") and its Seam 2 spec.
- **Out → 75b:** adding/listing students, `/institution/registrations/[ref]/**`, `registration_status`, encrypted fields.
- **Out → later:** withdrawing an institution registration, fees and confirmation (#77), CSV (#76), expected-participant
  counts per registration, a principal who is also a platform user, cancellation (#80).

## Acceptance checks (seam)
1. Coordinator of verified X, competition `registration_open` taking institutions (`institutions` or `both`):
   `registerInstitutionForCompetition({ institutionId: X, competitionId })` → `{ ok: true, registrationId, reference }`,
   reference matches `^[A-Z]{3,6}\d{2}-I-[0-9A-HJKMNP-TV-Z]{5}$` and starts with the competition's code; one row with
   status `active`, `registered_by` = actor. (S1)
2. A second call for the same pair (same or another coordinator of X) → `already_registered`, still one row. A unique
   index on (institution_id, competition_id) backs it; a 23505 on that constraint maps to `already_registered`, a 23505
   on the reference constraint retries with new symbols (bounded, #73's helper). (S1 + unit)
3. Window: status `published` (fake clock before the open instant, jobs drained) → `not_open_yet`; after the close
   instant + drain → `closed`; still `registration_open` but the clock is past `registration_close` (worker late) →
   `closed`; any later or unknown status (`registration_closed`, judging, cancelled) → `closed`; draft or missing →
   `not_found`. No row on refusal. (S1 via #71's drain + unit table)
4. Competition for individuals only → `institutions_not_accepted`; institution pending, rejected or suspended →
   `institution_not_verified`. Precedence table proven in the unit test. (S1 + unit)
5. Principal told: after the call and an outbox drain, the email fake holds one message to the institution's principal
   email naming the institution, competition and reference; nothing is sent on a refusal. (S1)
6. Audit: exactly one `audit_log` row `registration.institution_registered`, entity `institution_registration`, after =
   `{ institutionId, competitionId, reference }` (ids, no PD), actor + IP + UA. Refusals write none. (S1)
7. `listCompetitionsForInstitution({ institutionId })` → published competitions taking institutions, each with
   `{ id, code, name, slug, window: "open" | "not_open_yet" | "closed", opensAt, closesAt, registration: { reference } | null }`,
   open first, then soonest opening. Drafts and individuals-only competitions absent. (S1)
8. Authorization per use case: authorised person (`institution_admin`) of X and coordinator of X pass; coordinator of Y,
   plain member and visitor refused (`forbidden`, no rows). (S1, table-driven)
9. Inventory: `institution_registration.registered_by` listed with purpose + `retention.toConfirm: true`. (unit, #73's test)
10. Seed: the seeded verified institution is registered for the seeded open competition with fixed id and reference
    `NEIGH27-I-SEED1` (or the open competition's code); twice = same rows. Builder `h.seed.institutionRegistration()`. (S1)
11. `/institution/competitions` renders accessibly (light + dark; empty, open, registered, refused states).
    `tests/e2e/75-institution-registration.spec.ts`, written, **Not run**. (S2)

## Design (codebase-design, compared inline)
- **A. Registration module owns it, pure decision inside (chosen).** One module `registrationUseCases`; the use case is a
  thin shell (load competition + key dates + institution + existing row → pure `decideInstitutionRegistration` → insert
  + emit + audit in one transaction). Depth sits in two pure functions: `registrationWindow` (status is authoritative
  for "opened"; the clock only guards the close, so a late worker cannot let anyone in late; unknown statuses fail
  closed) and the precedence table. 75b, #77 and #78 reuse `registrationWindow` as is.
- **B. Put it in the institutions module (#73/#74).** Couples Institutions to Competitions and to 75b's students; the
  ticket names a new Registration module and #77/#78 need registrations from both routes in one place. Rejected.
- **C. Gate on the clock against key dates only, ignore status.** Duplicates #71's machine and disagrees with the public
  status chip during a worker delay. Rejected; status + close-guard (A) agrees with #71 and fails safe.
- Status enum `institution_registration_status` = `active` only (later tickets append `withdrawn`/`cancelled` in their
  own migrations, rule F2). Results `{ ok: true, … } | { ok: false, reason }`; forbidden via #59's convention.
- Defaults (reversible, write in PR): both the authorised person and coordinators may register; email to the principal
  only (SMS route row seeded disabled until HR-14); the principal message goes through #69's map, not a direct send.

## Interface needs (code against these; rename to what lands)
```ts
// #59a policy + audit
can(ctx: UseCaseContext, action: "registration.institution.register" | "registration.institution.read",
    resource: { type: "institution"; id: string }): Promise<boolean>;  // institution_admin | institution_coordinator scoped
writeAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entityType: string; entityId: string; before: unknown; after: unknown }): Promise<void>;
// #70a + #71 competitions
competition: { id: string; code: string; slug: string; name: string; participation: "individuals" | "institutions" | "both";
  status: CompetitionStatus /* 71: draft|published|registration_open|registration_closed|… */; ageCutoffDate: string };
competitionKeyDate: { competitionId: string; kind: "registration_open" | "registration_close" | …; at: Date }; // 70a spells *_opens/_closes: use what landed
// #73 institutions + codes
institution: { id: string; name: string; status: "pending_verification" | "verified" | "rejected" | "suspended";
  principalName: string; principalEmail: string /* encryptedText */ };
randomSymbols(length: number, random?: (n: number) => Uint8Array): string;   // Crockford, no I L O U
isUniqueViolation(error: unknown, constraint?: string): boolean;               // 23505, by constraint name
// #61a outbox
emit(tx: AppDb, clock: Clock, e: { type: "institution_registration.created"; aggregateType: "institution_registration";
  aggregateId: string; payload: { institutionRegistrationId: string } }): Promise<string>;
// #69: message_route row (event → template "institution_registered", channels email + in_app for coordinators),
// audience resolver "institution_principal" (non-user contact from #73's principal email), event loader giving
// { institutionName, competitionName, reference, registeredByName }.
// Seed: h.seed.institution({ status }), h.seed.coordinator({ institutionId }), h.seed.competition({ status, participation, keyDates })
```
Fallback if #69 has no non-user contact audience: send through the email port after commit (as 74 decided); PR notes it.

## Files
- New: `src/server/db/schema/registration.ts` (75b appends to it), `drizzle/NNNN_75_institution_registration.sql`,
  `src/server/modules/registration/{index.ts, register-institution.ts, list-competitions-for-institution.ts, errors.ts}`
  + tests, `src/server/seed/registration.ts`, `src/app/institution/competitions/{page.tsx, actions.ts, _components/*}`,
  `messages/en-IN/coordinator.json` (`competitions` subtree; 75b appends), `tests/e2e/75-institution-registration.spec.ts`.
- Head start (done, ba0d33f): `src/server/modules/registration/domain/{registration-window, institution-registration,
  institution-registration-reference}.ts` + tests.
- Hotspots (one line each): schema barrel, `seed/index.ts` (seeder after institutions + competitions), `app.ts`,
  `src/i18n/messages.ts`, `src/lib/app-routes.ts`, `can()` policy, `src/server/privacy/inventory.ts`, #69 route seed,
  `drizzle/meta/*` (merge queue). No proxy, layout or header edits.
- Next traps: page is signed-in and dynamic (`await connection()` under `<Suspense>`, no session read at layout top
  level); action = authenticate → zod → one use case; `noindex`. Read `node_modules/next/dist/docs/01-app/02-guides/
  {authentication-with-cache-components,forms,data-security}.md` first.

## Residue
- HR-10/M1: the principal message needs #69's new loader/resolver on worker-preview (redeploy from the M1 tip).
- HR-14: SMS to the principal stays off until DLT templates exist; email works now.
- HR-31: retention of `registered_by` (`toConfirm: true`). HR-30: school as joint data fiduciary (non-blocking).

## Test plan
- Unit (done): window table (every status × before/after open/close, late worker, unknown status), decision precedence
  table, reference format/parse (alphabet, code shape, normalisation, refusal of I/L/O/U).
- Seam 1: `src/server/modules/registration/register-institution.test.ts` (ACs 1–6, 8),
  `list-competitions-for-institution.test.ts` (7, 8); drain the outbox for AC 5; assert rows via `h.db`.
- Seam 2: one spec, `expectRendersAccessibly` light + dark; Not run (no Postgres here).

## Slices (size M → 1)
1. Register for a competition: schema + migration + both use cases + message + audit + authz + seed + inventory + page +
   messages + Seam 2 spec. Proof `src/server/modules/registration/register-institution.test.ts` (ACs 1–11).
