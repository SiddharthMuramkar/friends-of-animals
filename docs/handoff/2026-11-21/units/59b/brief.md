# 59b: scoped roles, the can() policy and an append-only audit log (UI)

Branch `ticket/59-ui` · worktree `/root/foa-wt/59b` · base `foa/M0` · blocked by 59a · L · risk (auth) · key **X5** (site header/nav). No head start: nothing in 59b stands alone. Its logic is in 59a, and its pages need 57b's session and 59a's use cases. Create the worktree at build time from `foa/M0` once 59a has merged. If 59a is still open, base on `foa/ticket/59-backend` and set the PR base to M0 after 59a merges.

## Scope
- **In (59b):** `/admin/roles` (find a user; list, grant and revoke their scoped roles); `/admin/audit` (search by person, entity type and action, with pages); `/dashboard` (the user's areas, from `myAccess().dashboards`, plus the switcher); the `(staff)` admin route group with its layout, which #60 gates later; server actions; message namespaces; signed-in route registry entries; a "Dashboard" header link for signed-in users (X5); the Seam 2 journey; axe on all three pages, light and dark.
- **Out, 59a:** every use case, the policy, the tables, the trigger, the seed and the CLI. 59b has **no** DB access and **no** policy logic: every check goes through a use case, and pages only hide what the use case would refuse anyway.
- **Out, later:** step-up before grant and revoke (#60 adds it to this journey); institution, judge and organisation dashboards beyond placeholders (#73, #95, …); phone search (#58).

## Acceptance criteria (testable)
1. **Grant from the screen** (S2). A super admin opens `/admin/roles`, searches for a seeded member by email and picks institution_coordinator with the seeded institution id. They submit, and the role appears in that member's list without a reload error. Server action → zod → `grantRole`.
2. **Revoke from the screen** (S2 within the same journey). The super admin removes the grant, and it disappears from the list.
3. **Audit visible** (S2). After the grant, `/admin/audit` filtered by that member shows a `role.granted` row with actor, time (IST via `longDateTime`) and the before → after grant lists.
4. **Refusals render** (S2 + S1 in 59a). A signed-in member who opens `/admin/roles` or `/admin/audit` sees `ExplainState` (denied), not data. A visitor is redirected to `/sign-in`. Pages call `forbidden()` nowhere: `authInterrupts` is off (trap 11).
5. **Invalid grant messages** (S2 + action unit test). `scope_not_allowed`, `last_super_admin`, `not_found` and `forbidden` map to `adminRoles.*` messages in a `FormAlert`, with no stack or raw code shown.
6. **Switcher** (S2). The seeded multi-role user on `/dashboard` sees one link per area (member, admin, institution …). Each is a real link to that area's URL, so there's no stored active role. Areas whose routes don't exist yet link to a placeholder section on `/dashboard`.
7. **Audit pagination** (S2). "Older entries" uses a cursor in the URL search param and keeps the filters, with no client state needed.
8. **axe** (S2). `expectRendersAccessibly` passes on `/admin/roles`, `/admin/audit` and `/dashboard`, in light and dark (`.dark` on `<html>`). There's no horizontal scroll at 320–412 px, and targets are ≥ 44 px.
9. **Static public pages stay static.** `pnpm build` passes with the DB variables empty. Public routes stay ○/◐, and the header link doesn't read the session in the root layout (F7, trap 4).

## Interface needs (code against these)
```ts
// 59a use cases, via as(actor)
grantRole(i: { userId: string; role: Role; scope: Scope }): Promise<{ grant: Grant; changed: boolean }>
revokeRole(i: { userId: string; role: Role; scope: Scope }): Promise<{ changed: true }>
listUserRoles(i: { userId: string }): Promise<Array<Grant & { grantedAt: Date; grantedBy: string | null }>>
searchUsers(i: { query: string; limit?: number }): Promise<Array<{ id: string; name: string; email: string }>>
searchAuditLog(i: { person?: string; entityType?: string; entityId?: string; action?: string;
  cursor?: string; limit?: number }): Promise<{ entries: AuditEntryView[]; nextCursor: string | null }>
myAccess(): Promise<{ grants: Grant[]; dashboards: Dashboard[] }>
// AuditEntryView = { id, occurredAt: Date, actor: { kind, userId, name|null, role|null }, action,
//   entity: { type, id }, before: unknown, after: unknown, ip: string|null }
ROLES, ROLE_SCOPE_TYPES, isStaffRole, Dashboard        // src/server/access/domain (04e80b8)
DomainError { code: "forbidden"|"not_found"|"invalid_input"|"last_super_admin"; issues? }
// 57b (expected)
currentActor(): Promise<Actor>   // server-only: Better Auth session + x-forwarded-for + user-agent
//   used inside a Suspense boundary or a dynamic page, never at a layout's top level
ROUTES / signed-in registry in src/lib/routes.ts (or app-routes.ts) with SIGNED_IN_PREFIXES incl. /admin, /dashboard
tests/e2e/support/{mailbox,accounts}.ts: signInWithMailboxCode(page, email); SEED_ACCOUNTS
// 59a seed: SEED_SCOPES.institution.<name> id, a seeded member, and the multi-role seed user
```

## Files
- **New:** `src/app/(staff)/admin/layout.tsx` (admin nav shell; #60 adds its gate here), `admin/roles/page.tsx` + `_components/*` + `actions.ts` + `_lib/` (action error → message key, pure and unit-tested), `admin/audit/page.tsx` + `_components/*` + `_lib/` (search params ↔ filters, unit-tested), `src/app/dashboard/page.tsx` + `_components/*`. Also `messages/en-IN/{admin,adminRoles,adminAudit,dashboard}.json` and `tests/e2e/59-roles.spec.ts`.
- **Shared / hotspots:** `src/i18n/messages.ts` (append 4 namespaces); `src/lib/routes.ts` or 57b's signed-in registry (append); `src/components/site-header.tsx` / `header-nav.tsx` (**X5**: serialize with 57b, 69, 73, 78, 81a); `src/components/form/**` only if a select field is missing. A `SelectField` there is a design-system hotspot, so prefer a route-local `_components/role-select.tsx` instead.
- **Must not touch:** `src/proxy.ts` (X2: #60 owns the staff gate), `layout.tsx` (X3), any `src/server/**` file except importing use cases and domain types.

## Design
- **Active dashboard:** (a) a cookie, (b) a session column, or (c) the URL. **Chose c.** Each area is a URL, so the switcher is just links. There's no state to store or keep in sync, it works with `<Activity>` navigation, it touches no Better Auth schema (57b/60), and 59a's `dashboardsFor()` already gives the list.
- **Forms:** progressive-enhancement `<form action={serverAction}>` with `useActionState` in one small client island per form. That's the grant form and the revoke button. Search forms are plain GET forms that write search params, so there's no client JS and they're shareable.
- **Rendering:** admin pages are dynamic and read the session inside `<Suspense>` (traps 2, 4 and 5). There's no `'use cache'` on anything per-user. Dates are formatted with `getFormatter()` and `longDateTime`.
- **Scope id input:** a UUID text field for now, with a hint listing the seeded scope names. A picker comes once real institution and competition rows exist (#70, #73).

## Residue
- **HR-01:** the journey runs on previews only after `BETTER_AUTH_SECRET` + `CAPTURE_MAILBOX_TOKEN` are set and `e2e.yml` is on main. Until then it's run locally on port 3100, or not at all here (no Postgres server).
- **HR-28:** real-device checks of the three screens.

## Test plan
- Vitest: `_lib` mappers (error code → message key; search params ↔ filter object; dashboard → href) and the message-namespace tests that already exist (banned phrases, ICU). Vitest can't render async Server Components (trap 14).
- Seam 2: `tests/e2e/59-roles.spec.ts`. The seeded super admin signs in with a mailbox code, grants the seeded member `institution_coordinator` @ seeded institution, sees it listed, sees the audit row, then revokes it. The multi-role user opens `/dashboard` and follows each link. A member is refused on `/admin/roles`. `expectRendersAccessibly` runs on 3 pages × light and dark.
- **Not run:** Seam 2 and axe (no Postgres server here; previews fail at `pnpm db:migrate`).

## Slices (L → 4)
1. `src/app/(staff)/admin/roles/_lib/action-result.test.ts`: the admin layout shell, namespaces, the `/admin/roles` user search and grant list, and the grant/revoke actions with error mapping (AC1, 2, 4, 5).
2. `src/app/(staff)/admin/audit/_lib/filters.test.ts`: `/admin/audit` filters, table and cursor pages (AC3, 7).
3. `src/app/dashboard/_lib/dashboard-links.test.ts`: `/dashboard` areas, switcher, placeholders, header link (X5) (AC6, 9).
4. `tests/e2e/59-roles.spec.ts`: the journey, refusals and axe on all three pages, light and dark (AC1–8). Then build gate: public routes still static.
