# Brief 61a: outbox, relay, in-process drain, welcome email

Issue #61 (M0). Branch `ticket/61-outbox`, worktree `/root/foa-wt/61a`, base `foa/M0`. Size L, key X1, blocked by 57b.
Head start on `ticket/61-outbox`: 1480e35 (`retry-policy.ts`, `failure.ts` + tests; pnpm check green, 475 tests).
Prepped by foa-p61 on 2026-11-21 against `foa/ticket/57-harness` 0569f4f (PR #140, may still change).

## Scope
- **In (61a):** the `outbox` table and `emit(tx, clock, event)`; the relay (`drainOutbox`) that claims due deliveries, runs
  their handlers and settles them with retry/backoff from the injected clock; failed deliveries kept visible; `h.drain()`
  in the harness; the first handler (welcome email through `EmailSender`); sign-up emitting `identity.user_signed_up` in the
  user-creation transaction; an empty `SCHEDULES` registry type; a preview-only drain route (folded harness item, dag.md
  "preview drain route → 61a"; issues-M3-M4 M34-3 option 2) so Seam 2 journeys never wait on the VPS worker.
- **Out (61b owns):** `src/worker/**`, pg-boss install and schedules, `docker/workers.yml`, Dockerfile `worker` target,
  preview discovery, `worker_heartbeat`, worker DB roles SQL, `pnpm worker:dev`, `docker/README.md`. 61a adds **no**
  dependency (pg-boss arrives with 61b).
- **Out (others):** templates in the database (#69), staff screen for failed deliveries (#66/#69), consent step (#64).

## Acceptance criteria (testable)
1. Visitor sign-up with a new email writes exactly one pending `identity.user_signed_up` delivery for handler
   `notifications.send_welcome_email`, `aggregate_id` = the new user id, payload `{ userId }` with no email, in the same
   transaction as the user row. After `await h.drain()`, `h.email.lastTo(email)` is the welcome message. Signing in again
   with that email emits nothing. — Seam 1 (`as(visitor)` sign-up use cases from 57b).
2. A transaction that throws after `emit` leaves no outbox row, and `h.drain()` then sends nothing. — Seam 1 at the
   `emit` interface (Seam 1 can't force a failure inside 57b's transaction without mocking; review checks the `tx`).
3. Retry with backoff, then visibly failed. `h.email.failNext(2)`: drain (attempt 1 fails), drain again without advancing
   (nothing due), advance past each backoff and drain: sent on attempt 3, exactly once. Always failing: after
   `maxAttempts` the delivery is `failed` with `last_error` (no address in it), counted in the `DrainReport` and returned
   by `listFailedDeliveries(db)`. A claimed delivery whose lease expires (crash mid-handler) is due again. — Seam 1.
4. Idempotent: draining twice sends once; a delivery naming a handler this code doesn't know is left pending, untouched
   (worker-version skew on the shared preview worker). — Seam 1.
5. `h.drain()` exists, loops `drainOutbox` until a pass finds nothing due, needs no worker or pg-boss, and AC1's test uses
   it. — Seam 1 + harness self-test.
6. `POST /api/preview/drain` drains this deployment's database with the PR's code: 404 unless `APP_ENV` is `preview` or
   `local`; 401 without the right `x-foa-mailbox-token` (constant-time compare, same token as 57b's capture-mailbox route,
   so no new secret); `Cache-Control: no-store`; returns the `DrainReport`. — Vitest on the pure guard + Seam 2 spec
   `tests/e2e/61-welcome-email.spec.ts` (written, not run here).
7. Build: `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build` passes; the route is dynamic, public pages stay static.

## Files
- New: `src/server/outbox/{retry-policy,failure}.ts` + tests (**already built**, head start), `src/server/outbox/events.ts`
  (event union + handler registry), `emit.ts`, `relay.ts` (`drainOutbox`, `listFailedDeliveries`), `schedules.ts`
  (`SCHEDULES: readonly ScheduleDefinition[] = []`), `index.ts` (use-case facade `outboxUseCases`), `welcome-email.ts`
  (handler); `src/server/db/schema/outbox.ts`; migration `--name 61_outbox`; `messages/en-IN/emails.json` (or append to
  57b's namespace if it made one); `src/app/api/preview/drain/route.ts` + `_lib/guard.ts` + test;
  `tests/e2e/61-welcome-email.spec.ts`.
- Touch (hotspots): `src/test/harness.ts` (+`drain`, X1); `src/server/app.ts` (one `composeUseCases` arg);
  `src/server/db/schema/index.ts` (one barrel line); `drizzle/meta/*` (regenerated); `src/i18n/messages.ts` (append);
  57b's account-creation function (one `emit` line). 58 also edits sign-up and X1: 61a merges first, 58 rebases.
- **Plain-Node rule:** everything under `src/server/outbox/` and what it imports loads under tsx in 61b's worker: no
  `server-only`, no `@/env`, no Next imports (like `ports/email-capture.ts`). The route file is the only Next-bound file.

## Design (codebase-design: 3 interfaces compared)
- **A. The outbox is the delivery queue (chosen).** Use cases call one function, `emit(tx, clock, event)`. It writes one
  row per subscribed handler (delivery rows: `event_id` shared, `handler` named, idempotency key = row id). `drainOutbox`
  claims due rows (`status='pending' AND available_at <= $now AND (locked_until IS NULL OR locked_until <= $now)`,
  `FOR UPDATE SKIP LOCKED`, `attempts+1`, `locked_until = now + lease`), runs handlers outside the claim transaction, then
  settles with `settleDelivery` (head start). All times come from `ctx.clock`, never SQL `now()`. The same relay runs in the
  worker (61b), the preview drain route and `h.drain()`: the Seam 1 drain is the real code on PGlite, not a fake.
- **B. Outbox relayed into pg-boss jobs behind a `JobQueue` port** (pg-boss adapter + in-process fake), as issues-M0
  suggested. Rejected: pg-boss times retries with database `now()`, so the fake clock can't drive them and the Seam 1 fake
  would re-implement pg-boss retries (fidelity risk); failed jobs live in schema `pgboss`, which the DML-only app roles
  can't read (F6), so neither a staff view nor a drain route on Vercel can see them.
- **C. pg-boss `send` inside the use-case transaction from Vercel.** Rejected: needs `pgboss` grants for three
  env-specific app roles (F6) and couples every use case to pg-boss.
- pg-boss still does what #55 names it for: cron **schedules** in the worker (61b). A one-off future action (status flip
  at a deadline, reminder for one record) is an `emit` with `availableAt`, so it works on previews and under the fake
  clock. The PR states this deviation from the issues-M0 suggestion (R15).
- **Welcome atomicity (F8f, verified in better-auth 1.7.26):** `databaseHooks.*.create.after` is queued with
  `queueAfterTransactionHook` and runs after commit, and the Drizzle adapter defaults to `transaction: false`. So a BA hook
  is not atomic. FOA code must own user creation inside a Drizzle transaction (emailOTP `disableSignUp: true`, FOA creates
  the user, then BA signs in). If 57b let BA create users, 61a moves creation into identity's FOA code (append-only edit)
  and records why; a DB trigger is rejected because seed builders would emit welcome events in every test world.

## Interface needs (what 61a codes against)
```ts
// 57a (PR #140): Deps { db: AppDb; clock: Clock; email: EmailSender }, UseCaseContext = Deps & { actor: Actor },
// composeUseCases(...modules), createHarness(): Harness, uuidv7(at), FakeEmail.failNext(n), FakeClock.advance(d),
// Actor { kind: "system"; process: "worker" }.
// 57b: user creation in FOA code, inside the caller's transaction (name/path per 57b):
export function createAccount(tx: AppDb, clock: Clock, input: { email: string; name?: string }): Promise<User>;
// 57b: how its OTP email renders strings (reuse for the welcome email), e.g.
export function emailTranslator(namespace: "emails"): (key: string, values?: Record<string, string>) => string;
// 57b: capture-mailbox route token check (reuse for the drain route): header `x-foa-mailbox-token`, env CAPTURE_MAILBOX_TOKEN.
```
61a exports (61b, 63a, 64, 68, 71 code against these):
```ts
export type DomainEvent = { type: "identity.user_signed_up"; aggregate: { type: "user"; id: string }; payload: { userId: string } };
export function emit(tx: AppDb, clock: Clock, event: DomainEvent, options?: { availableAt?: Date }): Promise<void>;
export type DrainReport = { dispatched: number; retried: number; failed: number; skipped: number };
export function drainOutbox(deps: Deps, options?: { limit?: number }): Promise<DrainReport>;
export function listFailedDeliveries(db: AppDb, options?: { limit?: number }): Promise<FailedDelivery[]>;
export type ScheduleDefinition = { name: string; cron: string; tz: "Asia/Kolkata" | "UTC"; run(deps: Deps): Promise<void> };
export const SCHEDULES: readonly ScheduleDefinition[]; // [] in 61a
// harness: drain(): Promise<DrainReport>
```

## Schema (`outbox`, migration `61_outbox`)
`id` uuid pk (UUIDv7), `event_id` uuid, `event_type` text, `aggregate_type` text, `aggregate_id` uuid, `handler` text,
`payload` jsonb (ids only), `occurred_at`, `available_at`, `locked_until` (null), `attempts` int default 0, `last_error`
text, `status` enum `outbox_status` (pending|dispatched|failed), `dispatched_at`, `failed_at`; all `timestamptz` from the
clock. Partial index `(available_at) WHERE status = 'pending'`; index `(aggregate_type, aggregate_id)`. Enum created and
used in one migration is fine (only *adding a value* to an existing enum must be split).

## Residue
- HR-12: SES for the production worker (production's sender refuses until then, so prod deliveries would end `failed`;
  production is dormant).
- HR-01/HR-02 gate the Seam 2 welcome journey on previews (token + `e2e.yml` on `main`).
- Not run here: Seam 2 (no Postgres server; previews fail at `pnpm db:migrate`).

## Test plan
- Pure (done): `retry-policy.test.ts` (delay doubling and cap, every allowed and forbidden status transition, lease),
  `failure.test.ts` (name + message, redaction of emails and phone numbers, length cap, non-Error values).
- Seam 1: `emit.test.ts`, `relay.test.ts` (drain, idempotency, unknown handler, lease expiry, retry and failed),
  welcome test next to 57b's sign-up tests, harness self-test for `drain`.
- Vitest: `src/app/api/preview/drain/_lib/guard.test.ts`. Seam 2: `tests/e2e/61-welcome-email.spec.ts` (written, not run).

## Slices (ordered; each = one behaviour, one test file)
1. `emit` + outbox table + rollback (AC2): `src/server/outbox/emit.test.ts`.
2. Relay + `h.drain()` + welcome handler + `emails` messages (AC4, AC5): `src/server/outbox/relay.test.ts`.
3. Retry/backoff, lease expiry, failed visibility on `settleDelivery` (AC3): `src/server/outbox/retry.test.ts`.
4. Sign-up emits in the user transaction (AC1): `src/server/<identity>/sign-up-welcome.test.ts` (57b's folder).
5. Preview drain route (AC6, AC7): `src/app/api/preview/drain/_lib/guard.test.ts` + `tests/e2e/61-welcome-email.spec.ts`.
