// Planning reminders (#84).
//
//   scheduleReminders({ subjectType, subjectId })  → the worker (or the seed)
//   syncReminders()                                → the worker, hourly
//
// The worker schedules a competition's reminders when it is published, its
// key dates change, or it is cancelled (the `reminders.schedule` handler),
// and the hourly sync goes over every subject with a deadline ahead or a
// reminder still scheduled, so a change of the offset settings, or an
// event that went missing, is caught within the hour.
//
// For each reminder about the subject, one transaction compares its
// reminder_job rows with the plan for the deadline and offsets now
// (domain/schedule.ts): matching rows stay, the rest are superseded (or
// cancelled with their subject), and each new row is saved with its
// delayed `reminder.due` event, so a row exists if and only if its job
// does. An advisory lock per reminder and subject queues two runs for
// the same one; the partial unique index backs it up.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import { reminderJob } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { reminderOffsets } from "./domain/offsets";
import { diffReminderSchedule } from "./domain/schedule";
import {
  REMINDERS,
  remindersAbout,
  type ReminderDefinition,
  type ReminderSubjectType,
} from "./registry";

/** What scheduling uses: the database, the clock, settings and the actor. */
export type ReminderScheduleContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "settings"
>;

/** The hours before the deadline `definition`'s settings ask for now. */
export async function offsetsFor(
  settings: UseCaseContext["settings"],
  definition: ReminderDefinition
): Promise<number[]> {
  return reminderOffsets(
    await Promise.all(definition.offsetSettings.map((key) => settings.get(key)))
  );
}

/** Serializes planning one reminder for one subject. */
async function lockPlanning(
  tx: AppDb,
  reminderName: string,
  subjectId: string
): Promise<void> {
  const scope = `reminders:${reminderName}:${subjectId}`;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`
  );
}

type Counts = {
  scheduled: number;
  kept: number;
  superseded: number;
  cancelled: number;
};

const NONE: Counts = { scheduled: 0, kept: 0, superseded: 0, cancelled: 0 };

const add = (a: Counts, b: Counts): Counts => ({
  scheduled: a.scheduled + b.scheduled,
  kept: a.kept + b.kept,
  superseded: a.superseded + b.superseded,
  cancelled: a.cancelled + b.cancelled,
});

/** Brings one reminder's rows for one subject in step with its plan. */
async function planReminder(
  ctx: ReminderScheduleContext,
  definition: ReminderDefinition,
  subjectId: string
): Promise<Counts> {
  // Settings are read on their own connection, before the transaction.
  const offsetsHours = await offsetsFor(ctx.settings, definition);
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    await lockPlanning(tx, definition.name, subjectId);
    const deadline = await definition.deadlineOf(tx, subjectId);
    const existing = await tx
      .select()
      .from(reminderJob)
      .where(
        and(
          eq(reminderJob.reminderName, definition.name),
          eq(reminderJob.subjectId, subjectId),
          inArray(reminderJob.status, ["scheduled", "fired"])
        )
      )
      .for("update");
    const diff = diffReminderSchedule({
      existing,
      deadline,
      offsetsHours,
      now,
    });

    for (const [ids, status] of [
      [diff.supersede, "superseded"],
      [diff.cancel, "cancelled"],
    ] as const) {
      if (ids.length === 0) continue;
      await tx
        .update(reminderJob)
        .set({ status, updatedAt: now })
        .where(
          and(inArray(reminderJob.id, ids), eq(reminderJob.status, "scheduled"))
        );
    }
    for (const planned of diff.create) {
      const id = uuidv7(now);
      await tx.insert(reminderJob).values({
        id,
        reminderName: definition.name,
        subjectId,
        ...planned,
        status: "scheduled",
        createdAt: now,
        updatedAt: now,
      });
      await emit(
        tx,
        ctx.clock,
        {
          type: "reminder.due",
          aggregate: { type: "reminder_job", id },
          payload: { reminderJobId: id },
        },
        { availableAt: planned.fireAt }
      );
    }
    return {
      scheduled: diff.create.length,
      kept: diff.keep.length,
      superseded: diff.supersede.length,
      cancelled: diff.cancel.length,
    };
  });
}

const subjectSchema = z.object({
  subjectType: z.enum(["competition", "physical_artwork", "event"]),
  subjectId: z.uuid(),
});

export type ScheduleRemindersInput = {
  subjectType: ReminderSubjectType;
  subjectId: string;
};

export type ScheduleRemindersResult = ({ ok: true } & Counts) | InvalidInput;

/**
 * Brings every reminder about one subject in step with its deadline and
 * the offset settings now. Safe to run again: with nothing changed, it
 * keeps what is planned and plans nothing more.
 */
export async function scheduleReminders(
  ctx: ReminderScheduleContext,
  input: ScheduleRemindersInput
): Promise<ScheduleRemindersResult> {
  await authorize(ctx, "reminder.schedule");
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  let counts = NONE;
  for (const definition of remindersAbout(parsed.data.subjectType)) {
    counts = add(
      counts,
      await planReminder(ctx, definition, parsed.data.subjectId)
    );
  }
  return { ok: true, ...counts };
}

export type SyncRemindersResult = {
  ok: true;
  /** How many subjects' reminders were brought in step. */
  subjects: number;
};

/**
 * The hourly sync: every reminder for every subject with a deadline ahead
 * or a reminder still scheduled. A subject that fails is retried by the
 * next run; the others still sync.
 */
export async function syncReminders(
  ctx: ReminderScheduleContext
): Promise<SyncRemindersResult> {
  await authorize(ctx, "reminder.schedule");
  const now = ctx.clock.now();
  const subjects = new Set<string>();
  let failure: unknown = null;
  for (const definition of REMINDERS) {
    const pending = await ctx.db
      .selectDistinct({ subjectId: reminderJob.subjectId })
      .from(reminderJob)
      .where(
        and(
          eq(reminderJob.reminderName, definition.name),
          eq(reminderJob.status, "scheduled")
        )
      );
    const ids = new Set([
      ...(await definition.subjectsToSync(ctx.db, now)),
      ...pending.map((row) => row.subjectId),
    ]);
    for (const subjectId of [...ids].toSorted()) {
      try {
        await planReminder(ctx, definition, subjectId);
        subjects.add(subjectId);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure !== null) throw failure;
  return { ok: true, subjects: subjects.size };
}
