import { describe, expect, it } from "vitest";

import { outbox } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { createHarness, type Harness } from "@/test/harness";

import { emit } from "./emit";
import {
  DEFAULT_DRAIN_LIMIT,
  DrainNeverIdleError,
  drainOutbox,
  drainUntilIdle,
} from "./relay";

const NOTHING = { dispatched: 0, retried: 0, failed: 0, skipped: 0 };

/** Emits identity.user_signed_up for `userId`, as sign-up does. */
async function signedUp(
  h: Harness,
  userId: string,
  options: { availableAt?: Date } = {}
) {
  await h.db.transaction((tx) =>
    emit(
      tx,
      h.clock,
      {
        type: "identity.user_signed_up",
        aggregate: { type: "user", id: userId },
        payload: { userId },
      },
      options
    )
  );
}

describe("drainOutbox", () => {
  it("runs a due delivery's handler and marks it dispatched", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ name: "Asha Rao" });
    await signedUp(h, member.id);

    const report = await drainOutbox(h.deps);

    expect(report).toEqual({ ...NOTHING, dispatched: 1 });
    const welcome = h.email.lastTo(member.email);
    expect(welcome?.subject).toBe("Welcome to Friends of Animals");
    expect(welcome?.text).toContain("Asha Rao");
    const [row] = await h.db.select().from(outbox);
    expect(row).toMatchObject({
      status: "dispatched",
      attempts: 1,
      dispatchedAt: h.clock.now(),
      lockedUntil: null,
      lastError: null,
    });
  });

  it("sends once however often it drains", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await signedUp(h, member.id);

    await drainOutbox(h.deps);
    const again = await drainOutbox(h.deps);

    expect(again).toEqual(NOTHING);
    expect(h.email.sent).toHaveLength(1);
  });

  it("leaves a delivery for a handler this code doesn't know untouched", async () => {
    const h = await createHarness();
    const now = h.clock.now();
    const userId = uuidv7(now);
    // Written by a newer deployment that shares this preview's worker.
    const [before] = await h.db
      .insert(outbox)
      .values({
        id: uuidv7(now),
        eventId: uuidv7(now),
        eventType: "identity.user_signed_up",
        aggregateType: "user",
        aggregateId: userId,
        handler: "notifications.from_a_newer_deployment",
        payload: { userId },
        occurredAt: now,
        availableAt: now,
      })
      .returning();

    const report = await drainOutbox(h.deps);

    expect(report).toEqual({ ...NOTHING, skipped: 1 });
    expect(await h.db.select().from(outbox)).toEqual([before]);
  });

  it("leaves a delivery until it is due", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const inAnHour = new Date(h.clock.now().getTime() + 60 * 60 * 1000);
    await signedUp(h, member.id, { availableAt: inAnHour });

    expect(await drainOutbox(h.deps)).toEqual(NOTHING);
    expect(h.email.sent).toEqual([]);

    h.clock.advance({ hours: 1 });
    expect(await drainOutbox(h.deps)).toEqual({ ...NOTHING, dispatched: 1 });
    expect(h.email.lastTo(member.email)).toBeDefined();
  });

  it("claims at most `limit` deliveries a pass, oldest first", async () => {
    const h = await createHarness();
    const members = [];
    for (const name of ["First", "Second", "Third"]) {
      const member = await h.seed.member({ name });
      await signedUp(h, member.id);
      members.push(member);
      h.clock.advance({ seconds: 1 });
    }

    expect(await drainOutbox(h.deps, { limit: 2 })).toEqual({
      ...NOTHING,
      dispatched: 2,
    });
    expect(h.email.sent.map((message) => message.to)).toEqual(
      members.slice(0, 2).map((member) => member.email)
    );
    expect(await drainOutbox(h.deps, { limit: 2 })).toEqual({
      ...NOTHING,
      dispatched: 1,
    });
  });

  it("sends no welcome email to an account that no longer exists", async () => {
    const h = await createHarness();
    await signedUp(h, uuidv7(h.clock.now()));

    expect(await drainOutbox(h.deps)).toEqual({ ...NOTHING, dispatched: 1 });
    expect(h.email.sent).toEqual([]);
  });

  it("sends nothing for an event whose transaction rolled back", async () => {
    const h = await createHarness();
    const member = await h.seed.member();

    await expect(
      h.db.transaction(async (tx) => {
        await emit(tx, h.clock, {
          type: "identity.user_signed_up",
          aggregate: { type: "user", id: member.id },
          payload: { userId: member.id },
        });
        throw new Error("The change failed after its event was emitted");
      })
    ).rejects.toThrow();

    expect(await h.drain()).toEqual(NOTHING);
    expect(h.email.sent).toEqual([]);
  });
});

describe("drainUntilIdle", () => {
  it("gives up, saying why, when passes keep finding due deliveries", async () => {
    const h = await createHarness();
    for (let i = 0; i <= DEFAULT_DRAIN_LIMIT; i += 1) {
      await signedUp(h, uuidv7(h.clock.now()));
    }

    await expect(drainUntilIdle(h.deps, { maxPasses: 1 })).rejects.toThrow(
      DrainNeverIdleError
    );
    // The pass it ran still counted: only the rest wait for the next drain.
    expect(await drainUntilIdle(h.deps)).toMatchObject({ dispatched: 1 });
  });
});
