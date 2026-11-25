import { eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { eventRegistration, event, type EventRow } from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { recordEngagement } from "../community";
import { subjectOf } from "../community/subjects";
import { canMoveRegistration } from "./domain/registration-status";
import {
  lockRegistrationEvent,
  listEventRegistrations,
  type RegistrationId,
} from "./registrations";
import type { EventId } from "./admin";

export function checkInOpen(row: EventRow, now: Date) {
  return (
    row.status === "published" &&
    +now >= +row.startsAt - 2 * 3600_000 &&
    +now < +row.endsAt
  );
}
export async function checkInAttendee(
  ctx: UseCaseContext,
  input: RegistrationId
) {
  const { role } = await authorize(ctx, "event.check_in");
  const parsed = z.object({ registrationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (db) => {
    const found = await lockRegistrationEvent(db, parsed.data.registrationId);
    if (!found) return { ok: false, error: "not_found" } as const;
    const { row, registration: r } = found;
    const now = ctx.clock.now();
    if (r.status === "checked_in")
      return { ok: false, error: "already_checked_in" } as const;
    if (!checkInOpen(row, now))
      return { ok: false, error: "check_in_closed" } as const;
    if (!canMoveRegistration(r.status, "checked_in"))
      return { ok: false, error: "not_registered" } as const;
    await db
      .update(eventRegistration)
      .set({
        status: "checked_in",
        checkedInAt: now,
        checkedInByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        updatedAt: now,
      })
      .where(eq(eventRegistration.id, r.id));
    await recordEngagement(db, ctx, {
      type: "entry",
      subject: subjectOf(r),
      kind: "event.attended",
      occurredAt: now,
      sourceKey: `event_registration:${r.id}:attended`,
      refType: "event",
      refId: row.id,
    });
    await recordAudit(db, ctx, {
      action: "event_registration.checked_in",
      entity: { type: "event_registration", id: r.id },
      before: { status: "registered" },
      after: { status: "checked_in" },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
export async function getCheckInSheet(
  ctx: UseCaseContext,
  input: EventId & { query?: string }
) {
  await authorize(ctx, "event.check_in");
  const parsed = z
    .object({ eventId: z.uuid(), query: z.string().trim().max(120).optional() })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [row] = await ctx.db
    .select()
    .from(event)
    .where(eq(event.id, parsed.data.eventId));
  if (!row) return { ok: false, error: "not_found" } as const;
  const result = await listEventRegistrations(ctx, parsed.data);
  if (!result.ok) return result;
  const q = parsed.data.query?.toLocaleLowerCase() ?? "";
  const items = result.items.filter(
    (r) => r.status === "registered" || r.status === "checked_in"
  );
  return {
    ok: true,
    open: checkInOpen(row, ctx.clock.now()),
    registered: items.filter((r) => r.status === "registered").length,
    checkedIn: items.filter((r) => r.status === "checked_in").length,
    items: items.filter((r) => r.name.toLocaleLowerCase().includes(q)),
  } as const;
}
