---
Status: proposed
---

# The outbox is the delivery queue; pg-boss runs only schedules

A use case saves its domain event in the transaction that saves its change,
as one outbox row per handler, and a relay delivers those rows: it claims due
ones with a lease, runs the handler, and retries with growing waits until a
delivery ends dispatched or failed. The same relay runs in the VPS worker, on
request in a preview, and in process in Seam 1 tests. pg-boss (in the worker)
runs only the recurring schedules (`SCHEDULES`), as #55 names it for. We
chose this over relaying events into pg-boss jobs behind a `JobQueue` port,
which issues-M0 suggested, because pg-boss decides when a job is due by the
database's `now()` (its fetch compares `start_after <= now()`), so the fake
clock couldn't drive retries in tests and a Seam 1 fake would have to copy
pg-boss's retry rules. Its failed jobs also live in the `pgboss` schema, which
the app's DML-only roles can't read, so neither a staff screen nor a preview
could see them.

## Considered Options

- Outbox relayed into pg-boss jobs behind a `JobQueue` port: rejected, as
  above.
- pg-boss `send` inside the use case's transaction from Vercel: needs grants
  on `pgboss` for each environment's app role, and ties every use case to
  pg-boss.

## Consequences

- Later tickets code against `emit(tx, clock, event, { availableAt? })` for
  work that follows a change, and `SCHEDULES` for recurring jobs, not a
  `JobQueue` port. A follow-up that must wait (a reminder for one record) can
  be an event with `availableAt`, which works on previews and under the fake
  clock.
- FOA creates accounts itself, so the sign-up event shares the account's
  transaction: Better Auth's after-create hooks run only after its own write
  commits, and its sign-up path is switched off.
- Delivery is at least once. A handler still running when its lease runs out
  may finish twice, so handlers must be safe to repeat.
