# Brief 62: runtime settings screen (issue #62, M0)

Branch `ticket/62-runtime-settings-screen` · worktree `/root/foa-wt/62` · base `foa/M0` 442dd99 · size M · risk (auth, step-up; money-adjacent flags) · keys none · blocker 60 (which needs 59a, 57b, 57a).
**Head start on the branch:** `3eee894 M0 #62: Add runtime settings domain core`: `src/server/settings/{definition,catalogue,values,form}.ts` and their tests. Rebase onto `foa/M0` once 60 is in. Keep the core and build on it.

## Scope
**In:** the `setting` table and migration; a typed catalogue (key, zod schema, default, input kind) holding the first four keys; the typed accessor `readSetting(db, key)`; the use cases `listSettings` and `changeSetting`, both super admin only, where a change needs step-up and writes an audit row with before and after; a preview seeder; `/admin/settings` (list, then edit with step-up); the `adminSettings` namespace; wiring the staff session lifetime (#60) and `sms.enabled` (#58, if it's on M0) to the accessor; Seam 2 spec plus axe.
**Out:** the keys later tickets add (#84, #108 80G toggle, #114 retention, #121/#122 thresholds, …); caching; settings history beyond the audit log (that's #59's audit search); a reset-to-default button (not asked for; a super admin can set the default value instead). No siblings: unit 62 is the whole issue.

## Acceptance criteria as testable checks
1. **View** (seam1). `as(superAdmin).listSettings()` returns all four keys in catalogue order, each with `value`, `defaultValue`, `source`, `input`, `updatedAt` and `updatedBy`. The screen shows the label, description, default and current value (seam2).
2. **Change takes effect without a deploy** (seam1). After `changeSetting({ key: "org.has80G", value: true })`, `readSetting(h.db, "org.has80G")` and the next `listSettings()` both return `true`, with no restart and no cache. Seam 2: change it on `/admin/settings`, reload, see the new value.
3. **Schema check** (seam1). `changeSetting({ key: "auth.staffSessionHours", value: 0 | 25 | 1.5 | "12" })` returns `{ ok:false, error:"invalid_value", problem }`, and nothing changes in `setting` or `audit_log`. An unknown key gives `unknown_setting`. The screen shows `adminSettings.errors.<reason>` with min and max (a clear message, from messages, never zod's English).
4. **Step-up** (seam1, fake clock). A super admin whose second factor is 10 min 1 s old gets `{ ok:false, error:"step_up_required" }` and no write; at 9 min 59 s the change goes through. The window and the check come from #60.
5. **Audit** (seam1). Each real change writes exactly one audit row: action `settings.change`, entity `setting` / `<key>`, `before {value, source}` and `after {value}`, plus the actor, IP and user agent. Submitting the value that already applies writes nothing (`changed:false`).
6. **Only a super admin** (seam1). `listSettings` and `changeSetting` called as a staff admin, a member or a visitor throw `DomainError("forbidden")`, and nothing is written.
7. **Defaults** (seam1). On a fresh database, with no seed, `readSetting` returns 12, false, false, false. A stored value that no longer passes its schema falls back to the default and is flagged `storedInvalid` (core already tested).
8. **Seed** (seam1). Running `seedPreview` twice leaves exactly four `setting` rows at their defaults. It never overwrites a value someone changed on the preview (`onConflictDoNothing`).
9. **Session lifetime binding** (seam1, via #60's harness). After the setting is set to 2, a newly signed-in staff user's session expires after 2 h (`clock.advance`). Existing sessions keep their expiry.
10. **axe** (seam2). `expectRendersAccessibly` on `/admin/settings` in the list state and the error state, light and dark; no horizontal scroll at 320 px.

## Files
- Exists (head start): `src/server/settings/{definition,catalogue,values,form}.ts` + tests.
- New: `src/server/db/schema/settings.ts` (`setting`: `key text pk`, `value jsonb not null`, `updated_by_user_id uuid null → user.id on delete set null`, `updated_at timestamptz not null`); `drizzle/NNNN_62_runtime_settings.sql` (generated, no custom SQL); `src/server/settings/{index,read,use-cases,policy?}.ts` + `settings.test.ts`; `src/server/seed/settings.ts`; `src/app/(staff)/admin/settings/{page.tsx,actions.ts,_components/*}`; `messages/en-IN/adminSettings.json`; `tests/e2e/62-settings.spec.ts`.
- Hotspot lines: `schema/index.ts` (+1 `export *`), `src/server/seed/index.ts` (+1 seeder after identity), `src/server/app.ts` (+`settingsUseCases`), `src/i18n/messages.ts` (3 lines), `src/lib/app-routes.ts` (signed-in route), the admin nav from 59b if it exists, #59's policy table (settings rules), #60's session-lifetime read (one line), #58's `sms.enabled` stub (if it's on M0).
- Conflicts: #58 may have added a stub `settings.get("sms.enabled")`. Replace it with `readSetting` and keep #58's call sites working. If #58 made `src/server/settings.ts` a file, move it into the folder.

## Design
Compared, using codebase-design's terms:
- **A. One catalogue object in the settings module** (chosen). Every key is in `SETTINGS` in `catalogue.ts`; TypeScript rejects a duplicate key for free; one place to see every knob.
- **B. Per-module registries** (`src/server/<module>/settings.ts`), composed by a `composeSettings(...)` barrel line each (issues-M0's suggestion). Rejected for now: the modules that own `org.*` and `sms.*` don't exist in M0, and the few later writers are in different milestones. Moving to B later is mechanical.
- **C. Declaration merging plus `registerSetting()` side effects.** Rejected: depends on import order, and a missing import fails silently.

**Accessor:** `readSetting(db, key)` reads through on every call, with no cache, so a change applies on every serverless instance straight away. It takes `db` (or a `tx`) as an argument. A `Settings` port on `Deps` is rejected: only one adapter (Postgres, local-substitutable with PGlite), and it would take X1. Use cases are thin: `authorize` (super admin), then step-up, then a transaction that selects the row `for update`, `resolveSetting`, `decideSettingChange`, upserts and writes the audit row. Labels and descriptions live in `adminSettings.settings.<group>.<name>.{label,description}` (keys contain dots, so they nest), with a test that every catalogue key has both. The page reads uncached under `<Suspense>` (no `'use cache'`), and the action calls one use case and then `refresh()` (`node_modules/next/dist/docs/01-app/02-guides/{forms,server-actions,authentication-with-cache-components}.md`). Booleans are an On/Off radio group (works without JS); integers are a number input with min and max.

## Interface needs from blockers (code against these; adapt names to what landed)
```ts
// 57a/57b: src/server/use-cases.ts, src/server/errors.ts
type UseCaseContext = Deps & { actor: Actor };            // Deps = { db: AppDb; clock: Clock; email }
class DomainError extends Error { code: "forbidden" | ... }
// 59a: roles, policy, audit
type RoleGrant = { role: Role; scope: { type: "global" } | { type: RoleScopeType; id: string } };
// Actor "user" gains roles: readonly RoleGrant[] (loaded per request)
function can(actor: Actor, action: "settings.view" | "settings.change", resource?: { type: "global" }): boolean;
function authorize(actor: Actor, action: ..., resource?): void;            // throws DomainError("forbidden")
function writeAudit(tx: AppDb, ctx: UseCaseContext, entry: {
  action: string; entityType: string; entityId: string; before: unknown | null; after: unknown | null;
}): Promise<void>;
// harness: h.seed.superAdmin(), h.seed.staffAdmin(), h.signIn(user) → Actor (or build the actor by hand)
// 60: step-up and session lifetime
const STEP_UP_WINDOW_MINUTES = 10;
function checkStepUp(ctx: UseCaseContext): { ok: true } | { ok: false; error: "step_up_required" };
// Actor "user" gains secondFactorAt: Date | null; harness h.stepUp(actor) sets it at clock.now()
// staff session lifetime read in a databaseHooks.session.create.before hook → becomes
//   await readSetting(deps.db, "auth.staffSessionHours")
// step-up UI: /auth/step-up?next=/admin/settings; (staff) layout gate for /admin/*
```
This unit exports:
```ts
readSetting<K extends SettingKey>(db: AppDb, key: K): Promise<SettingValue<K>>;
listSettings(): Promise<ResolvedSetting & { input; updatedAt: Date | null; updatedBy: { id; name } | null }[]>;
changeSetting(input: { key: string; value: unknown }): Promise<
  | { ok: true; changed: boolean }
  | { ok: false; error: "unknown_setting" | "step_up_required" }
  | { ok: false; error: "invalid_value"; problem: SettingValueProblem }>;
```
Fallback: if 59b's `(staff)` layout or admin nav isn't on M0, create `src/app/(staff)/admin/settings/` anyway. The page resolves the actor and shows `ExplainState` for anyone refused; the use cases enforce the rule regardless.

## Residue
- **HR-19:** FOA confirms the defaults: staff session 12 h (allowed range 1–24 is our default), step-up 10 min, `org.has80G` off, `org.fcraEnabled` off.
- **HR-16:** 80G registration; `org.has80G` stays off until then (FLAG).
- **HR-14:** DLT through MSG91; `sms.enabled` stays off (FLAG).
- **FCRA registration** has no HR id; propose a new HR row. `org.fcraEnabled` stays off.
- **HR-01:** the preview journey waits for the Vercel secrets and the DB; run it locally on port 3100.
- **HR-17/HR-18:** a production super admin must exist before anyone can use the screen.

## Test plan
- Seam 1 (`src/server/settings/settings.test.ts`, harness): ACs 1–9, with allow and deny tests per use case. The pure core is already covered by `values.test.ts`, `catalogue.test.ts` and `form.test.ts`.
- A messages test: every `SETTING_KEYS` entry has a label and description in `adminSettings.json`.
- Seam 2 (`tests/e2e/62-settings.spec.ts`): the seeded super admin signs in (mailbox code), does #60's TOTP step-up, opens `/admin/settings`, turns `org.has80G` on, reloads and sees it on; submits 25 hours and sees the error. `expectRendersAccessibly` in both states plus a `.dark` run. **Not run here:** no Postgres, so the journey runs only locally on port 3100 once the DB is up; the preview run is deferred.
- Gates: `pnpm check`; `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build` (public pages stay ○/◐; `/admin/settings` ƒ or ◐); `git status --porcelain` clean.

## Slices (size M → 1)
1. **Settings change through the screen** (AC 1–10, seam1 then seam2, `src/server/settings/settings.test.ts` + `tests/e2e/62-settings.spec.ts`). TDD order:
   1. schema and migration, then `readSetting` defaults (AC 7);
   2. `listSettings` allow and deny (AC 1, 6);
   3. `changeSetting` happy path plus audit (AC 2, 5);
   4. invalid value and unknown key (AC 3);
   5. step-up window (AC 4);
   6. seeder (AC 8);
   7. #60 lifetime and #58 flag binding (AC 9);
   8. messages, page and action, Seam 2 and axe (AC 10).
