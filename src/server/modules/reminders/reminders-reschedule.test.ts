import { describe, expect, it } from "vitest";

import { registrants } from "@/server/modules/announcements/testing";
import { signInManager } from "@/server/modules/competitions/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";

import {
  DEADLINE,
  hoursBefore,
  KEY_DATES,
  reminderCompetition,
  remindedByEmail,
  reminderRows,
  scheduleFor,
  WORKER,
} from "./testing";

// #84 84b AC4 and AC5, and cancellation: changing a competition's
// deadline reschedules its reminders (the old ones do nothing at their
// old time, the new ones send at theirs); changing the offset settings
// keeps the reminders that still match, supersedes the rest and plans
// the new ones; cancelling the competition cancels them all.

/** Two days after DEADLINE: 23:59 IST on 15 February 2027. */
const MOVED_DEADLINE = new Date("2027-02-15T18:29:00.000Z");

async function competitionWithAsha() {
  const h = await createHarness();
  const competition = await reminderCompetition(h);
  await registrants(h, competition).adult({
    name: "Asha Rao",
    email: "asha@example.test",
  });
  await h.drain();
  await scheduleFor(h, competition.id);
  return { h, competition };
}

describe("rescheduling reminders", () => {
  it("follows the deadline when a manager moves it two days later", async () => {
    const { h, competition } = await competitionWithAsha();
    const manager = await signInManager(h);

    const updated = await h.as(manager).updateCompetition({
      competitionId: competition.id,
      keyDates: { ...KEY_DATES, submissions_close: "2027-02-15T23:59" },
    });
    await h.drain();

    expect(updated).toEqual({ ok: true, changed: true });
    expect(
      (await reminderRows(h, competition.id)).map((row) => [
        row.offsetHours,
        row.deadlineAt,
        row.status,
      ])
    ).toEqual([
      [72, DEADLINE, "superseded"],
      [24, DEADLINE, "superseded"],
      [72, MOVED_DEADLINE, "scheduled"],
      [24, MOVED_DEADLINE, "scheduled"],
    ]);

    // The old reminder's time: its job finds itself superseded.
    h.clock.set(hoursBefore(72));
    await h.drain();
    expect(remindedByEmail(h)).toEqual([]);

    h.clock.set(hoursBefore(72, MOVED_DEADLINE));
    await h.drain();
    expect(
      h.email.sent
        .filter((message) => message.to === "asha@example.test")
        .map((message) => message.subject)
    ).toContain(
      "Reminder: submissions for Paws for Thought close on 15 February 2027 at 11:59 pm IST"
    );
  });

  it("keeps matching reminders and plans the new ones after the offsets change", async () => {
    const { h, competition } = await competitionWithAsha();
    const [r72, r24] = await reminderRows(h, competition.id);

    await h.settings.set("reminders.entrySubmissionDueFirstHours", 48);
    await h.as(WORKER).syncReminders();

    const rows = await reminderRows(h, competition.id);
    expect(rows.map((row) => [row.id, row.offsetHours, row.status])).toEqual([
      [r72!.id, 72, "superseded"],
      [expect.any(String), 48, "scheduled"],
      [r24!.id, 24, "scheduled"],
    ]);
    h.clock.set(hoursBefore(72));
    await h.drain();
    expect(remindedByEmail(h)).toEqual([]);
    h.clock.set(hoursBefore(48));
    await h.drain();
    expect(remindedByEmail(h)).toEqual(["asha@example.test"]);
  });

  it("sends nothing for an offset turned off before the sync has run", async () => {
    const { h, competition } = await competitionWithAsha();

    await h.settings.set("reminders.entrySubmissionDueFirstHours", 0);
    h.clock.set(hoursBefore(72));
    await h.drain();

    expect(remindedByEmail(h)).toEqual([]);
    expect(
      (await reminderRows(h, competition.id)).map((row) => row.status)
    ).toEqual(["superseded", "scheduled"]);
  });

  it("cancels every reminder when a super admin cancels the competition", async () => {
    const { h, competition } = await competitionWithAsha();
    const admin = await signInStaff(h, "super_admin");

    const cancelled = await h.as(admin.actor).cancelCompetition({
      competitionId: competition.id,
      reason: "The venue is closed.",
    });
    await h.drain();

    expect(cancelled).toEqual({ ok: true, status: "cancelled" });
    expect(
      (await reminderRows(h, competition.id)).map((row) => row.status)
    ).toEqual(["cancelled", "cancelled"]);
    h.clock.set(hoursBefore(24));
    await h.drain();
    expect(remindedByEmail(h)).toEqual([]);
  });
});
