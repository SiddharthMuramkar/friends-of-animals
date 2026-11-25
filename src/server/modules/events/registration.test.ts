import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { linkedTeen, staffActor } from "../volunteers/testing";
import { details } from "./testing";

it("gives one place, queues in order and atomically promotes on cancel and raised capacity", async () => {
  const h = await createHarness();
  const staff = h.as(await staffActor(h, "community_manager"));
  const publish = await staff.createEvent(
    details(h.clock.now(), { capacity: 1 })
  );
  if (!publish.ok) throw Error(publish.error);
  const eventId = publish.eventId;
  await staff.publishEvent({ eventId });
  const members = await Promise.all([
    h.seed.member(),
    h.seed.member(),
    h.seed.member(),
    h.seed.member(),
  ]);
  const actors = [];
  for (const m of members) actors.push(await h.signIn(m));
  const [a, b, c, d] = actors.map((actor) => h.as(actor));
  const register = { eventId };
  await expect(
    h.as(h.visitor()).registerForEvent(register)
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await a!.registerForEvent(register)).toEqual({
    ok: false,
    error: "members_only",
  });
  for (const api of [a!, b!, c!, d!])
    await api.joinCommunity({ displayName: "Friend of animals" });
  const first = await a!.registerForEvent(register);
  if (!first.ok) throw Error(first.error);
  expect(first.status).toBe("registered");
  expect(await a!.registerForEvent(register)).toEqual({
    ok: false,
    error: "already_registered",
  });
  h.clock.advance({ minutes: 1 });
  expect(await b!.registerForEvent(register)).toMatchObject({
    ok: true,
    status: "waitlisted",
    position: 1,
  });
  h.clock.advance({ minutes: 1 });
  expect(await c!.registerForEvent(register)).toMatchObject({
    ok: true,
    status: "waitlisted",
    position: 2,
  });
  await expect(
    c!.cancelEventRegistration({ registrationId: first.registrationId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(c!.listEventRegistrations({ eventId })).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(
    await a!.cancelEventRegistration({ registrationId: first.registrationId })
  ).toMatchObject({ ok: true });
  expect(await b!.listMyEventRegistrations()).toMatchObject([
    { status: "registered" },
  ]);
  expect(await c!.listMyEventRegistrations()).toMatchObject([
    { status: "waitlisted", position: 1 },
  ]);
  expect(await d!.registerForEvent(register)).toMatchObject({
    ok: true,
    status: "waitlisted",
    position: 2,
  });
  expect(
    await staff.updateEvent({
      eventId,
      ...details(h.clock.now(), { capacity: 2 }),
    })
  ).toMatchObject({ ok: true });
  expect(await c!.listMyEventRegistrations()).toMatchObject([
    { status: "registered" },
  ]);
  expect(await d!.listMyEventRegistrations()).toMatchObject([
    { status: "waitlisted", position: 1 },
  ]);
  expect(await staff.getEventPlaces({ eventId })).toMatchObject({
    capacity: 2,
    placesTaken: 2,
    waiting: 1,
  });
  expect(
    await a!.cancelEventRegistration({ registrationId: first.registrationId })
  ).toEqual({ ok: false, error: "invalid_transition" });
});

it("requires a current verified guardian for a minor, keeps their attendance distinct", async () => {
  const h = await createHarness();
  const staff = h.as(await staffActor(h, "content_manager"));
  const made = await staff.createEvent(
    details(h.clock.now(), { audience: "signed_in" })
  );
  if (!made.ok) throw Error(made.error);
  const eventId = made.eventId;
  await staff.publishEvent({ eventId });
  const family = await linkedTeen(h);
  const teen = h.as(family.teen.actor);
  const guardian = h.as(family.guardian.actor);
  const stranger = h.as(await h.signIn(await h.seed.member()));
  expect(await teen.registerForEvent({ eventId })).toEqual({
    ok: false,
    error: "guardian_required",
  });
  await expect(
    stranger.registerForEvent({ eventId, childId: family.profileId })
  ).rejects.toMatchObject({ code: "forbidden" });
  const registered = await guardian.registerForEvent({
    eventId,
    childId: family.profileId,
  });
  if (!registered.ok) throw Error(registered.error);
  expect(await teen.listMyEventRegistrations()).toMatchObject([
    { status: "registered" },
  ]);
  expect(
    await guardian.listMyEventRegistrations({ childId: family.profileId })
  ).toMatchObject([{ status: "registered" }]);
  expect(await guardian.listMyEventRegistrations()).toHaveLength(0);
  await expect(
    teen.checkInAttendee({ registrationId: registered.registrationId })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await staff.checkInAttendee({ registrationId: registered.registrationId })
  ).toEqual({ ok: false, error: "check_in_closed" });
  h.clock.advance({ hours: 47 });
  expect(
    await staff.checkInAttendee({ registrationId: registered.registrationId })
  ).toMatchObject({ ok: true });
  expect(
    await staff.checkInAttendee({ registrationId: registered.registrationId })
  ).toEqual({ ok: false, error: "already_checked_in" });
  expect(
    (await guardian.getTimeline({ childId: family.profileId })).entries
  ).toMatchObject([{ kind: "event.attended", refId: eventId }]);
  expect((await teen.getTimeline()).entries).toHaveLength(1);
  expect((await guardian.getTimeline()).entries).toHaveLength(0);
});

it("uses active membership, registration settings, and current cancellation authority", async () => {
  const h = await createHarness();
  const organizer = h.as(await staffActor(h, "community_manager"));
  const first = await organizer.createEvent(
    details(h.clock.now(), { capacity: 1, waitlistEnabled: false })
  );
  if (!first.ok) throw Error(first.error);
  const eventId = first.eventId;
  const a = h.as(await h.signIn(await h.seed.member()));
  const b = h.as(await h.signIn(await h.seed.member()));
  const visitor = h.as(h.visitor());
  await expect(visitor.listMyEventRegistrations()).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await a.registerForEvent({ eventId })).toEqual({
    ok: false,
    error: "registration_not_open",
  });
  await organizer.publishEvent({ eventId });
  await a.joinCommunity({ displayName: "Asha" });
  await b.joinCommunity({ displayName: "Beena" });
  await b.leaveCommunity();
  expect(await b.registerForEvent({ eventId })).toEqual({
    ok: false,
    error: "members_only",
  });
  const registered = await a.registerForEvent({ eventId });
  if (!registered.ok) throw Error(registered.error);
  await expect(
    visitor.cancelEventRegistration({
      registrationId: registered.registrationId,
    })
  ).rejects.toMatchObject({ code: "forbidden" });
  await b.joinCommunity({ displayName: "Beena" });
  expect(await b.registerForEvent({ eventId })).toEqual({
    ok: false,
    error: "full",
  });
  expect(
    await organizer.cancelEventRegistration({
      registrationId: registered.registrationId,
    })
  ).toMatchObject({ ok: true });
  expect(await b.registerForEvent({ eventId })).toMatchObject({
    ok: true,
    status: "registered",
  });
  await organizer.cancelEvent({ eventId });
  expect(await a.registerForEvent({ eventId })).toEqual({
    ok: false,
    error: "registration_not_open",
  });
});

it("capacity reductions preserve confirmed places; freeing a place while the event is running promotes the next waiter", async () => {
  const h = await createHarness();
  const staff = h.as(await staffActor(h, "community_manager"));
  const input = details(h.clock.now(), { audience: "signed_in", capacity: 2 });
  const made = await staff.createEvent(input);
  if (!made.ok) throw Error(made.error);
  const eventId = made.eventId;
  await staff.publishEvent({ eventId });
  const ap = h.as(await h.signIn(await h.seed.member())),
    bp = h.as(await h.signIn(await h.seed.member())),
    cp = h.as(await h.signIn(await h.seed.member()));
  const first = await ap.registerForEvent({ eventId });
  const second = await bp.registerForEvent({ eventId });
  if (!first.ok || !second.ok) throw Error("Expected confirmed places");
  expect(await cp.registerForEvent({ eventId })).toMatchObject({
    status: "waitlisted",
    position: 1,
  });
  await staff.updateEvent({ eventId, ...input, capacity: 1 });
  expect(await staff.getEventPlaces({ eventId })).toMatchObject({
    capacity: 1,
    placesTaken: 2,
    waiting: 1,
  });
  await ap.cancelEventRegistration({ registrationId: first.registrationId });
  expect(await cp.listMyEventRegistrations()).toMatchObject([
    { status: "waitlisted", position: 1 },
  ]);
  h.clock.set(input.startsAt);
  await staff.cancelEventRegistration({
    registrationId: second.registrationId,
  });
  expect(await cp.listMyEventRegistrations()).toMatchObject([
    { status: "registered" },
  ]);
});
