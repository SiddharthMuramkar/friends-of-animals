// Reminders (#84): one row per planned reminder, the truth about what is
// scheduled. Each row names its reminder in the registry
// (src/server/modules/reminders/registry.ts), the subject whose deadline
// it is about, the deadline and offset it was planned for, and when it
// fires. A delayed outbox event (`reminder.due`) runs it at `fire_at`; the
// run checks the row and the deadline again, so a row superseded or
// cancelled since does nothing. Who was reminded is in `message_delivery`
// (keyed by this row's id), not here. No personal data.
//
// Loads under plain Node (drizzle-kit, the worker): relative imports only,
// no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { MAX_REMINDER_OFFSET_HOURS } from "../../modules/reminders/domain/offsets";
import { REMINDER_STATUSES } from "../../modules/reminders/domain/schedule";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Every value from the first migration (rule F2). */
export const reminderJobStatusEnum = pgEnum(
  "reminder_job_status",
  REMINDER_STATUSES
);

export const reminderJob = pgTable(
  "reminder_job",
  {
    /** UUIDv7 from the clock; also the key its messages are sent under. */
    id: uuid().primaryKey(),
    /** The reminder's name in the registry, such as entry_submission_due. */
    reminderName: text("reminder_name").notNull(),
    /**
     * Whose deadline: a competition for every reminder so far. No foreign
     * key, so later subjects (#125's events) can share the table.
     */
    subjectId: uuid("subject_id").notNull(),
    /** How many hours before the deadline it fires. */
    offsetHours: integer("offset_hours").notNull(),
    /** The deadline it was planned for. */
    deadlineAt: timestamptz("deadline_at").notNull(),
    fireAt: timestamptz("fire_at").notNull(),
    status: reminderJobStatusEnum().notNull().default("scheduled"),
    firedAt: timestamptz("fired_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check(
      "reminder_job_name_format",
      sql`${table.reminderName} ~ '^[a-z][a-z0-9_]*$'`
    ),
    check(
      "reminder_job_offset_hours",
      sql`${table.offsetHours} BETWEEN 1 AND ${sql.raw(String(MAX_REMINDER_OFFSET_HOURS))}`
    ),
    check(
      "reminder_job_fire_at",
      sql`${table.fireAt} = ${table.deadlineAt} - make_interval(hours => ${table.offsetHours})`
    ),
    check(
      "reminder_job_fired_stamped",
      sql`(${table.status} = 'fired') = (${table.firedAt} IS NOT NULL)`
    ),
    // One live plan per reminder, subject, deadline and offset. Superseded
    // and cancelled rows stay as history, so a deadline moved away and back
    // can be planned again.
    uniqueIndex("reminder_job_planned_once")
      .on(
        table.reminderName,
        table.subjectId,
        table.offsetHours,
        table.deadlineAt
      )
      .where(sql`${table.status} IN ('scheduled', 'fired')`),
    index("reminder_job_subject_idx").on(table.reminderName, table.subjectId),
  ]
);

export type ReminderJobRow = typeof reminderJob.$inferSelect;
