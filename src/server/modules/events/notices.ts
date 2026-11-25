// Resolve current recipients at dispatch, not when a job is queued. A child's
// notice requires the communications consent of a still-verified guardian.
// There is never a fallback to the child's login or a former guardian.
import { and, eq, inArray, lte } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import {
  event,
  eventRegistration,
  participantProfile,
  reminderJob,
  type EventRegistrationRow,
} from "../../db/schema";
import type { Delivery } from "../../outbox";
import { activeGuardians, latestConsents } from "../campaigns/load-audience";
import { createFormatter } from "next-intl";
import { formats, LOCALE, TIME_ZONE } from "../../../i18n/formats";
const formatter = createFormatter({
  locale: LOCALE,
  formats,
  timeZone: TIME_ZONE,
});
import { stripMarkup } from "../../rich-text/strip-markup";

export const EVENT_NOTICE_VARIABLES = [
  "event.title",
  "event.start",
  "event.place",
  "event.registrationStatus",
  "event.changes",
];
type NoticeKind =
  | "event.registration_created"
  | "event.registration_cancelled"
  | "event.waitlist_promoted"
  | "event.changed"
  | "event.cancelled";
type Notice = Delivery<NoticeKind>;

function isNotice(delivery: Delivery): delivery is Notice {
  return (
    delivery.eventType === "event.registration_created" ||
    delivery.eventType === "event.registration_cancelled" ||
    delivery.eventType === "event.waitlist_promoted" ||
    delivery.eventType === "event.changed" ||
    delivery.eventType === "event.cancelled"
  );
}
async function recipientIds(db: AppDb, rows: EventRegistrationRow[]) {
  const users = new Set<string>();
  const children = new Set<string>();
  for (const r of rows) {
    if (r.subjectProfileId) {
      children.add(r.subjectProfileId);
      continue;
    }
    if (!r.subjectUserId) continue;
    const [linked] = await db
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(eq(participantProfile.loginUserId, r.subjectUserId));
    if (linked) children.add(linked.id);
    else users.add(r.subjectUserId);
  }
  const childIds = [...children];
  const [consents, guardians] = await Promise.all([
    latestConsents(db, "participant_profile", "communications", childIds),
    activeGuardians(db, childIds),
  ]);
  for (const profileId of childIds) {
    const consent = consents.get(profileId);
    if (
      consent?.status === "given" &&
      consent.giverUserId &&
      guardians.get(profileId)?.includes(consent.giverUserId)
    )
      users.add(consent.giverUserId);
  }
  return [...users];
}
export async function eventNoticeRecipients(db: AppDb, delivery: Delivery) {
  if (!isNotice(delivery)) return [];
  if (
    delivery.eventType === "event.changed" ||
    delivery.eventType === "event.cancelled"
  ) {
    const expected =
      delivery.eventType === "event.changed" ? "published" : "cancelled";
    const rows = await db
      .select({ registration: eventRegistration })
      .from(eventRegistration)
      .innerJoin(event, eq(event.id, eventRegistration.eventId))
      .where(
        and(
          eq(event.id, delivery.payload.eventId),
          eq(event.status, expected),
          inArray(eventRegistration.status, ["registered", "waitlisted"]),
          lte(eventRegistration.registeredAt, delivery.occurredAt)
        )
      );
    return recipientIds(
      db,
      rows.map((r) => r.registration)
    );
  }
  const [found] = await db
    .select({ registration: eventRegistration, status: event.status })
    .from(eventRegistration)
    .innerJoin(event, eq(event.id, eventRegistration.eventId))
    .where(eq(eventRegistration.id, delivery.payload.registrationId));
  if (!found || found.status !== "published") return [];
  const expected =
    delivery.eventType === "event.registration_created"
      ? delivery.payload.status
      : delivery.eventType === "event.waitlist_promoted"
        ? "registered"
        : "cancelled";
  return found.registration.status === expected
    ? recipientIds(db, [found.registration])
    : [];
}
export async function eventReminderRecipients(db: AppDb, delivery: Delivery) {
  if (delivery.eventType !== "reminder.due") return [];
  const [job] = await db
    .select()
    .from(reminderJob)
    .where(eq(reminderJob.id, delivery.payload.reminderJobId));
  if (!job || job.reminderName !== "event_starts" || job.status !== "fired")
    return [];
  const rows = await db
    .select({ registration: eventRegistration })
    .from(eventRegistration)
    .innerJoin(event, eq(event.id, eventRegistration.eventId))
    .where(
      and(
        eq(event.id, job.subjectId),
        eq(event.status, "published"),
        eq(event.startsAt, job.deadlineAt),
        eq(eventRegistration.status, "registered")
      )
    );
  return recipientIds(
    db,
    rows.map((r) => r.registration)
  );
}
export async function eventValues(
  db: AppDb,
  eventId: string
): Promise<Record<string, string>> {
  const [row] = await db.select().from(event).where(eq(event.id, eventId));
  if (!row) return {};
  return {
    "event.title": stripMarkup(row.title),
    "event.start": formatter.dateTime(row.startsAt, "longDateTime"),
    "event.place":
      [row.venueName, row.city].filter(Boolean).join(", ") || "Online",
  };
}
export async function eventNoticeValues(db: AppDb, delivery: Notice) {
  if (
    delivery.eventType === "event.changed" ||
    delivery.eventType === "event.cancelled"
  ) {
    return {
      ...(await eventValues(db, delivery.payload.eventId)),
      "event.changes":
        delivery.eventType === "event.changed"
          ? delivery.payload.changes.join(" and ")
          : "",
    };
  }
  const [row] = await db
    .select({ eventId: eventRegistration.eventId })
    .from(eventRegistration)
    .where(eq(eventRegistration.id, delivery.payload.registrationId));
  if (!row) return {};
  return {
    ...(await eventValues(db, row.eventId)),
    "event.registrationStatus":
      delivery.eventType === "event.registration_created"
        ? delivery.payload.status === "registered"
          ? "Registered"
          : "Waitlisted"
        : "Registered",
  };
}
