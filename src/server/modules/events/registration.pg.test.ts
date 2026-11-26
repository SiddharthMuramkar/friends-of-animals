import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { details } from "./testing";
let w: PgWorld;
beforeAll(() => {
  w = createPgWorld();
});
afterAll(async () => w.close());

it("serializes real concurrent capacity claims and cancellation with FIFO promotion, and idempotent check-in", async () => {
  const organizer = await w.seed.member({ email: w.uniqueEmail() });
  await w.seed.grant(organizer, {
    role: "community_manager",
    scope: { type: "global" },
  });
  await w.seed.authenticator(organizer);
  const staff = w.as(await w.signedIn(organizer, { secondFactor: true }));
  const made = await staff.createEvent(
    details(w.clock.now(), { capacity: 1, audience: "signed_in" })
  );
  if (!made.ok) throw Error(made.error);
  const eventId = made.eventId;
  await staff.publishEvent({ eventId });
  const apis = [];
  for (let i = 0; i < 4; i++) {
    const account = await w.seed.member({ email: w.uniqueEmail() });
    apis.push(w.as(await w.signedIn(account)));
  }
  const [a, b, c, d] = apis;
  const concurrent = await w.sql.begin(async (blocker) => {
    await blocker`select id from event where id=${eventId} for update`;
    const first = a!.registerForEvent({ eventId });
    first.catch(() => {});
    await w.waitForLockWaiters(1);
    const second = b!.registerForEvent({ eventId });
    second.catch(() => {});
    await w.waitForLockWaiters(2);
    return { first, second };
  });
  const first = await concurrent.first,
    second = await concurrent.second;
  expect(first).toMatchObject({ ok: true, status: "registered" });
  expect(second).toMatchObject({ ok: true, status: "waitlisted", position: 1 });
  if (!first.ok || !second.ok) throw Error("Claim failed");
  expect(await c!.registerForEvent({ eventId })).toMatchObject({
    ok: true,
    status: "waitlisted",
    position: 2,
  });
  const race = await w.sql.begin(async (blocker) => {
    await blocker`select id from event where id=${eventId} for update`;
    const cancel = a!.cancelEventRegistration({
      registrationId: first.registrationId,
    });
    cancel.catch(() => {});
    await w.waitForLockWaiters(1);
    const join = d!.registerForEvent({ eventId });
    join.catch(() => {});
    await w.waitForLockWaiters(2);
    return { cancel, join };
  });
  expect(await race.cancel).toMatchObject({ ok: true });
  expect(await race.join).toMatchObject({
    ok: true,
    status: "waitlisted",
    position: 2,
  });
  expect(await b!.listMyEventRegistrations()).toMatchObject([
    { status: "registered" },
  ]);
  expect(await c!.listMyEventRegistrations()).toMatchObject([
    { status: "waitlisted", position: 1 },
  ]);
  w.clock.advance({ hours: 47 });
  const check = await w.sql.begin(async (blocker) => {
    await blocker`select id from event where id=${eventId} for update`;
    const firstCheck = staff.checkInAttendee({
      registrationId: second.registrationId,
    });
    firstCheck.catch(() => {});
    await w.waitForLockWaiters(1);
    const secondCheck = staff.checkInAttendee({
      registrationId: second.registrationId,
    });
    secondCheck.catch(() => {});
    await w.waitForLockWaiters(2);
    return { firstCheck, secondCheck };
  });
  expect(await Promise.all([check.firstCheck, check.secondCheck])).toEqual(
    expect.arrayContaining([
      { ok: true },
      { ok: false, error: "already_checked_in" },
    ])
  );
  expect(
    (await b!.getTimeline()).entries.filter(
      (row) => row.kind === "event.attended"
    )
  ).toHaveLength(1);
});
