# 59a: scoped roles, the can() policy and an append-only audit log (backend)

Branch `ticket/59-backend` · worktree `/root/foa-wt/59a` · base `foa/M0` 442dd99 · blocked by 57b · L · risk (auth, PD, SQL) · no conflict key.
**Head start on the branch:** `04e80b8 M0 #59: Add roles and can() policy domain core` (pure, 40 tests): `src/server/access/domain/{roles,policy,access-policy,dashboards}.ts`. Rebase it onto M0 once 57a and 57b land; it touches no shared file.

## Scope
- **In (59a):** enums `role` (16) and `role_scope_type`; tables `user_role` and `audit_log`; the append-only trigger (custom SQL); `can()` / `authorize()` over grants loaded fresh per use case; `recordAudit()`; use cases `grantRole`, `revokeRole`, `listUserRoles`, `searchUsers`, `searchAuditLog`, `myAccess`; the multi-role seed; `pnpm admin:bootstrap-super-admin`.
- **Out, 59b:** `/admin/roles`, `/admin/audit`, `/dashboard` + switcher, the `(staff)` admin layout, nav (X5), message namespaces, the Seam 2 journey, axe.
- **Out, later:** the staff 2FA gate and step-up on grant/revoke (#60, wraps these use cases); phone search through the blind index (#58); real institution, competition and organisation rows (#70, #73); the extra roles `foa_verifier`, DSL, grievance officer (#92/#94/#115/#116 add the enum values in their own migrations).

## Acceptance criteria (testable)
1. **Grant counts at once** (S1). `as(superAdmin).grantRole({userId, role:"institution_coordinator", scope:{type:"institution",id:A}})`, then the grantee's next use case that needs that role passes. Use `listUserRoles` / `myAccess` as the observable read. No re-sign-in.
2. **Revoke counts at once** (S1). After `revokeRole`, the same call as the grantee is refused (`forbidden`), even with the same actor object.
3. **Only a super admin manages roles** (S1). `grantRole` and `revokeRole` as `staff_admin`, as a plain member and as a visitor throw `DomainError("forbidden")`. They write no `user_role` row and no `audit_log` row.
4. **One audit row per change** (S1). A grant writes one row and a revoke writes one row, with: `action` `role.granted` / `role.revoked`, `entity` `{type:"user", id: granteeId}`, `before` / `after` = the grantee's sorted grant list (`sortGrants`, ids and role names only), `actor_user_id`, `actor_role:"super_admin"`, and `ip` / `user_agent` from `actor.meta`. Granting a grant they already hold is a no-op: `changed:false`, no row.
5. **Append-only at the database** (S1, raw SQL on `h.db`). `update audit_log`, `delete from audit_log` and `truncate audit_log` each reject (the trigger message names the operation), and the row count is unchanged.
6. **Audit search** (S1). `searchAuditLog` filters by `person` (actor, or a `user` entity), by `entityType` (+ optional `entityId`) and by `action`, alone and combined. Newest first; keyset pages (`limit`, `cursor` = last id) with no overlap or gaps. A member is refused, a staff admin allowed.
7. **can() table** (S1 + unit). Global role passes for any scope; a scoped role passes for its own id; it fails for another id of the same type (**scope mismatch**) and for another scope type; a visitor fails. Unit tests are done in 04e80b8. Add one S1 test that runs it end to end through `authorize` with DB-loaded grants.
8. **Valid grants only** (S1). A role at a scope it can't hold (for example `super_admin` @ institution) is refused with `invalid_input` / `scope_not_allowed`. So is an unknown user (`not_found`). Revoking the last global `super_admin` is refused with `last_super_admin`.
9. **Seed** (S1). Running `h.seed.preview()` twice gives the same rows. The super admin holds global `super_admin`. At least one member holds two or more grants across global and institution or competition scopes. Fixed scope ids are in `SEED_SCOPES`.
10. **Dashboards** (S1). `myAccess()` returns the actor's grants plus `dashboardsFor(grants)`, so a multi-role user sees member + admin + institution areas. A visitor is refused.
11. **Authorization tests per use case**: each use case gets one allowed-role test and at least one refused-role test.

## Interface needs from blockers (code against these; adapt names at rebase)
```ts
// 57a (PR #140), as on ticket/57-harness 0569f4f
type Actor = {kind:"visitor";meta:RequestMeta} | {kind:"user";userId:string;sessionId:string;meta:RequestMeta} | {kind:"system";process:"seed"|"worker"|"cli"};
type UseCaseContext = Deps & { actor: Actor };            // src/server/use-cases.ts
composeUseCases(...modules)                               // app.ts: append accessUseCases, auditUseCases
user: pgTable("user", { id: uuid PK, name, email unique, ... })  // FK target of user_role
ensureAccount(deps: SeedDeps, {id?, name, email}): Promise<User>; SEED_ACCOUNTS.superAdmin.id
uuidv7(at: Date): string;  Clock.now(): Date
// 57b (expected; not yet pushed)
h.signIn(user: {id:string}, meta?: Partial<RequestMeta>): Promise<Actor & {kind:"user"}>
//   fallback if absent: a local test helper building {kind:"user", userId, sessionId: uuidv7(now), meta}
class DomainError extends Error { constructor(readonly code: string, message?: string) }
//   fallback: 59a adds src/server/errors.ts with exactly this. Codes used: forbidden, not_found, invalid_input, last_super_admin
can() stub with #57's rules, if 57b ships one: 59a keeps every call site and moves its rules into
//   IDENTITY_POLICY (visitor may request/verify a code → add an `anyone` rule; own sessions → `owner`)
```

## What 59a provides (for #60, #63, #64, 59b)
```ts
// src/server/access/can.ts
can(ctx: UseCaseContext, action: Action, resource?: Resource): Promise<Decision>
authorize(ctx: UseCaseContext, action: Action, resource?: Resource): Promise<{ role: Role | null }> // throws forbidden
// src/server/access/policies.ts: POLICY = { ...IDENTITY_POLICY, ...ACCESS_POLICY }; Action = keyof typeof POLICY
// src/server/audit/record.ts
recordAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entity: {type: string; id: string};
  before: unknown; after: unknown; actorRole: Role | null }): Promise<void>
isStaffRole(role), grantSchema, sortGrants, dashboardsFor   // domain, already on the branch
```

## Files
- **New:** `src/server/db/schema/{access,audit}.ts`; `src/server/access/{can,policies,use-cases,grants}.ts` + tests; `src/server/audit/{record,search,use-cases}.ts` + tests; `src/server/seed/{access,scopes}.ts`; `scripts/bootstrap-super-admin.ts` + test of its argument parsing; `drizzle/NNNN_59_roles_audit.sql` (generated) and `drizzle/NNNN_59_audit_append_only.sql` (`--custom`, after it).
- **Shared (one line or one entry each):** `schema/index.ts` (2 `export *`); `seed/index.ts` (add `seedAccess` after `seedIdentity` in `seeders`; builders `grant(user, grant)` and `superAdmin()`); `src/server/app.ts` (2 modules in `composeUseCases`); `package.json` (`admin:bootstrap-super-admin` script, serialized); `drizzle/meta/*` (regenerated by the merge queue); `GLOSSARY.md` (Role, Scope, Grant, Policy, Audit log; via `domain-modeling`).
- **Not touched:** `harness.ts`, `deps.ts`, `actor.ts` (X1 stays with others). Grants are loaded from the DB, not put on the actor.

## Design (codebase-design; compared in context)
- **Policy shape.** (A) A per-action rule table with combinators. (B) A declarative role → action matrix. (C) A DB-editable permissions table. **Chose A.** Each later ticket adds its actions next to its use cases (locality). Ownership and system rules are first-class (B needs special cases for them). The interface is small: `decide(policy, subject, action, resource)` returns `{allowed, role}`. C adds a runtime attack surface that nobody asked for. Super admin is **not** a wildcard: every rule names its roles, and table tests make that visible.
- **Where grants come from.** (i) On the actor, loaded once per request. (ii) Loaded by `authorize()` inside every use case. **Chose ii.** AC1 and AC2 hold even for a reused actor object. It's one indexed query (`user_role (user_id)`), with no cache and no change to `Actor` or the harness. #60 may still add `secondFactorAt` to the actor.
- **Scope resolution.** The caller passes `resource.scopes` (every scope the target sits in) and `ownerId`. The policy only matches them, so it needs no per-entity resolvers.
- **Audit writes.** (a) An explicit `recordAudit(tx, …)` in the use case's transaction. (b) Generic row triggers that use `SET LOCAL` actor variables. **Chose a.** (b) needs session state through PgBouncer (§1.9), and it would copy whole rows, which means personal data (HR-30). `before` / `after` hold ids and changed fields only.
- **Tables.** `user_role` has `id`, `user_id` (FK → `user`, on delete cascade), `role`, `scope_type`, `scope_id` (uuid with no FK, because it's polymorphic), `granted_by_user_id` (FK, on delete set null) and `granted_at`. A check makes `scope_type='global'` true exactly when `scope_id IS NULL`. It has `UNIQUE NULLS NOT DISTINCT (user_id, role, scope_type, scope_id)` (Drizzle `.nullsNotDistinct()`). Revoking deletes the row; the history lives in the audit log.
- **`audit_log`.** Columns: `id` uuidv7, `occurred_at`, `actor_kind` enum (visitor, user, system), `actor_user_id` uuid, `actor_process`, `actor_role` role, `action`, `entity_type`, `entity_id` text, `before` / `after` jsonb, `ip`, `user_agent`. Indexes: (actor_user_id, occurred_at desc), (entity_type, entity_id, occurred_at desc), (action, occurred_at desc). **`actor_user_id` has no FK:** `ON DELETE SET NULL` would UPDATE the log and trip the trigger, which would block deleting a user.
- **Trigger.** `audit_log_reject_mutation()` in plpgsql, fired `BEFORE UPDATE OR DELETE FOR EACH ROW` and `BEFORE TRUNCATE FOR EACH STATEMENT`. **Verified on PGlite 18.6** today, along with `NULLS NOT DISTINCT` and the check constraint. It also binds the migrator, so data fixes and erasure need the owner's superuser path (HR-30).
- **Defaults, recorded and reversible.** The scopes per role (`ROLE_SCOPE_TYPES` in roles.ts). Staff = the 8 FOA roles (judge isn't staff). Staff admin may read roles, users and the audit log but never change grants. Re-granting is an idempotent no-op. The last global super admin can't be revoked. `searchUsers` matches the email prefix or name `ILIKE`, needs at least 2 characters and returns up to 20. The bootstrap CLI creates a verified account if the email has none, then grants through the use case as `{kind:"system",process:"cli"}`, which writes an audit row. IP is stored raw for forensics, with retention under HR-30.

## Residue
- **HR-17:** FOA names the super admins and other staff.
- **HR-18:** the owner runs `pnpm admin:bootstrap-super-admin --email <e>` against production with the migrator `DIRECT_URL`.
- **HR-30:** audit retention vs DPDP erasure, and keeping 365 days of IP. The trigger binds the migrator.

## Test plan
Seam 1 on PGlite via `createHarness()`. Unit tests for the domain are already on the branch. Raw SQL through `h.db.execute(sql\`…\`)` for AC5 (expect a reject; read the count with the query builder). Not run here: none for 59a (no pages). `pnpm db:migrate` against real Postgres is not run (no server).

## Slices (L → 5, each one test file, in order)
1. `src/server/audit/append-only.test.ts`: schema `audit.ts` + generated + custom migration; `recordAudit` writes a row; update/delete/truncate reject (AC5).
2. `src/server/access/grant-role.test.ts`: schema `access.ts`; `can`/`authorize` with DB grants; `grantRole` + `listUserRoles`; super-admin only; audit row; idempotent; invalid scope or unknown user (AC1, 3, 4, 7, 8, 11).
3. `src/server/access/revoke-role.test.ts`: `revokeRole`; immediate refusal; audit row; last super admin; not found (AC2, 3, 4, 8).
4. `src/server/audit/search-audit-log.test.ts` + `src/server/access/search-users.test.ts`: filters, keyset pages, refusals (AC6, 11).
5. `src/server/seed/access.test.ts` + `src/server/access/my-access.test.ts` + bootstrap CLI: idempotent multi-role seed, `SEED_SCOPES`, `myAccess` dashboards (AC9, 10; HR-18 tooling).
