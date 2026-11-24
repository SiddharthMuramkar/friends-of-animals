import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messageDelivery } from "@/server/db/schema";
import { listFailedDeliveries } from "@/server/outbox";
import { createHarness } from "@/test/harness";

import {
  hoursBefore,
  recordEntry,
  remindedByEmail,
  remindedInApp,
  reminderRows,
  reminderSubject,
  reminderWorld,
  scheduleFor,
  WORKER,
} from "./testing";

// #84 84b AC7 and AC8: under "all participants", a school's coordinator
// gets one reminder per run covering every student of theirs who owes an
// entry, and none once all are in; the students and their guardians get
// none (the school submits for them). Under "shortlist only" school
// students owe nothing here. Draining twice, or retrying after a failed
// send, reaches nobody twice, and the reminder stays fired.

describe("the submission reminder for schools", () => {
  it("reminds each coordinator once for all their students without an entry", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h, { school: true });
    await scheduleFor(h, world.competitionId);

    h.clock.set(hoursBefore(72));
    await h.drain();

    expect(remindedByEmail(h)).toEqual([
      "asha@example.test",
      "kavita@example.test",
      "meera@example.test",
    ]);
    expect(await remindedInApp(h)).toEqual([
      "asha@example.test",
      "kavita@example.test",
      "meera@example.test",
    ]);
  });

  it("still reminds the coordinator while one student owes an entry, and not once none does", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h, { school: true });
    const [aanya, sana] = world.school!.students;
    await recordEntry(h, aanya!.registrationId, "submitted");
    await scheduleFor(h, world.competitionId);

    h.clock.set(hoursBefore(72));
    await h.drain();
    expect(remindedByEmail(h)).toContain("meera@example.test");

    await recordEntry(h, sana!.registrationId, "processing");
    h.clock.set(hoursBefore(24));
    await h.drain();
    expect(remindedByEmail(h, { since: hoursBefore(24) })).toEqual([
      "asha@example.test",
      "kavita@example.test",
    ]);
  });

  it("reminds no school under shortlist-only submission", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h, {
      school: true,
      digitalScope: "shortlist_only",
    });
    await scheduleFor(h, world.competitionId);

    h.clock.set(hoursBefore(72));
    await h.drain();

    expect(remindedByEmail(h)).toEqual([
      "asha@example.test",
      "kavita@example.test",
    ]);
  });
});

describe("sending each reminder once", () => {
  it("reaches nobody twice when the reminder runs again", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h, { school: true });
    await scheduleFor(h, world.competitionId);
    h.clock.set(hoursBefore(72));
    await h.drain();
    const [first] = await reminderRows(h, world.competitionId);

    // A second delivery of its event, as after a lost lease.
    const again = await h.as(WORKER).runReminder({ reminderJobId: first!.id });
    await h.drain();

    expect(again).toEqual({ ok: true, outcome: "sent", recipients: 3 });
    expect(remindedByEmail(h)).toEqual([
      "asha@example.test",
      "kavita@example.test",
      "meera@example.test",
    ]);
    expect(await remindedInApp(h)).toHaveLength(3);
  });

  it("retries a failed send without sending the others again", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h, { school: true });
    await scheduleFor(h, world.competitionId);
    h.clock.set(hoursBefore(72));

    h.email.failNext(1);
    await h.drain();
    expect(remindedByEmail(h)).toHaveLength(2);
    const [first] = await reminderRows(h, world.competitionId);
    expect(first?.status).toBe("fired");

    h.clock.advance({ seconds: 30 });
    await h.drain();

    expect(remindedByEmail(h)).toEqual([
      "asha@example.test",
      "kavita@example.test",
      "meera@example.test",
    ]);
    expect(await listFailedDeliveries(h.db)).toEqual([]);
    const sent = await h.db
      .select({ status: messageDelivery.status })
      .from(messageDelivery)
      .where(
        and(
          eq(messageDelivery.eventId, first!.id),
          eq(messageDelivery.channel, "email")
        )
      );
    expect(sent.map((row) => row.status)).toEqual(["sent", "sent", "sent"]);
    expect(
      h.email.sent.filter((message) => message.subject === reminderSubject())
    ).toHaveLength(3);
  });
});
