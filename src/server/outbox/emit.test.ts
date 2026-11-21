import { describe, expect, it } from "vitest";

import { outbox } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { createHarness, type Harness } from "@/test/harness";

import { emit } from "./emit";
import type { EventOf } from "./events";

function signedUp(h: Harness): EventOf<"identity.user_signed_up"> {
  const userId = uuidv7(h.clock.now());
  return {
    type: "identity.user_signed_up",
    aggregate: { type: "user", id: userId },
    payload: { userId },
  };
}

describe("emit", () => {
  it("writes one pending delivery for each handler of the event", async () => {
    const h = await createHarness();
    const event = signedUp(h);

    await h.db.transaction((tx) => emit(tx, h.clock, event));

    const rows = await h.db.select().from(outbox);
    expect(rows).toEqual([
      expect.objectContaining({
        eventType: "identity.user_signed_up",
        aggregateType: "user",
        aggregateId: event.aggregate.id,
        handler: "notifications.send_welcome_email",
        payload: { userId: event.payload.userId },
        status: "pending",
        attempts: 0,
        occurredAt: h.clock.now(),
        availableAt: h.clock.now(),
        lockedUntil: null,
        lastError: null,
      }),
    ]);
    expect(rows[0]?.id).not.toBe(rows[0]?.eventId);
  });

  it("keeps only the payload's ids", async () => {
    const h = await createHarness();
    const event = signedUp(h);
    const withAddress = {
      ...event,
      payload: { ...event.payload, email: "asha@example.test" },
    };

    await h.db.transaction((tx) => emit(tx, h.clock, withAddress));

    const [row] = await h.db.select().from(outbox);
    expect(row?.payload).toEqual({ userId: event.payload.userId });
  });

  it("refuses a payload that doesn't match its event", async () => {
    const h = await createHarness();
    const event = signedUp(h);

    await expect(
      h.db.transaction((tx) =>
        emit(tx, h.clock, { ...event, payload: { userId: "asha" } })
      )
    ).rejects.toThrow();
    expect(await h.db.select().from(outbox)).toEqual([]);
  });

  it("holds a delivery until the time it is due", async () => {
    const h = await createHarness();
    const later = new Date(h.clock.now().getTime() + 60 * 60 * 1000);

    await h.db.transaction((tx) =>
      emit(tx, h.clock, signedUp(h), { availableAt: later })
    );

    const [row] = await h.db.select().from(outbox);
    expect(row).toMatchObject({
      occurredAt: h.clock.now(),
      availableAt: later,
    });
  });

  it("leaves no delivery when the transaction rolls back", async () => {
    const h = await createHarness();
    let insideTransaction: unknown[] = [];

    await expect(
      h.db.transaction(async (tx) => {
        await emit(tx, h.clock, signedUp(h));
        insideTransaction = await tx.select().from(outbox);
        throw new Error("The change failed after its event was emitted");
      })
    ).rejects.toThrow("after its event was emitted");

    expect(insideTransaction).toHaveLength(1);
    expect(await h.db.select().from(outbox)).toEqual([]);
  });
});
