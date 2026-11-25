import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { details } from "./testing";
import { staffActor, linkedTeen } from "../volunteers/testing";
import { person, publishDocument } from "../campaigns/testing";
it("waits for the actual reminder times, reschedules changes, suppresses queued/cancelled attendees and settles at end", async () => {
  const h = await createHarness();
  const manager = h.as(await staffActor(h, "community_manager"));
  const a = await person(h, { name: "Asha", email: "asha@example.test" });
  const b = await person(h, { name: "Beena", email: "beena@example.test" });
  const ap = h.as(a.actor),
    bp = h.as(b.actor);
  const input = details(h.clock.now(), { audience: "signed_in", capacity: 1 });
  const made = await manager.createEvent(input);
  if (!made.ok) throw Error(made.error);
  const eventId = made.eventId;
  await manager.publishEvent({ eventId });
  const booked = await ap.registerForEvent({ eventId });
  if (!booked.ok) throw Error(booked.error);
  await bp.registerForEvent({ eventId });
  await h.drain();
  const count = async (api: typeof ap) =>
    (await api.listInbox()).filter((x) => x.title.startsWith("Reminder:"))
      .length;
  expect(await count(ap)).toBe(0);
  expect(await count(bp)).toBe(0);
  h.clock.advance({ hours: 23, minutes: 59 });
  await h.drain();
  expect(await count(ap)).toBe(0);
  h.clock.advance({ minutes: 1 });
  await h.drain();
  expect(await count(ap)).toBe(1);
  expect(await count(bp)).toBe(0);
  const moved = {
    ...input,
    startsAt: new Date(+input.startsAt + 24 * 3600_000),
    endsAt: new Date(+input.endsAt + 24 * 3600_000),
  };
  await manager.updateEvent({ eventId, ...moved });
  await h.drain();
  expect(
    (await ap.listInbox()).some((x) => x.title.startsWith("Change:"))
  ).toBe(true);
  expect(
    (await bp.listInbox()).some((x) => x.title.startsWith("Change:"))
  ).toBe(true);
  h.clock.advance({ hours: 22 });
  await h.drain();
  expect(await count(ap)).toBe(1);
  h.clock.advance({ hours: 2 });
  await h.drain();
  expect(await count(ap)).toBe(2);
  await h.drain();
  expect(await count(ap)).toBe(2);
  h.clock.set(moved.endsAt);
  await h.drain();
  expect(await manager.getEventForAdmin({ eventId })).toMatchObject({
    ok: true,
    event: { status: "completed" },
  });
  expect(await ap.listMyEventRegistrations()).toMatchObject([
    { status: "no_show" },
  ]);
  expect(await bp.listMyEventRegistrations()).toMatchObject([
    { status: "cancelled" },
  ]);
});
it("sends child event notices only to the current verified guardian who consented, and rechecks withdrawal", async () => {
  const h = await createHarness();
  const manager = h.as(await staffActor(h, "content_manager"));
  const family = await linkedTeen(h);
  const gp = h.as(family.guardian.actor),
    tp = h.as(family.teen.actor);
  const documentId = await publishDocument(h, "communications");
  const result = await gp.giveChildConsent({
    childId: family.profileId,
    purpose: "communications",
    documentId,
  });
  expect(result).toMatchObject({ ok: true });
  const made = await manager.createEvent(
    details(h.clock.now(), { audience: "signed_in" })
  );
  if (!made.ok) throw Error(made.error);
  await manager.publishEvent({ eventId: made.eventId });
  await gp.registerForEvent({
    eventId: made.eventId,
    childId: family.profileId,
  });
  await h.drain();
  expect(
    (await gp.listInbox()).some((x) => x.title.startsWith("Registered:"))
  ).toBe(true);
  expect(
    (await tp.listInbox()).some((x) => x.title.startsWith("Registered:"))
  ).toBe(false);
  await gp.withdrawChildConsent({
    childId: family.profileId,
    purpose: "communications",
  });
  h.clock.advance({ hours: 24 });
  await h.drain();
  expect(
    (await gp.listInbox()).some((x) => x.title.startsWith("Reminder:"))
  ).toBe(false);
  expect(
    (await tp.listInbox()).some((x) => x.title.startsWith("Reminder:"))
  ).toBe(false);
});

it("sends capacity promotion and cancellation once, and does not send a reminder after cancellation", async () => {
  const h = await createHarness();
  const staff = h.as(await staffActor(h, "community_manager"));
  const a = await person(h, { name: "Uma", email: "uma@example.test" });
  const b = await person(h, { name: "Vivek", email: "vivek@example.test" });
  const ap = h.as(a.actor),
    bp = h.as(b.actor);
  const made = await staff.createEvent(
    details(h.clock.now(), { audience: "signed_in", capacity: 1 })
  );
  if (!made.ok) throw Error(made.error);
  const eventId = made.eventId;
  await staff.publishEvent({ eventId });
  const booked = await ap.registerForEvent({ eventId });
  if (!booked.ok) throw Error(booked.error);
  await bp.registerForEvent({ eventId });
  await h.drain();
  expect(
    (await bp.listInbox()).filter((r) => r.title.startsWith("Waitlisted:"))
  ).toHaveLength(1);
  await staff.cancelEventRegistration({
    registrationId: booked.registrationId,
  });
  await h.drain();
  expect(
    (await bp.listInbox()).filter((r) =>
      r.title.startsWith("A place is available:")
    )
  ).toHaveLength(1);
  expect(
    (await ap.listInbox()).filter((r) =>
      r.title.startsWith("Registration cancelled:")
    )
  ).toHaveLength(1);
  await staff.cancelEvent({ eventId });
  await h.drain();
  expect(
    (await bp.listInbox()).filter((r) => r.title.startsWith("Event cancelled:"))
  ).toHaveLength(1);
  h.clock.advance({ hours: 48 });
  await h.drain();
  expect(
    (await bp.listInbox()).filter((r) => r.title.startsWith("Reminder:"))
  ).toHaveLength(0);
  expect(
    (await bp.listInbox()).filter((r) => r.title.startsWith("Event cancelled:"))
  ).toHaveLength(1);
});

it("does not route queued messages to a revoked guardian or a teen", async () => {
  const h = await createHarness();
  const manager = h.as(await staffActor(h, "content_manager"));
  const family = await linkedTeen(h);
  const gp = h.as(family.guardian.actor),
    tp = h.as(family.teen.actor);
  const doc = await publishDocument(h, "communications");
  await gp.giveChildConsent({
    childId: family.profileId,
    purpose: "communications",
    documentId: doc,
  });
  const made = await manager.createEvent(
    details(h.clock.now(), { audience: "signed_in" })
  );
  if (!made.ok) throw Error(made.error);
  await manager.publishEvent({ eventId: made.eventId });
  const booking = await gp.registerForEvent({
    eventId: made.eventId,
    childId: family.profileId,
  });
  if (!booking.ok) throw Error(booking.error);
  // A revoked link is a fixture for a state changed by safeguarding staff.
  const { guardianLink } = await import("../../db/schema");
  const { eq } = await import("drizzle-orm");
  await h.db
    .update(guardianLink)
    .set({ revokedAt: h.clock.now() })
    .where(eq(guardianLink.participantProfileId, family.profileId));
  await expect(
    gp.listMyEventRegistrations({ childId: family.profileId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    gp.cancelEventRegistration({ registrationId: booking.registrationId })
  ).rejects.toMatchObject({ code: "forbidden" });
  await h.drain();
  h.clock.advance({ hours: 24 });
  await h.drain();
  for (const api of [gp, tp])
    expect(
      (await api.listInbox()).filter(
        (r) =>
          r.title.startsWith("Registered:") || r.title.startsWith("Reminder:")
      )
    ).toHaveLength(0);
});
