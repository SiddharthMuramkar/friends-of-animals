// What a reminder's message may say (#84): the deadline, written in IST,
// and what its reminder's definition gives about the subject (a
// competition's name). Every template on `reminder.due` may use these;
// ../notifications/catalogue.test.ts checks the migrated templates against
// them. Nothing about the person owing it: a coordinator's reminder names
// no student, a guardian's no child.
//
// Loads under plain Node (the worker): relative imports only.

import { eq } from "drizzle-orm";
import { createFormatter } from "next-intl";

import { formats, LOCALE, TIME_ZONE } from "../../../i18n/formats";
import type { AppDb } from "../../db/app-db";
import { reminderJob } from "../../db/schema";
import { REMINDERS, reminderNamed, type ReminderDefinition } from "./registry";

/** The variables a reminder's template may use, beyond the recipient's. */
export const REMINDER_VARIABLES = [
  ...new Set(["reminder.deadline", ...REMINDERS.flatMap((r) => r.variables)]),
];

const format = createFormatter({
  locale: LOCALE,
  formats,
  timeZone: TIME_ZONE,
});

/** The deadline as messages write it: "13 February 2027 at 11:59 pm IST". */
export function deadlineWords(at: Date): string {
  return format.dateTime(at, "longDateTime");
}

/** The values one reminder's template fills in. */
export async function valuesForReminder(
  db: AppDb,
  definition: ReminderDefinition,
  reminder: { subjectId: string; deadlineAt: Date }
): Promise<Record<string, string>> {
  return {
    ...(await definition.values(db, reminder.subjectId)),
    "reminder.deadline": deadlineWords(reminder.deadlineAt),
  };
}

/** The values for the reminder_job row an outbox payload names. */
export async function reminderValues(
  db: AppDb,
  reminderJobId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select()
    .from(reminderJob)
    .where(eq(reminderJob.id, reminderJobId));
  const definition = row && reminderNamed(row.reminderName);
  return row && definition ? valuesForReminder(db, definition, row) : {};
}
