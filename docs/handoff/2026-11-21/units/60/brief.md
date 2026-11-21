# Brief: unit 60, staff two-factor gate and step-up (#60, M0)

Branch `ticket/60-staff-two-factor-gate-and`, worktree `/root/foa-wt/60`, base `foa/M0` 442dd99. Size L, risk (auth), key X2. Blocked by
59a; it also needs 57b and 57c (Better Auth, `session` table, actor resolution). No siblings: the unit owns all of #60. Head start
**done**: `3324dff M0 #60: Add second-factor domain core` (pure, 86 tests) in `src/server/modules/second-factor/domain/`.

## Scope
- **In.** Enrolling TOTP and passkeys; the second factor once per session; the staff gate on staff screens and staff use cases;
  step-up on `grantRole`/`revokeRole` (and on removing a factor); failure lockout; per-role session lifetimes; audit rows;
  a known TOTP secret on seeded staff (previews only); `/account/security`, `/auth/second-factor`, `/auth/step-up`.
- **Out.** Roles, `can()`, audit table and grant/revoke use cases (59a). `/admin/roles` UI and the `(staff)` admin shell (59b,
  which builds in parallel). Settings storage and screen (#62: it binds `auth.staffSessionHours` later; #60 ships code defaults).
  Step-up on later actions (#62 settings, #80, #99, #108, #109, exports): those tickets add one flag per action (design below).

## Acceptance checks (seam)
1. A staff-role holder without a factor: every staff-flagged use case refuses `enrolment_required` and `staffAccess()` returns
   `{ ok: false, code: "enrolment_required" }` (layout redirects to `/account/security`). Seam 1.
2. Enrolled but not verified in this session: `second_factor_required` (redirect `/auth/second-factor?next=`). Seam 1.
3. No staff role (member, judge, institution roles): `staffAccess()` is ok and nothing asks them to enrol. Seam 1.
4. `grantRole`/`revokeRole` pass with the session's second factor 9 min 59 s old and refuse `step_up_required` at 10 min 1 s
   (fake clock); a refusal writes no `user_role` change. Seam 1. (Pure boundary already proved in `domain/gate.test.ts`.)
5. TOTP verification follows `ctx.clock`: a code two steps old is refused, a used code can't be replayed. Seam 1 + pure (done).
6. A wrong code writes a committed `second_factor.failed` audit row; the 5th failure in 15 min locks for 15 min and writes
   `second_factor.locked`; while locked, the right code is refused `locked` with `retryAfter`. Seam 1.
7. Enrolment writes `second_factor.enrolled`, removal writes `second_factor.removed` and needs step-up; no secret, code or
   public key in `before`/`after`. Seam 1.
8. A staff session stops resolving after 12 h, a member's after 30 d (settings defaults); granting a staff role caps the
   grantee's live sessions at sign-in + 12 h. Seam 1 + pure (done, `domain/session-lifetime.test.ts`).
9. A passkey (`userVerification: "required"`) counts as an enrolled factor and verifies the session. Seam 1 with a software
   ES256 authenticator built from `node:crypto`.
10. Seeded staff carry a confirmed TOTP factor with `SEED_TOTP_SECRET`; a code from it passes `verifySecondFactor`. The seed
    only runs on preview/local (`seedTarget`, from 57a). Seam 1.
11. axe clean (`expectRendersAccessibly`, light + dark) on `/account/security` (none / enrolled), `/auth/second-factor`,
    `/auth/step-up`. Seam 2, Not run.
12. Journey: seeded super admin signs in, types the TOTP for `SEED_TOTP_SECRET` (computed with `domain/totp.ts`, no `otpauth`
    dependency), passes step-up, grants a role. Extend 59b's `tests/e2e/59-roles.spec.ts` if merged, else
    `tests/e2e/60-staff-two-factor.spec.ts`. Seam 2, Not run.

## Design (compared with codebase-design; risk-flagged)
- **A. Session stamp + policy flag (chosen).** Table `session_second_factor.verified_at` per session. One decision,
  `checkSecondFactor({ requirement: "staff" | "step-up", roles, status, now })` (built). 59a's policy rules gain
  `secondFactor?: "staff" | "step-up"`; `can()`'s internals load roles + this session's status and apply the decision. Sensitive
  use cases gain **no** parameters; later tickets mark their action. The layout gate is a Seam 1 use case `staffAccess()` plus a
  thin redirect, so the rule is tested once and enforced again in every staff use case (layouts don't re-run on client
  navigation and Server Actions are callable directly: Next `02-guides/data-security.md`). Deep: one flag at the interface;
  TOTP, passkeys, lockout and audit behind it.
- **B. Per-action verification.** Each sensitive use case takes `{ secondFactor: { code } }` and verifies inline. Every
  interface widens, every form collects a code, two grants in a row prompt twice, and replay handling repeats per call. Shallow,
  poor locality. Rejected.
- **C. Gate in `src/proxy.ts`.** Needs DB and session reads per request in proxy, doesn't cover Server Actions (so the policy
  check is needed anyway: two places), and collides with #65's CSP on X2. Rejected; proxy stays untouched unless 57b's
  signed-in redirect lists prefixes there, in which case add `/account/security` and `/auth/*`.
- **FOA-owned TOTP over Better Auth `twoFactor`** (§1.11 "staff 2FA is FOA code"): BA's enable flow wants a password (FOA is
  passwordless), its sign-in interception covers credential sign-ins, and it reads the system clock, not `ctx.clock`.
- **Passkeys via `@simplewebauthn/server` (exact pin) over `@better-auth/passkey`:** BA's passkey sign-in makes a new session
  instead of stamping the current one. RP id = host of `APP_URL`; challenges in `webauthn_challenge` with a 5 min expiry.
- **Secret at rest:** AES-256-GCM, `v1.<iv>.<ct>.<tag>`, key = HKDF-SHA-256(`BETTER_AUTH_SECRET`, "foa/second-factor/totp/v1").
  Rotating `BETTER_AUTH_SECRET` voids enrolments (residue note). Reuse #58's `FieldCipher` instead if it has landed.
- **Second-factor status is read per call** from `session_second_factor` by `actor.sessionId` (no cache, no `Actor` edit).
- **Lifetimes:** BA `databaseHooks.session.create.before` and `session.update.before` store `capSessionExpiry(...)`, so a
  refresh can't stretch a staff session; actor resolution also checks `isSessionLive` (defence in depth); 59a's `grantRole`
  caps the grantee's sessions in its transaction when the role is staff. Defaults in `second-factor/settings.ts` (#62 binds).
- **Recovery default (HR-19):** a super admin runs `resetSecondFactors({ userId })` (step-up, audited); no backup codes.

## Interface needs (signatures coded against; adapt names at build, not shapes)
```ts
// 57b/57c identity (Better Auth core tables, schema/identity.ts)
session: { id: uuid; userId: uuid; token: text; expiresAt: timestamptz; createdAt: timestamptz; /* ... */ }
createAuth(deps): BetterAuth // config accepts databaseHooks.session.{create,update}.before
resolveActor(deps: Deps, sessionToken: string | null, meta: RequestMeta): Promise<Actor> // #60 adds the isSessionLive check
harness: h.signIn(user: { id: string }, meta?): Promise<Actor & { kind: "user" }> // a real session row
// 59a access + audit (src/server/modules/{access,audit})
type Role = "member" | /* 14 more */ | "adoption_coordinator";
type RoleGrant = { role: Role; scope: { type: "global" } | { type: "institution" | "competition" | "organisation"; id: string } };
rolesOf(db: AppDb, userId: string): Promise<readonly RoleGrant[]>;
can(ctx: UseCaseContext, action: Action, resource?: Resource): Promise<void>; // throws DomainError("forbidden")
POLICY: Record<Action, { allow: (grants, resource) => boolean /* #60 adds: secondFactor?: "staff" | "step-up" */ }>;
writeAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entityType: string; entityId: string; before: unknown; after: unknown }): Promise<void>;
class DomainError extends Error { code: string; details?: Record<string, unknown> }
grantRole(ctx, { userId, role, scope }) / revokeRole(ctx, { userRoleId }) // actions "role.grant" / "role.revoke"
seed: SEED_ACCOUNTS.superAdmin holds super_admin after 59a's seeder; seeders run in order, #60's after access
// X1 (not held by this unit): one appended Deps field, plus its harness value (a fixed test key)
Deps.secretBox: { seal(plain: Uint8Array): string; open(sealed: string): Uint8Array }
```
If 59a's `can()` is sync and actor-only, add `authorize(ctx, action, resource)` beside it (can + second factor) and switch the
staff use cases to it; record the deviation in the PR.

## Files
- **New:** `src/server/db/schema/second-factor.ts` (enum `second_factor_kind` totp|passkey; `second_factor` id, user_id FK
  cascade, kind, label, totp_secret_sealed, totp_last_used_step bigint, confirmed_at null while pending, credential_id unique,
  public_key bytea, sign_count bigint, transports text[], created_at, kind check constraints; `session_second_factor` session_id
  PK FK cascade, verified_at, method; `second_factor_lockout` user_id PK, failures, window_started_at, locked_until;
  `webauthn_challenge` (session_id, purpose) PK, challenge, expires_at); migration `60_staff_two_factor`;
  `src/server/modules/second-factor/{use-cases,secret-box,passkeys,settings,index}.ts` + Seam 1 tests;
  `src/server/seed/second-factor.ts` (`SEED_TOTP_SECRET`); `src/app/account/security/**`, `src/app/auth/{second-factor,step-up}/**`
  (route-local `_components`, `_lib`); `messages/en-IN/security.json`; the e2e spec.
- **Shared, one line each (merge queue unions):** `schema/index.ts`, `seed/index.ts`, `src/server/app.ts` `composeUseCases`,
  `src/i18n/messages.ts` (3 lines), `src/lib/app-routes.ts` (57b), `drizzle/meta/*` (regenerated).
- **Hotspots:** `package.json`/lockfile (`@simplewebauthn/server`, `@simplewebauthn/browser`, `uqr` for a server-side SVG QR;
  exact pins); 57b's `auth.ts` (session hooks); 59a's policy table and `grantRole` (step-up flag, staff session cap); the
  `(staff)` layout (59b: wrap its children in `<Suspense><StaffGate>`; create it if 59b hasn't landed, union at merge);
  59b's roles journey; **X1** `deps.ts` + `src/test/harness.ts` for `secretBox` (orchestrator: grant X1 or confirm a cipher
  already sits on `Deps`); X2 `src/proxy.ts` likely untouched.
- UI rules: QR plus the base32 key as text (screen readers, manual entry); 6-digit input `inputMode="numeric"`,
  `autoComplete="one-time-code"`; passkey button only where `PublicKeyCredential` exists; session reads behind `<Suspense>`.

## Residue
- **HR-19** defaults to confirm: staff 12 h / member 30 d sessions, step-up 10 min, **new:** lockout 5 failures in 15 min → 15 min,
  lost-factor recovery = super admin reset (no backup codes).
- **HR-11** passkey RP id follows `APP_URL`; each preview host is its own RP id; production waits for FOA's domain.
- **HR-17** real staff enrol their own devices at go-live. **HR-01** Seam 2 needs the preview secrets; rotating
  `BETTER_AUTH_SECRET` voids TOTP enrolments (note it in the HR-01 wizard).

## Test plan
- Pure (done): `domain/{base32,totp,gate,session-lifetime,lockout}.test.ts`, RFC 4226/6238 vectors, 9:59/10:01 boundary.
- Seam 1 per slice below, on the harness: `h.signIn`, `h.clock.advance`, audit rows via `h.db`. Authorization tests per new
  use case (visitor refused; another user's factor refused; non-super-admin refused `resetSecondFactors`).
- Seam 2 + axe: AC 11-12, written, listed under "Not run" (no Postgres server here, previews fail at `pnpm db:migrate`).

## Slices (ordered; each one behaviour, one test file)
0. **Done** 3324dff: domain core.
1. TOTP enrolment and session second factor with lockout and audit, plus the seeded secret: `second-factor/totp.test.ts` (AC 5, 6, 7, 10).
2. Staff gate: `staffAccess()` and staff-flagged actions in `can()`: `second-factor/staff-gate.test.ts` (AC 1, 2, 3).
3. Step-up on grant/revoke and factor removal; `resetSecondFactors`: `second-factor/step-up.test.ts` (AC 4, 7).
4. Session lifetimes: BA hooks, grant cap, `isSessionLive` in actor resolution: `second-factor/session-lifetimes.test.ts` (AC 8).
5. Passkeys, the three screens, `security` namespace, Seam 2 spec: `second-factor/passkey.test.ts` + e2e (AC 9, 11, 12).
