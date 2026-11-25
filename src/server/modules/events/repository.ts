import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import {
  event,
  eventRegistration,
  type EventRow,
  type EventRegistrationRow,
} from "../../db/schema";
import { safeHref } from "../../rich-text/href";
import { stripMarkup } from "../../rich-text/strip-markup";
import { registrationWindow } from "./domain/registration-window";
import { waitlistPosition } from "./domain/waitlist";
import { PLACE_HOLDING_STATUSES } from "./domain/registration-status";

export async function lockEvent(db: AppDb, eventId: string) {
  const [row] = await db
    .select()
    .from(event)
    .where(eq(event.id, eventId))
    .for("update");
  return row ?? null;
}

export function eventRows(db: AppDb, eventId: string) {
  return db
    .select()
    .from(eventRegistration)
    .where(eq(eventRegistration.eventId, eventId))
    .orderBy(asc(eventRegistration.registeredAt), asc(eventRegistration.id));
}

/** Public capacity is an aggregate, never a public roster read. */
export async function publicPlaceCount(db: AppDb, eventId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(eventRegistration)
    .where(
      and(
        eq(eventRegistration.eventId, eventId),
        inArray(eventRegistration.status, [...PLACE_HOLDING_STATUSES])
      )
    );
  return row?.n ?? 0;
}

export const placesTaken = (rows: readonly EventRegistrationRow[]) =>
  rows.filter((r) =>
    PLACE_HOLDING_STATUSES.some((status) => status === r.status)
  ).length;
export const waiting = (rows: readonly EventRegistrationRow[]) =>
  rows.flatMap((r) =>
    r.status === "waitlisted" && r.waitlistedAt
      ? [
          {
            id: r.id,
            waitlistedAt: r.waitlistedAt,
            ordinal: r.waitlistOrder ?? undefined,
          },
        ]
      : []
  );
export const position = (rows: readonly EventRegistrationRow[], id: string) =>
  waitlistPosition(waiting(rows), id);

export function publicView(row: EventRow, now: Date, taken: number) {
  // Explicit allowlist: no creator, attendee ID or administrative timestamps.
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    title: stripMarkup(row.title),
    summary: stripMarkup(row.summary),
    description: stripMarkup(row.description),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    venueName: row.venueName === null ? null : stripMarkup(row.venueName),
    address: row.address === null ? null : stripMarkup(row.address),
    city: row.city === null ? null : stripMarkup(row.city),
    pinCode: row.pinCode,
    onlineUrl: row.onlineUrl?.startsWith("https://")
      ? safeHref(row.onlineUrl)
      : null,
    capacity: row.capacity,
    placesLeft:
      row.capacity === null ? null : Math.max(0, row.capacity - taken),
    audience: row.audience,
    waitlistEnabled: row.waitlistEnabled,
    registrationWindow: registrationWindow(row, now),
  };
}
