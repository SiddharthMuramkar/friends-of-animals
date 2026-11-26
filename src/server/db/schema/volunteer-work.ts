// Shared work items and individual service logs. A decision is terminal;
// minute counts are integer facts rather than estimates or floating hours.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { VOLUNTEER_TASK_STATUSES } from "../../modules/volunteers/domain/task-status";
import { VOLUNTEER_HOURS_STATUSES } from "../../modules/volunteers/domain/hours";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";
const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const volunteerTaskStatus = pgEnum(
  "volunteer_task_status",
  VOLUNTEER_TASK_STATUSES
);
export const volunteerHoursStatus = pgEnum(
  "volunteer_hours_status",
  VOLUNTEER_HOURS_STATUSES
);
export const volunteerTask = pgTable(
  "volunteer_task",
  {
    id: uuid().primaryKey(),
    titleCiphertext: encryptedText("title_ciphertext").notNull(),
    descriptionCiphertext: encryptedText("description_ciphertext").notNull(),
    status: volunteerTaskStatus().notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [
    index("volunteer_task_status_idx").on(t.status),
    index("volunteer_task_creator_idx").on(t.createdByUserId),
  ]
);
export const volunteerTaskAssignment = pgTable(
  "volunteer_task_assignment",
  {
    id: uuid().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => volunteerTask.id, { onDelete: "cascade" }),
    volunteerUserId: uuid("volunteer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assignedByUserId: uuid("assigned_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    assignedAt: instant("assigned_at").notNull(),
    unassignedAt: instant("unassigned_at"),
  },
  (t) => [
    uniqueIndex("volunteer_task_one_active_assignment")
      .on(t.taskId, t.volunteerUserId)
      .where(sql`${t.unassignedAt} IS NULL`),
    index("volunteer_task_assignment_volunteer_idx").on(t.volunteerUserId),
    index("volunteer_task_assignment_task_idx").on(t.taskId),
    index("volunteer_task_assignment_actor_idx").on(t.assignedByUserId),
    check(
      "volunteer_assignment_dates",
      sql`${t.unassignedAt} IS NULL OR ${t.unassignedAt} >= ${t.assignedAt}`
    ),
  ]
);
export const volunteerHoursEntry = pgTable(
  "volunteer_hours_entry",
  {
    id: uuid().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => volunteerTaskAssignment.id, { onDelete: "cascade" }),
    workedOn: date("worked_on").notNull(),
    minutes: integer().notNull(),
    noteCiphertext: encryptedText("note_ciphertext"),
    status: volunteerHoursStatus().notNull(),
    decidedByUserId: uuid("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: instant("decided_at"),
    rejectReasonCiphertext: encryptedText("reject_reason_ciphertext"),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    index("volunteer_hours_assignment_idx").on(t.assignmentId),
    index("volunteer_hours_status_idx").on(t.status, t.createdAt),
    index("volunteer_hours_decider_idx").on(t.decidedByUserId),
    check(
      "volunteer_hours_minutes_range",
      sql`${t.minutes} BETWEEN 1 AND 1440`
    ),
    check(
      "volunteer_hours_decision_record",
      sql`(${t.status} = 'submitted') = (${t.decidedAt} IS NULL)`
    ),
    check(
      "volunteer_hours_reason_record",
      sql`(${t.status} = 'rejected') = (${t.rejectReasonCiphertext} IS NOT NULL)`
    ),
  ]
);
