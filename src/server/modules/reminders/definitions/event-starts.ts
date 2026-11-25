import { and, eq, gt } from "drizzle-orm";
import { event } from "../../../db/schema";
import { eventValues } from "../../events/notices";
import type { ReminderDefinition } from "../registry";

export const eventStarts: ReminderDefinition = {
  name: "event_starts",
  subjectType: "event",
  offsetSettings: [
    "reminders.eventStartsFirstHours",
    "reminders.eventStartsSecondHours",
  ],
  templateKey: "reminders.event_starts",
  variables: ["event.title", "event.place"],
  async deadlineOf(db, eventId) {
    const [row] = await db
      .select({ status: event.status, at: event.startsAt })
      .from(event)
      .where(eq(event.id, eventId));
    if (row?.status === "published") return { kind: "open", at: row.at };
    if (row?.status === "cancelled") return { kind: "cancelled" };
    return { kind: "none" };
  },
  async subjectsToSync(db, now) {
    return (
      await db
        .select({ id: event.id })
        .from(event)
        .where(and(eq(event.status, "published"), gt(event.startsAt, now)))
    ).map((row) => row.id);
  },
  async owes(db, { subjectId }) {
    // The notification resolver queries the active place holders live,
    // checking the due job's deadline and current guardian consent.
    return { kind: "event_registrants", eventId: subjectId };
  },
  values: eventValues,
};
