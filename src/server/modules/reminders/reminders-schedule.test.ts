import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { signedInWith } from "@/server/modules/announcements/testing";
import {
  completeFields,
  signInManager,
} from "@/server/modules/competitions/testing";
import { createHarness } from "@/test/harness";

import {
  dueReminderEvents,
  hoursBefore,
  reminderCompetition,
  reminderRows,
  scheduleFor,
  WORKER,
} from "./testing";

// #84 84b AC1 and AC10: publishing a competition with a submission
// deadline plans one reminder per offset in settings (72 h and 24 h by
// default), each with a delayed `reminder.due` event at its fire time.
// Scheduling again with nothing changed plans nothing more. Only the
// platform schedules or runs reminders.

/** 23:59 IST on 28 February 2027, completeFields' submission deadline. */
const PUBLISHED_DEADLINE = new Date("2027-02-28T18:29:00.000Z");

describe("scheduling a competition's reminders", () => {
  it("plans one reminder per offset when a manager publishes the competition", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const created = await h.as(manager).createCompetition(completeFields());
    if (!created.ok) throw new Error(created.error);
    const competitionId = created.competition.id;

    const published = await h.as(manager).publishCompetition({ competitionId });
    await h.drain();

    expect(published).toMatchObject({ ok: true });
    const rows = await reminderRows(h, competitionId);
    expect(rows).toEqual([
      expect.objectContaining({
        reminderName: "entry_submission_due",
        offsetHours: 72,
        deadlineAt: PUBLISHED_DEADLINE,
        fireAt: hoursBefore(72, PUBLISHED_DEADLINE),
        status: "scheduled",
        firedAt: null,
      }),
      expect.objectContaining({
        reminderName: "entry_submission_due",
        offsetHours: 24,
        deadlineAt: PUBLISHED_DEADLINE,
        fireAt: hoursBefore(24, PUBLISHED_DEADLINE),
        status: "scheduled",
        firedAt: null,
      }),
    ]);
    expect(await dueReminderEvents(h)).toEqual([
      expect.objectContaining({
        aggregateType: "reminder_job",
        aggregateId: rows[0]!.id,
        handler: "reminders.run",
        payload: { reminderJobId: rows[0]!.id },
        availableAt: hoursBefore(72, PUBLISHED_DEADLINE),
      }),
      expect.objectContaining({
        aggregateId: rows[1]!.id,
        payload: { reminderJobId: rows[1]!.id },
        availableAt: hoursBefore(24, PUBLISHED_DEADLINE),
      }),
    ]);
  });

  it("plans nothing more when scheduling runs again with nothing changed", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);
    expect(await scheduleFor(h, competition.id)).toEqual({
      ok: true,
      scheduled: 2,
      kept: 0,
      superseded: 0,
      cancelled: 0,
    });

    const again = await scheduleFor(h, competition.id);

    expect(again).toEqual({
      ok: true,
      scheduled: 0,
      kept: 2,
      superseded: 0,
      cancelled: 0,
    });
    expect(await reminderRows(h, competition.id)).toHaveLength(2);
    expect(await dueReminderEvents(h)).toHaveLength(2);
  });

  it("plans nothing for a draft", async () => {
    const h = await createHarness();
    const draft = await h.seed.competition();

    expect(await scheduleFor(h, draft.id)).toMatchObject({ scheduled: 0 });
    expect(await reminderRows(h, draft.id)).toEqual([]);
  });

  it("follows the offsets in settings, and plans none for an offset at 0", async () => {
    const h = await createHarness();
    await h.settings.set("reminders.entrySubmissionDueFirstHours", 168);
    await h.settings.set("reminders.entrySubmissionDueSecondHours", 0);
    const competition = await reminderCompetition(h);

    await scheduleFor(h, competition.id);

    expect(
      (await reminderRows(h, competition.id)).map((row) => row.offsetHours)
    ).toEqual([168]);
  });

  it("schedules reminders for every live competition in the hourly sync", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);
    const other = await reminderCompetition(h, { name: "Whiskers and Wings" });

    const synced = await h.as(WORKER).syncReminders();

    expect(synced).toEqual({ ok: true, subjects: 2 });
    expect(await reminderRows(h, competition.id)).toHaveLength(2);
    expect(await reminderRows(h, other.id)).toHaveLength(2);
  });
});

describe("the reminders use cases: who may", () => {
  it("lets the worker schedule, sync and run reminders", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);

    await expect(scheduleFor(h, competition.id)).resolves.toMatchObject({
      ok: true,
    });
    await expect(h.as(WORKER).syncReminders()).resolves.toMatchObject({
      ok: true,
    });
    const [row] = await reminderRows(h, competition.id);
    await expect(
      h.as(WORKER).runReminder({ reminderJobId: row!.id })
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses a competition manager and a member", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);
    await scheduleFor(h, competition.id);
    const [row] = await reminderRows(h, competition.id);
    const manager = await signedInWith(h, {
      role: "competition_manager",
      scope: { type: "global" },
    });
    const member = await signedInWith(h);

    for (const actor of [manager, member]) {
      await expect(
        h.as(actor).scheduleReminders({
          subjectType: "competition",
          subjectId: competition.id,
        })
      ).rejects.toThrow(DomainError);
      await expect(h.as(actor).syncReminders()).rejects.toThrow(DomainError);
      await expect(
        h.as(actor).runReminder({ reminderJobId: row!.id })
      ).rejects.toThrow(DomainError);
    }
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();
    const competition = await reminderCompetition(h);

    await expect(
      h.as(h.visitor()).scheduleReminders({
        subjectType: "competition",
        subjectId: competition.id,
      })
    ).rejects.toThrow(DomainError);
  });
});
