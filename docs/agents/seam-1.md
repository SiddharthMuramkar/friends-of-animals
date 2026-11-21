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

| Field              | What it is                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `h.as(actor)`      | The app's use cases, acting as `actor`, over the harness deps (`createApp(deps)` from `src/server/app.ts`)                                                   |
| `h.visitor(meta?)` | A signed-out actor with documentation IP `203.0.113.10`; pass `{ ip }` to vary it                                                                            |
| `h.seed`           | Builders from `src/server/seed/` (`member()`, `preview()`), writing with this database and clock                                                             |
| `h.clock`          | `FakeClock`: `now()`, `advance({ minutes: 10 })`, `set(instant)`. Starts at `DEFAULT_TEST_INSTANT`                                                           |
| `h.email`          | `FakeEmail`: `sent`, `lastTo(address)`, `codeFor(address)`, `failNext(n, error)`                                                                             |
| `h.sms`            | `FakeSms`: `sent` (with template and vars), `lastTo(phone)`, `codeFor(phone)`, `failNext(n, error)`; any spelling of the number                              |
| `h.settings`       | `FakeSettings`: every setting at its default (SMS off) until `set("sms.enabled", true)`                                                                      |
| `h.signIn(user)`   | Signs `user` in through the real email-code flow (fresh IP) and returns the signed-in actor                                                                  |
| `h.currentActor()` | Who the server sees on the browser's next request, from `h.cookies`, resolved as in production                                                               |
| `h.cookies`        | The browser's cookie store; `header()` saves a browser to pass to `currentActor(meta, cookie)` later                                                         |
| `h.db`             | This test's database, for asserting on rows (audit rows count as behaviour)                                                                                  |
| `h.deps`           | `{ db, clock, email, sms, settings, cipher, blindIndex, ... }`: what `productionDeps()` wires for real in `src/server/deps.ts`; fresh field keys per harness |
| `h.drain()`        | Delivers due outbox events in process with the real relay, pass after pass; returns the `DrainReport`                                                        |

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

## Events and the outbox

A use case that must trigger work elsewhere (an email, a scan, a status
change later) emits a domain event in the transaction that saves its change,
`emit(tx, ctx.clock, event)` from `src/server/outbox`. Add the event and its
handlers in `src/server/outbox/events.ts` and `handlers.ts`. A test then
drains and asserts on what the handler did:

```ts
const result = await h.as(h.visitor()).verifyEmailCode({ intent: "sign-up", ... });
await h.drain();
expect(h.email.lastTo(ASHA)?.subject).toBe("Welcome to Friends of Animals");
```

`h.drain()` runs the same relay as the VPS worker, so retries follow the fake
clock: `h.email.failNext(1)`, drain (retried), `h.clock.advance({ seconds: 30 })`,
drain again (sent). Failed deliveries are listed by `listFailedDeliveries(h.db)`.
