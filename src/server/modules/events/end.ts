import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { event, eventRegistration, type EventRow } from "../../db/schema";
import { invalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import { lockEvent } from "./repository";

export async function queueEnd(db: AppDb, ctx: UseCaseContext, row: EventRow) {
  await emit(
    db,
    ctx.clock,
    {
      type: "event.end_due",
      aggregate: { type: "event", id: row.id },
      payload: { eventId: row.id, endsAt: row.endsAt.toISOString() },
    },
    { availableAt: row.endsAt }
  );
}
type EndContext = Pick<UseCaseContext, "clock" | "db" | "actor">;
export async function finishEvent(
  db: AppDb,
  ctx: EndContext,
  row: EventRow,
  role: Awaited<ReturnType<typeof authorize>>["role"]
) {
  const now = ctx.clock.now();
  const noShows = await db
    .update(eventRegistration)
    .set({ status: "no_show", updatedAt: now })
    .where(
      and(
        eq(eventRegistration.eventId, row.id),
        eq(eventRegistration.status, "registered")
      )
    )
    .returning({ id: eventRegistration.id });
  const expired = await db
    .update(eventRegistration)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(eventRegistration.eventId, row.id),
        eq(eventRegistration.status, "waitlisted")
      )
    )
    .returning({ id: eventRegistration.id });
  await db
    .update(event)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(eq(event.id, row.id));
  await recordAudit(db, ctx, {
    action: "event.completed",
    entity: { type: "event", id: row.id },
    before: { status: "published" },
    after: {
      status: "completed",
      noShows: noShows.length,
      unplaced: expired.length,
    },
    actorRole: role,
  });
}
export async function settleEndedEvent(
  ctx: EndContext,
  input: { eventId: string; endsAt: string }
) {
  await authorize(ctx, "event.end");
  const parsed = z
    .object({ eventId: z.uuid(), endsAt: z.iso.datetime() })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (db) => {
    const row = await lockEvent(db, parsed.data.eventId);
    if (
      !row ||
      row.status !== "published" ||
      row.endsAt.toISOString() !== parsed.data.endsAt ||
      +ctx.clock.now() < +row.endsAt
    )
      return { ok: true, settled: false } as const;
    await finishEvent(db, ctx, row, null);
    return { ok: true, settled: true } as const;
  });
}
