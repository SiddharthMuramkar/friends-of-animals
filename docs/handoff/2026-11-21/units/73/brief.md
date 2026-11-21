# Brief 73: Institution registration and verification, Institution ID

| | |
|---|---|
| Issue / milestone | #73 / M1 · size L · risk (auth: role grant on verify; personal data; encryption) · key X5 |
| Blockers | unit 69 (native); technically also #57 harness, #58 `encryptedText()`, #59 roles/`can()`/audit, #60 staff 2FA, #61 outbox |
| Branch / worktree | `ticket/73-institution-registration-and-verification-institution` · `/root/foa-wt/73` (based on `foa/M0` 442dd99) |
| Head start on branch | `src/server/modules/codes/` (generator + collision retry) and `src/server/modules/institutions/domain/status.ts` (state machine), 28 Vitest tests, commit 3e8b3b9 |

## Scope
**In:** the Institutions module and the Codes module. The authorised person (any signed-in user) registers an institution, which starts as `pending_verification`. FOA staff verify, reject or suspend it, always with a reason, and each change writes an audit row. The first verification gives the institution an Institution ID and grants the authorised person `institution_admin` scoped to that institution. Each outcome sends a message through #69. Also: the data inventory entries, the preview seed, 4 pages, and a header link.
**Out:** coordinators and invites (#74). Competition registration and students (#75). Duplicate-institution detection, principal confirmation links and the change-request workflow (old SPEC §6.4 prior art, not in the ticket). Re-applying after a rejection.
**Siblings:** none (one unit). #74 builds on `institution` + `institution_admin`, and #75 reuses `withUniqueCode` for `{comp}-I-{5}`.

## Defaults decided here (reversible, recorded in the PR)
- Transitions: pending→verified (verify), pending→rejected (reject), verified→suspended (suspend), suspended→verified (verify, outcome `reinstated`, keeps its ID). `rejected` is final; the person registers again. Every other pair is refused with `transition_not_allowed`.
- Reason: required, trimmed, at most 1000 characters. Only free text; no verification checklist yet (HR-34).
- "FOA admin" = global `staff_admin` or `super_admin`. `can()` applies the #60 2FA rule.
- Suspend keeps the `institution_admin` role. Later tickets gate actions on `status === "verified"`.
- Encrypted with #58's `encryptedText()`: `principal_email`, `principal_phone`. The principal's name and the institution's own address and contact details are stored plain, but they are listed in the inventory.

## Interface needs (what this unit codes against; adjust names to what lands)
```ts
// #57 harness (PR #140): createHarness(), h.as(actor), h.seed, h.clock, h.email; UseCaseContext = Deps & { actor }
// #59: roles, policy, audit
type Role = "member" | "institution_admin" | "staff_admin" | "super_admin" | /* … */ string;
can(actor: Actor, action: string, resource?: { type: "institution"; id: string }): Promise<boolean>; // or throws DomainError("forbidden")
grantRoleInTx(tx: AppDb, input: { userId: string; role: "institution_admin"; scope: { type: "institution"; id: string }; grantedBy: string }): Promise<void>; // idempotent
AuditLog.write(tx: AppDb, entry: { actor: Actor; action: string; entityType: "institution"; entityId: string; before: object | null; after: object | null }): Promise<void>;
h.seed.staffAdmin(): Promise<User>; // or seed.member() + grantRole
// #58
encryptedText(name: string): PgCustomColumn<string>; // AES-256-GCM, fixed test key in tests
normaliseIndianPhone(input: string): string | null;  // E.164; reuse it, don't write a second one
// #61 outbox
emit(tx: AppDb, event: { type: `institution.${InstitutionOutcome}`; aggregateId: string; payload: { institutionId: string; userId: string } }): Promise<void>;
h.drain(): Promise<void>;
// #69 notifications: one event→message map row per outcome, with email + in-app templates seeded
EVENT_MESSAGES: Array<{ event: string; template: string; channels: ("email" | "in_app")[]; recipient: "aggregate_user" | string }>;
h.as(user).listInbox(): Promise<{ items: { template: string; read: boolean }[] }>;
// DomainError (57b or 59a): new DomainError("forbidden" | "not_found" | "transition_not_allowed" | "reason_required" | "reason_too_long")
```
If #58 has already created `src/server/privacy/inventory.ts`, append to it; otherwise this unit creates it (issues-M1 finding 0.2.2 shape: `{ table, column, purpose, retention: { period, basis, toConfirm: true } }` plus `docs/privacy/data-inventory.md`).

## Acceptance criteria as testable checks
1. **Register → pending** (seam1). `as(member).registerInstitution(valid)` returns `{ id }`. `as(member).getMyInstitution()` shows `status: "pending_verification"`, `institutionCode: null`, and every field echoed back. The pin code is 6 digits and can't start with 0. Expected participants is an integer from 1 to 100000. Invalid input gives a zod field error and writes no row.
2. **Principal contact encrypted** (seam1, raw SQL). `select * from institution` contains neither the principal's email nor their phone, and `getMyInstitution` returns both decrypted.
3. **Verify** (seam1). `as(staffAdmin).decideInstitution({ institutionId, decision: "verify", reason })` sets the status to `verified`, sets `institution_code` to match `^FOA-I-[0-9A-HJKMNP-TV-Z]{5}$`, and sets `verified_by`/`verified_at` from the clock. The authorised person now passes `can(…, { type: "institution", id })` and fails for another institution's id.
4. **Reject / suspend need a reason** (seam1). A blank or over-long reason gives `reason_required`/`reason_too_long` and changes nothing: no status change and no audit row.
5. **Audit row per change** (seam1). Each successful decision writes exactly one `audit_log` row (`entity_type='institution'`, before/after = `{status, reason}`, no PII). So does registration.
6. **Transition table** (unit: `domain/status.test.ts`, already green). All 12 status × decision pairs. Plus seam1: one refused pair (`rejected` + `verify`) gives `transition_not_allowed` with no row changed.
7. **Unique Institution ID** (unit: `codes/*.test.ts`, already green: format, alphabet, retry, gives up after 5, other errors aren't retried, real PGlite savepoint retry). Plus seam1: two verified institutions get different codes, and a reinstated institution keeps its code.
8. **Outcome message** (seam1). After each of verify, reject, suspend and reinstate, `h.drain()` delivers one email to the authorised person (`h.email.lastTo`) and one inbox item, and both name the outcome. Verify also includes the Institution ID.
9. **Authorization** (seam1, one test per use case). `registerInstitution`: a member passes, a visitor fails. `getMyInstitution`: the creator passes, another member gets `not_found`. `listInstitutions`/`getInstitutionForReview`/`decideInstitution`: `staff_admin` and `super_admin` pass; `member` and the institution's own `institution_admin` fail with `forbidden`, with no rows written.
10. **Data inventory** (unit). An entry for every new PD column (principal name, email and phone; contact email and phone; `created_by`), each with a purpose and a retention marked `toConfirm: true`. A test asserts that every encrypted column of `institution` is listed.
11. **Seed** (seam1). Running `seedPreview` twice yields one pending, one verified (with a code and its admin role) and one rejected institution, under fixed `SEED_IDS`.
12. **axe** (seam2, written, **not run**: no Postgres here). `tests/e2e/73-institutions.spec.ts` calls `expectRendersAccessibly` on `/institutions/register`, `/institution`, `/admin/institutions` and `/admin/institutions/[id]`, in light and dark.

## Files
- **Have:** `src/server/modules/codes/{codes,codes.test,codes.postgres.test}.ts` and `src/server/modules/institutions/domain/{status,status.test}.ts`. If 57a/59a settle on `src/server/<module>/` instead of `modules/`, `git mv` them.
- **New:**
  - `src/server/db/schema/institutions.ts`: pgEnums `institution_status` (from `INSTITUTION_STATUSES`) and `institution_type` (school, college, university, other); constraint `institution_institution_code_unique`; indexes on `status`, `created_by`.
  - one migration `--name 73_institutions`;
  - `src/server/modules/institutions/{use-cases,register,decide,queries,input}.ts` + tests;
  - `src/server/seed/institutions.ts`;
  - `messages/en-IN/{institutions,adminInstitutions}.json`;
  - `src/app/institutions/register/**`, `src/app/institution/**`, `src/app/(staff)/admin/institutions/**` (with `[id]`);
  - `tests/e2e/73-institutions.spec.ts`;
  - the inventory file, if absent.
- **Hotspots (append only):** `schema/index.ts` barrel, `src/server/use-cases` composition in `app.ts`, `seed/index.ts` seeders, `src/i18n/messages.ts`, `src/lib/app-routes.ts`, the #59 policy rules, #69's event map and templates seed, `drizzle/meta/*` (regenerated). **X5:** `site-header.tsx`/`header-nav.tsx` get a "My institution" link for `institution_admin` holders; serialize with 59b/69/78/81a.

## Chosen design (codebase-design, 3 options compared)
- **(a) Shallow:** a status column, plus three use cases (`verify`/`reject`/`suspend`), each re-checking the allowed `from` inline. The interface is wide: 3 use cases × authz tests, and the transition rules are spread across 3 places. Fails the locality test.
- **(b) Chosen, deep module:** the pure `decideInstitutionStatus({from, decision, reason})` holds every rule (allowed moves, outcome, `issuesInstitutionCode`, reason trimmed and length-checked) behind one small interface. That makes it the single source the 12-pair table test pins. One use case, `decideInstitution({institutionId, decision, reason})`, runs `can()`, then selects `FOR UPDATE`, calls `decideInstitutionStatus`, and on `issuesInstitutionCode` runs `withUniqueCode({format: INSTITUTION_CODE, constraint: "institution_institution_code_unique"}, code => tx.transaction(sp => update…))`. A savepoint is required because a 23505 aborts the outer transaction. After that it grants the role, writes audit and calls `emit`, all in one transaction. The admin UI has three buttons that post one Server Action with `decision`.
- **(c) Generic state-machine library** shared by all ~25 machines: one adapter today, so the seam is hypothetical. Rejected for now. (b)'s table shape is the template later machines copy.
- **Codes:** a deep function, `withUniqueCode(options, attempt)`. Callers never see the alphabet, the bias argument, the retry count or driver error shapes (PGlite `constraint` vs postgres-js `constraint_name`, the Drizzle `cause` chain). There's no `Random` port in `Deps` (X1 stays untouched). The retry is proven at the unit level with an injected `random`, and once against real PGlite.

## Residue
- **HR-05:** encryption keys per environment (inherited from #58; this unit adds no new key).
- **HR-31:** retention periods marked "to confirm" for every new inventory row.
- **HR-34:** FOA's institution verification checklist (the default is a free-text reason). Also: may a rejected institution re-apply, and may staff reinstate a suspended one? Both are default decisions above.
- Not run: the Seam 2 axe spec (no Postgres server here; previews fail at `db:migrate`).

## Test plan
- **Unit:** `codes/*.test.ts` and `institutions/domain/status.test.ts` (done), `institutions/input.test.ts` (pin code, phone via #58, participants range), `privacy/inventory.test.ts` (coverage).
- **Seam 1:** `register.test.ts`, `decide.test.ts`, `outcome-messages.test.ts`, `queries.test.ts`, `seed/institutions.test.ts`. Each uses `createHarness()`, the fake clock, `h.drain()` and the email fake, with no mocks of our own modules.
- **Seam 2:** `tests/e2e/73-institutions.spec.ts` (axe, 4 pages, plus a dark run), listed under "Not run".

## Slices (ordered; each = one behaviour, one test file)
1. **Register and see it pending.** Schema, migration, `registerInstitution` + `getMyInstitution`, input validation, encrypted principal fields, the registration audit row and the inventory rows. Test file: `register.test.ts` (AC 1, 2, 9 partial, 10).
2. **Staff decide.** `decideInstitution`: transitions, reason, Institution ID through `withUniqueCode`, role grant, audit. Test file: `decide.test.ts` (AC 3–7, 9).
3. **The outcome reaches the person.** Outbox events plus #69 map rows and templates, then drain to email and the inbox. Test file: `outcome-messages.test.ts` (AC 8).
4. **The admin queue and the seed.** `listInstitutions` (status filter, oldest pending first) and `getInstitutionForReview`, plus the seeder. Test files: `queries.test.ts` and `seed/institutions.test.ts` (AC 9, 11).
5. **The pages.** 4 pages, 2 namespaces, routes and the header link (X5). Test file: `tests/e2e/73-institutions.spec.ts` (AC 12, not run).
