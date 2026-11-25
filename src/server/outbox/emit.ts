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
  await emitBatch(tx, clock, [event], options);
}

/** Saves a bounded batch of events and their subscribers in one write. */
export async function emitBatch(
  tx: AppDb,
  clock: Clock,
  events: readonly DomainEvent[],
  options: { availableAt?: Date } = {}
): Promise<void> {
  const now = clock.now();
  const deliveries = events.flatMap((event) => {
    const payload = EVENT_PAYLOADS[event.type].parse(event.payload);
    const eventId = uuidv7(now);
    // Auction cancellation is needed only for auction-purpose withdrawals;
    // unrelated consent changes retain their existing notification delivery.
    const handlers: readonly string[] = SUBSCRIBERS[event.type].filter(
      (handler) =>
        event.type !== "consent.withdrawn" ||
        ((handler !== "auctions.withdraw_consent" ||
          event.payload.purpose === "auction") &&
          (handler !== "gallery.withdraw_consent" ||
            ["public_display", "display_school", "display_city"].includes(
              event.payload.purpose
            )))
    );
    return handlers.map((handler) => ({
      id: uuidv7(now),
      eventId,
      eventType: event.type,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      handler,
      payload,
      occurredAt: now,
      availableAt: options.availableAt ?? now,
    }));
  });
  if (deliveries.length > 0) await tx.insert(outbox).values(deliveries);
}
