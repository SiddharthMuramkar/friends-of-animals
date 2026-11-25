import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { staffActor } from "../volunteers/testing";
import { details } from "./testing";

it("drafts are private, publication and cancellation control live public visibility", async () => {
  const h = await createHarness();
  const content = h.as(await staffActor(h, "content_manager"));
  const publicApi = h.as(h.visitor());
  const input = details(h.clock.now());
  await expect(publicApi.createEvent(input)).rejects.toMatchObject({
    code: "forbidden",
  });
  const made = await content.createEvent(input);
  if (!made.ok) throw Error(made.error);
  expect(await publicApi.getPublicEvent({ slug: made.slug })).toEqual({
    ok: false,
    error: "not_found",
  });
  expect((await publicApi.listPublishedEvents()).items).toHaveLength(0);
  const draft = await content.getEventForAdmin({ eventId: made.eventId });
  expect(draft).toMatchObject({
    ok: true,
    event: { status: "draft", description: "Bring a notebook.Read" },
  });
  expect(await content.publishEvent({ eventId: made.eventId })).toMatchObject({
    ok: true,
  });
  expect((await publicApi.listPublishedEvents()).items).toMatchObject([
    { title: input.title, status: "published" },
  ]);
  expect(await publicApi.getPublicEvent({ slug: made.slug })).toMatchObject({
    ok: true,
    event: { description: "Bring a notebook.Read" },
  });
  expect(await content.cancelEvent({ eventId: made.eventId })).toMatchObject({
    ok: true,
  });
  expect((await publicApi.listPublishedEvents()).items).toHaveLength(0);
  expect(await publicApi.getPublicEvent({ slug: made.slug })).toMatchObject({
    ok: true,
    event: { status: "cancelled" },
  });
  expect(await content.publishEvent({ eventId: made.eventId })).toEqual({
    ok: false,
    error: "invalid_transition",
  });
});

it("authorizes every administrative use case, rejects invalid transitions, and preserves slug on update", async () => {
  const h = await createHarness();
  const content = h.as(await staffActor(h, "content_manager"));
  const manager = h.as(await staffActor(h, "community_manager"));
  const wrong = h.as(await staffActor(h, "competition_manager"));
  const visitor = h.as(h.visitor());
  const sample = details(h.clock.now(), { title: "Change this title" });
  const made = await content.createEvent(sample);
  if (!made.ok) throw Error(made.error);
  const eventId = made.eventId;
  for (const api of [wrong, visitor]) {
    await expect(api.createEvent(sample)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.updateEvent({ eventId, ...sample })).rejects.toMatchObject(
      { code: "forbidden" }
    );
    await expect(api.publishEvent({ eventId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.cancelEvent({ eventId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.completeEvent({ eventId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.getEventForAdmin({ eventId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.listEventsForAdmin()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.getEventPlaces({ eventId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(api.listEventRegistrations({ eventId })).rejects.toMatchObject(
      { code: "forbidden" }
    );
    await expect(api.getCheckInSheet({ eventId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      api.checkInAttendee({ registrationId: eventId })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      api.settleEndedEvent({ eventId, endsAt: sample.endsAt.toISOString() })
    ).rejects.toMatchObject({ code: "forbidden" });
  }
  expect(await manager.listEventsForAdmin()).toHaveLength(1);
  expect(await manager.getEventForAdmin({ eventId })).toMatchObject({
    ok: true,
  });
  expect(await manager.getEventPlaces({ eventId })).toMatchObject({
    ok: true,
    placesTaken: 0,
  });
  expect(await manager.listEventRegistrations({ eventId })).toMatchObject({
    ok: true,
    items: [],
  });
  expect(await manager.getCheckInSheet({ eventId })).toMatchObject({
    ok: true,
    open: false,
  });
  expect(
    await manager.updateEvent({
      eventId,
      ...sample,
      title: "Updated title",
      description: '<script>bad()</script><img onerror="bad()">Safe words',
    })
  ).toMatchObject({ ok: true });
  expect(await manager.publishEvent({ eventId })).toMatchObject({ ok: true });
  expect(await visitor.getPublicEvent({ slug: made.slug })).toMatchObject({
    ok: true,
    event: { title: "Updated title", description: "Safe words" },
  });
  expect(await manager.completeEvent({ eventId })).toEqual({
    ok: false,
    error: "not_ended",
  });
  h.clock.set(sample.endsAt);
  expect(await manager.completeEvent({ eventId })).toMatchObject({ ok: true });
  expect(await visitor.getPublicEvent({ slug: made.slug })).toMatchObject({
    ok: true,
    event: { status: "completed" },
  });
  const worker = h.as({ kind: "system", process: "worker" });
  expect(
    await worker.settleEndedEvent({
      eventId,
      endsAt: sample.endsAt.toISOString(),
    })
  ).toMatchObject({ ok: true, settled: false });
});

it("audits changed operational fields without copying editor text", async () => {
  const h = await createHarness();
  const staff = h.as(await staffActor(h, "content_manager"));
  const input = details(h.clock.now());
  const made = await staff.createEvent(input);
  if (!made.ok) throw Error(made.error);
  const startsAt = new Date(+input.startsAt + 3600_000);
  const endsAt = new Date(+input.endsAt + 3600_000);
  await staff.updateEvent({
    eventId: made.eventId,
    ...input,
    startsAt,
    endsAt,
    description: "Some edited text",
    capacity: 3,
  });
  const { auditLog } = await import("../../db/schema");
  const { and, eq } = await import("drizzle-orm");
  const [entry] = await h.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityId, made.eventId),
        eq(auditLog.action, "event.updated")
      )
    );
  expect(entry).toMatchObject({
    before: {
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      capacity: 2,
    },
    after: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity: 3,
      changed: ["description", "startsAt", "endsAt", "capacity"],
    },
  });
  expect(JSON.stringify(entry)).not.toContain("Some edited text");
});
