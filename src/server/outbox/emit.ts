// emit(tx, clock, event): saves a domain event in the caller's transaction,
// as one pending delivery per handler that listens to it. Pass the
// transaction that saves the change, so the event exists if and only if
// the change does:
//
//   await ctx.db.transaction(async (tx) => {
//     const [row] = await tx.insert(user).values(...).returning();
//     await emit(tx, ctx.clock, {
//       type: "identity.user_signed_up",
//       aggregate: { type: "user", id: row.id },
//       payload: { userId: row.id },
//     });
//   });
//
// The outbox carries work that follows one change; when that work must
// wait, pass `availableAt` and the relay leaves it until then. Reminders,
// status flips and other recurring sweeps are SCHEDULES (./schedules.ts).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { AppDb } from "../db/app-db";
import { outbox } from "../db/schema";
import { uuidv7 } from "../ids";
import type { Clock } from "../ports/clock";
import { EVENT_PAYLOADS, SUBSCRIBERS, type DomainEvent } from "./events";

export async function emit(
  tx: AppDb,
  clock: Clock,
  event: DomainEvent,
  options: { availableAt?: Date } = {}
): Promise<void> {
  const payload = EVENT_PAYLOADS[event.type].parse(event.payload);
  const handlers: readonly string[] = SUBSCRIBERS[event.type];
  if (handlers.length === 0) return;
  const now = clock.now();
  const eventId = uuidv7(now);
  await tx.insert(outbox).values(
    handlers.map((handler) => ({
      id: uuidv7(now),
      eventId,
      eventType: event.type,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      handler,
      payload,
      occurredAt: now,
      availableAt: options.availableAt ?? now,
    }))
  );
}
