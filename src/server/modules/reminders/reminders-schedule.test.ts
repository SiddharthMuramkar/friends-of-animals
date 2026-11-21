import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox, reminderJob } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { scheduleReminders } from "./schedule-reminders";
import {
  COMPETITION_ID,
  standInEntrySubmissionDue,
  systemContext,
} from "./testing";

const competition = {
  subjectType: "competition",
  subjectId: COMPETITION_ID,
} as const;

describe("scheduleReminders", () => {
  it("schedules one reminder per offset before the deadline, each due at its fire time", async () => {
    const h = await createHarness({ now: "2027-01-15T04:30:00.000Z" });
    const reminder = standInEntrySubmissionDue({
      deadline: new Date("2027-02-13T18:29:00.000Z"),
      offsets: [72, 24],
    });

    const result = await scheduleReminders(
      systemContext(h.deps),
      competition,
      reminder.registry
    );

    expect(result).toEqual({ ok: true, scheduled: 2, kept: 0, superseded: 0 });
    const rows = await h.db
      .select()
      .from(reminderJob)
      .orderBy(asc(reminderJob.fireAt));
    expect(rows).toEqual([
      expect.objectContaining({
        reminderName: "entry_submission_due",
        subjectId: COMPETITION_ID,
        offsetHours: 72,
        deadlineAt: new Date("2027-02-13T18:29:00.000Z"),
        fireAt: new Date("2027-02-10T18:29:00.000Z"),
        status: "scheduled",
        firedAt: null,
      }),
      expect.objectContaining({
        reminderName: "entry_submission_due",
        subjectId: COMPETITION_ID,
        offsetHours: 24,
        deadlineAt: new Date("2027-02-13T18:29:00.000Z"),
        fireAt: new Date("2027-02-12T18:29:00.000Z"),
        status: "scheduled",
        firedAt: null,
      }),
    ]);
    const jobs = await h.db
      .select()
      .from(outbox)
      .orderBy(asc(outbox.availableAt));
    expect(jobs).toEqual([
      expect.objectContaining({
        eventType: "reminder.scheduled",
        aggregateType: "reminder_job",
        aggregateId: rows[0]?.id,
        handler: "reminders.run",
        payload: { reminderJobId: rows[0]?.id },
        availableAt: new Date("2027-02-10T18:29:00.000Z"),
        status: "pending",
      }),
      expect.objectContaining({
        eventType: "reminder.scheduled",
        aggregateType: "reminder_job",
        aggregateId: rows[1]?.id,
        handler: "reminders.run",
        payload: { reminderJobId: rows[1]?.id },
        availableAt: new Date("2027-02-12T18:29:00.000Z"),
        status: "pending",
      }),
    ]);
  });
});
