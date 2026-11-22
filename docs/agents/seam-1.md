# Seam 1: use-case tests

Almost every test calls use cases the way server actions and route handlers do,
`as(actor).<useCase>(input)`, through the harness in `src/test/harness.ts`. It
runs on PGlite with the real migrations, a fake clock and in-memory fakes at the
provider ports. Never mock an internal module.

## The template

```ts
import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

describe("someUseCase", () => {
  it("does what the actor expects", async () => {
    const h = await createHarness();
    const member = await h.seed.member();

    const result = await h.as(h.visitor()).someUseCase({ email: member.email });

    expect(result).toEqual({ ok: true });
    expect(h.email.lastTo(member.email)?.subject).toBe("Your sign-in code");
  });
});
```

## What the harness gives a test

| Field                       | What it is                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `h.as(actor)`               | The app's use cases, acting as `actor`, over the harness deps (`createApp(deps)` from `src/server/app.ts`)                                                                                                                                                                                                                                                                                              |
| `h.visitor(meta?)`          | A signed-out actor with documentation IP `203.0.113.10`; pass `{ ip }` to vary it                                                                                                                                                                                                                                                                                                                       |
| `h.seed`                    | `src/server/seed/` builders on this database and clock: `member()` (with `phone`), `superAdmin()`, `grant()`, `authenticator()`, `guardian({ children })` (a verified guardian, #81), `preview()`                                                                                                                                                                                                       |
| `h.clock`                   | `FakeClock`: `now()`, `advance({ minutes: 10 })`, `set(instant)`. Starts at `DEFAULT_TEST_INSTANT`                                                                                                                                                                                                                                                                                                      |
| `h.email`                   | `FakeEmail`: `sent`, `lastTo(address)`, `codeFor(address)`, `failNext(n, error)`                                                                                                                                                                                                                                                                                                                        |
| `h.sms`                     | `FakeSms`: `sent` (with template and vars), `lastTo(phone)`, `codeFor(phone)`, `failNext(n, error)`; any spelling of the number                                                                                                                                                                                                                                                                         |
| `h.settings`                | `TestSettings` over this database's settings table, as use cases read it: every setting at its default (SMS off, email sign-in on) until `await set("sms.enabled", true)` or a super admin's `changeSetting`. Production also holds `auth.emailSignIn` off until SES can send to anyone: test that with `createApp({ ...h.deps, settings: settingsFor(h.deps.settings, { emailSignInReady: false }) })` |
| `h.signIn(user)`            | Signs `user` in through the real email-code flow (fresh IP) and returns the signed-in actor. Staff then pass their second factor too; `signIn(user, meta, { secondFactor: false })` stops after the email code                                                                                                                                                                                          |
| `h.passSecondFactor(actor)` | Passes the second factor for the actor's session with the seed authenticator (`SEED_TOTP_SECRET`), adding it if the user has no factor                                                                                                                                                                                                                                                                  |
| `h.totpCode(at?)`           | The seed authenticator's code at `at` (default now)                                                                                                                                                                                                                                                                                                                                                     |
| `h.currentActor()`          | Who the server sees on the browser's next request, from `h.cookies`, resolved as in production                                                                                                                                                                                                                                                                                                          |
| `h.cookies`                 | The browser's cookie store; `header()` saves a browser to pass to `currentActor(meta, cookie)` later                                                                                                                                                                                                                                                                                                    |
| `h.errors`                  | `FakeErrorReporter`: `reported`, each as Sentry would get it (scrubbed) plus the `error`                                                                                                                                                                                                                                                                                                                |
| `h.db`                      | This test's database, for asserting on rows (audit rows count as behaviour)                                                                                                                                                                                                                                                                                                                             |
| `h.deps`                    | `{ db, clock, email, sms, settings, errors, auth, cipher, blindIndex, storage, files, scanner, media, payments }`: what `productionDeps()` wires in `src/server/deps.ts`; fresh field keys per harness                                                                                                                                                                                                  |
| `h.drain()`                 | Delivers due outbox events in process with the real relay on every queue, pass after pass; returns the `DrainReport`                                                                                                                                                                                                                                                                                    |
| `h.storage`                 | `FakeStorage`: `put(url, bytes, headers)` and `get(url)` use presigned URLs as a browser does; `plant()`                                                                                                                                                                                                                                                                                                |
| `h.scanner`                 | `FakeMalwareScanner`: flags the EICAR test file (`src/test/eicar.ts`); `scans`, and `failNext(n)` as an outage                                                                                                                                                                                                                                                                                          |
| `h.media`                   | `FakeMediaProcessor`: derivatives sized from image headers, `processed` and `failNext(n, code)`                                                                                                                                                                                                                                                                                                         |
| `h.gateway`                 | `FakePaymentGateway`: `orders`, `capture(orderId)` (what Checkout hands back), `fail(orderId)`, `refuseNextOrder()`, and `webhook(event, { signature })`, signed, badly signed or unsigned; pass the same one again to replay it                                                                                                                                                                        |

`createHarness()` also fakes the system clock (`Date` only) and keeps it on
`h.clock`, because Better Auth reads `new Date()` for code and session expiry.
`src/test/setup.ts` puts real timers back after every test, and the harness
closes its database when the test ends, so no Postgres timer set by the fake
clock outlives it. Call `createHarness()` inside a test (or `beforeEach`).

Each `createHarness()` builds a fresh database (a copy of a template that
`src/test/global-setup.ts` migrates once per `vitest run`, before any test, about
0.3 s) and fresh fakes, so tests share nothing and no test pays for the
migrations. In watch mode, restart Vitest after changing a migration.

## Rules

- Use cases read time only from `ctx.clock` and ids from `uuidv7(ctx.clock.now())`.
  Never `new Date()`, `Date.now()` or `process.env` in a use case.
- Assert on what the actor sees: return values, what another use case can then
  read, what the fakes received, and the rows a compliance rule cares about.
- A new module adds one facade to `composeUseCases(...)` in `src/server/app.ts`.
  Two modules naming the same use case fail type-checking.
- A new provider port gets a port file in `src/server/ports/`, a production
  adapter, an in-memory fake in `src/test/fakes/`, and a shared
  `<port>.contract.ts` that both pass. Add the port to `Deps`, `productionDeps()`
  and `createHarness()`.
- A new module with preview data adds one seeder to `seeders` in
  `src/server/seed/index.ts`. Seeders must be safe to run again.
- A staff use case needs a staff actor who passed the second factor, which
  `h.signIn` gives by default. A step-up action (`stepUp(...)` in the
  policy) also needs it passed in the last 10 minutes: `h.passSecondFactor`
  again after `h.clock.advance`.

## Events and the outbox

A use case that must trigger work elsewhere (an email, a scan) emits a
domain event in the transaction that saves its change,
`emit(tx, ctx.clock, event)` from `src/server/outbox`, with `availableAt`
when the work must wait. Add the event and its handlers in
`src/server/outbox/events.ts` and `handlers.ts`. Reminders, status flips and
other recurring sweeps are `SCHEDULES` (`src/server/outbox/schedules.ts`)
instead. A test then drains and asserts on what the handler did:

```ts
const result = await h.as(h.visitor()).verifyEmailCode({ intent: "sign-up", ... });
await h.drain();
expect(h.email.lastTo(ASHA)?.subject).toBe("Welcome to Friends of Animals");
```

`h.drain()` runs the same relay as the VPS worker, so retries follow the fake
clock: `h.email.failNext(1)`, drain (retried), `h.clock.advance({ seconds: 30 })`,
drain again (sent). Failed deliveries are listed by `listFailedDeliveries(h.db)`.

## Files and storage

A use case that takes an upload goes through the Files module
(`src/server/modules/files`): `requestUpload` presigns, the test PUTs with
`h.storage.put(uploadUrl, bytes, headers)`, then `completeUpload` moves the
object from the upload key (`<prefix>incoming/<id>`) to the file's storage key
and checks it there. To plant an object the browser sent, `plant()` it at the
upload key. `h.storage.get(url)` opens a download URL. Both check the
signature, method, signed headers and expiry against `h.clock`, so
`h.clock.advance({ seconds: 301 })` makes a download URL fail with `expired`.
An upload URL, like R2's, takes another PUT until it expires.
To stand in for the scan, set the row's `status` to `clean` directly.
