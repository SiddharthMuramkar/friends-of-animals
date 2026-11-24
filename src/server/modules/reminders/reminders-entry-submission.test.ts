import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, inboxItem, user } from "@/server/db/schema";
import { registrants } from "@/server/modules/announcements/testing";
import { submittedImage } from "@/server/modules/entries/testing";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, type Harness } from "@/test/harness";

import {
  DEADLINE,
  DEADLINE_WORDS,
  hoursBefore,
  ownRegistration,
  reminderCompetition,
  remindedByEmail,
  remindedInApp,
  reminderRows,
  reminderSubject,
  reminderWorld,
  scheduleFor,
  WORKER,
} from "./testing";

// #84 84b AC2, AC3, AC6 and AC9: a reminder goes, at its time, only to
// whoever owes the deadline when it runs: an adult without an entry (or
// whose upload was rejected) and a minor's guardian, never the minor.
// Whoever has made an entry, or registered without confirming, gets
// nothing. A run after the deadline sends nothing, and after an outage
// only the nearest reminder goes. (Coordinators: reminders-coordinators.)

const ONE_MINUTE = 60 * 1000;

/** The person's upload for their registration goes in now. */
async function uploadFor(
  h: Harness,
  person: Parameters<Harness["signIn"]>[0],
  registrationId: string,
  bytes?: Uint8Array
) {
  const actor = await h.signIn(person);
  return submittedImage(h, { actor, registrationId }, bytes ? { bytes } : {});
}

describe("the submission reminder", () => {
  it("reminds only those who owe the deadline, once its time has come", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h);
    const vikram = await world.add.adult({
      name: "Vikram Shah",
      email: "vikram@example.test",
    });
    await world.add.adult(
      { name: "Pia Menon", email: "pia@example.test" },
      "pending_payment"
    );
    // Vikram's upload is in, still being checked: that counts as made.
    await uploadFor(h, vikram, await world.registrationOf(vikram));
    await scheduleFor(h, world.competitionId);

    h.clock.set(new Date(hoursBefore(72).getTime() - ONE_MINUTE));
    await h.drain();
    expect(remindedByEmail(h)).toEqual([]);

    h.clock.set(new Date(hoursBefore(72).getTime() + ONE_MINUTE));
    await h.drain();

    expect(remindedByEmail(h)).toEqual([
      "asha@example.test",
      "kavita@example.test",
    ]);
    expect(await remindedInApp(h)).toEqual([
      "asha@example.test",
      "kavita@example.test",
    ]);
  });

  it("still reminds an adult whose only upload was rejected", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);
    const dev = await registrants(h, competition).adult({
      name: "Dev Patel",
      email: "dev@example.test",
    });
    await uploadFor(
      h,
      dev,
      await ownRegistration(h, competition.id, dev),
      EICAR_TEST_BYTES
    );
    await h.drain();
    await scheduleFor(h, competition.id);

    h.clock.set(hoursBefore(72));
    await h.drain();

    expect(remindedByEmail(h)).toEqual(["dev@example.test"]);
  });

  it("says when submissions close, in IST, and names no child", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h);
    await scheduleFor(h, world.competitionId);

    h.clock.set(hoursBefore(72));
    await h.drain();

    const email = h.email.lastTo("kavita@example.test");
    expect(email?.subject).toBe(reminderSubject());
    expect(email?.text).toContain(
      `Submissions for Paws for Thought close on ${DEADLINE_WORDS}`
    );
    expect(email?.text).toContain("Hello Kavita Desai,");
    expect(email?.text).not.toContain("Isha");
    const [item] = await h.db
      .select({ title: inboxItem.title, body: inboxItem.body })
      .from(inboxItem)
      .innerJoin(user, eq(user.id, inboxItem.userId))
      .where(eq(user.email, "kavita@example.test"));
    expect(item).toEqual({
      title: "Submissions for Paws for Thought close soon",
      body: expect.stringContaining(DEADLINE_WORDS),
    });
  });

  it("checks who owes the deadline when it runs, not when it was planned", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h);
    await scheduleFor(h, world.competitionId);
    // Asha uploads after the reminder was planned.
    h.clock.set(hoursBefore(80));
    await uploadFor(h, world.asha, await world.registrationOf(world.asha));

    h.clock.set(hoursBefore(72));
    await h.drain();

    expect(remindedByEmail(h)).toEqual(["kavita@example.test"]);
  });

  it("sends a minor's reminder to their guardian, never the minor", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);
    const teen = await h.seed.member({
      name: "Rohan Desai",
      email: "rohan@example.test",
    });
    await registrants(h, competition).child({
      guardian: { name: "Kavita Desai", email: "kavita@example.test" },
      child: { fullName: "Rohan Desai", age: 15, loginUserId: teen.id },
    });
    await scheduleFor(h, competition.id);

    h.clock.set(hoursBefore(72));
    await h.drain();

    expect(remindedByEmail(h)).toEqual(["kavita@example.test"]);
    expect(await remindedInApp(h)).toEqual(["kavita@example.test"]);
  });

  it("marks the reminder fired and records it in the audit log", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);
    await scheduleFor(h, competition.id);

    h.clock.set(hoursBefore(72));
    await h.drain();

    const [first, second] = await reminderRows(h, competition.id);
    expect(first).toMatchObject({ status: "fired", firedAt: hoursBefore(72) });
    expect(second).toMatchObject({ status: "scheduled", firedAt: null });
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "reminder.fired"));
    expect(audit).toEqual([
      expect.objectContaining({
        actorKind: "system",
        actorProcess: "worker",
        entityType: "reminder_job",
        entityId: first!.id,
      }),
    ]);
  });

  it("sends the second reminder to whoever still owes the deadline then", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h);
    await scheduleFor(h, world.competitionId);
    h.clock.set(hoursBefore(72));
    await h.drain();
    await uploadFor(h, world.asha, await world.registrationOf(world.asha));

    h.clock.set(hoursBefore(24));
    await h.drain();

    expect(remindedByEmail(h, { since: hoursBefore(24) })).toEqual([
      "kavita@example.test",
    ]);
  });

  it("waits for its time when its job runs early", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);
    await registrants(h, competition).adult({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    await scheduleFor(h, competition.id);
    const [first] = await reminderRows(h, competition.id);

    // A worker whose clock runs an hour behind the one that planned it.
    h.clock.set(hoursBefore(73));
    const early = await h.as(WORKER).runReminder({ reminderJobId: first!.id });

    expect(early).toEqual({
      ok: true,
      outcome: "skipped",
      status: "scheduled",
      reason: "not_due",
    });
    expect(remindedByEmail(h)).toEqual([]);
    h.clock.set(hoursBefore(72));
    await h.drain();
    expect(remindedByEmail(h)).toEqual(["asha@example.test"]);
  });

  it("sends nothing when its job runs after the deadline", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h);
    await scheduleFor(h, world.competitionId);

    // The worker was down from before the first reminder until the deadline.
    h.clock.set(DEADLINE);
    await h.drain();

    expect(remindedByEmail(h)).toEqual([]);
    expect(
      (await reminderRows(h, world.competitionId)).map((row) => row.status)
    ).toEqual(["cancelled", "cancelled"]);
  });

  it("sends only the nearest reminder after an outage, not a burst", async () => {
    const h = await createHarness();
    const world = await reminderWorld(h);
    await scheduleFor(h, world.competitionId);

    // Down from before the first reminder until after the second's time.
    h.clock.set(hoursBefore(23));
    await h.drain();

    expect(
      h.email
        .inbox("asha@example.test")
        .filter((message) => message.subject === reminderSubject())
    ).toHaveLength(1);
    expect(remindedByEmail(h)).toEqual([
      "asha@example.test",
      "kavita@example.test",
    ]);
    expect(
      (await reminderRows(h, world.competitionId)).map((row) => [
        row.offsetHours,
        row.status,
      ])
    ).toEqual([
      [72, "superseded"],
      [24, "fired"],
    ]);
  });
});
