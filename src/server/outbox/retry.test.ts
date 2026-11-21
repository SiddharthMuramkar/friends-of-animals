import { describe, expect, it } from "vitest";

import { outbox } from "@/server/db/schema";
import type { EmailSender } from "@/server/ports/email";
import { createHarness, type Harness } from "@/test/harness";

import { emit } from "./emit";
import { drainOutbox, listFailedDeliveries } from "./relay";
import { DEFAULT_RETRY_POLICY } from "./retry-policy";

const NOTHING = { dispatched: 0, retried: 0, failed: 0, skipped: 0 };
const { maxAttempts, leaseMs } = DEFAULT_RETRY_POLICY;

/** A member who just signed up: their welcome delivery is due. */
async function newMember(h: Harness) {
  const member = await h.seed.member({ name: "Asha Rao" });
  await h.db.transaction((tx) =>
    emit(tx, h.clock, {
      type: "identity.user_signed_up",
      aggregate: { type: "user", id: member.id },
      payload: { userId: member.id },
    })
  );
  return member;
}

async function delivery(h: Harness) {
  const [row] = await h.db.select().from(outbox);
  if (!row) throw new Error("No outbox row");
  return row;
}

describe("a delivery whose handler fails", () => {
  it("is tried again after a growing wait, and sent once on the third try", async () => {
    const h = await createHarness();
    const member = await newMember(h);
    h.email.failNext(2);

    expect(await h.drain()).toEqual({ ...NOTHING, retried: 1 });
    const start = h.clock.now().getTime();
    expect(await delivery(h)).toMatchObject({
      status: "pending",
      attempts: 1,
      availableAt: new Date(start + 30_000),
      lockedUntil: null,
      lastError: "Error: FakeEmail: send failed",
    });

    // Not due yet: nothing happens until the clock reaches the backoff.
    expect(await h.drain()).toEqual(NOTHING);
    h.clock.advance({ seconds: 29 });
    expect(await h.drain()).toEqual(NOTHING);

    h.clock.advance({ seconds: 1 });
    expect(await h.drain()).toEqual({ ...NOTHING, retried: 1 });
    expect(await delivery(h)).toMatchObject({
      attempts: 2,
      availableAt: new Date(h.clock.now().getTime() + 60_000),
    });

    h.clock.advance({ minutes: 1 });
    expect(await h.drain()).toEqual({ ...NOTHING, dispatched: 1 });
    expect(h.email.inbox(member.email)).toHaveLength(1);
    expect(await delivery(h)).toMatchObject({
      status: "dispatched",
      attempts: 3,
      lastError: null,
    });

    h.clock.advance({ days: 1 });
    expect(await h.drain()).toEqual(NOTHING);
    expect(h.email.sent).toHaveLength(1);
  });

  it("ends failed after the last try, kept with why and listed for staff", async () => {
    const h = await createHarness();
    const member = await newMember(h);
    h.email.failNext(
      maxAttempts + 1,
      new Error(`Mailbox ${member.email} refused the message`)
    );

    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      expect(await h.drain()).toEqual({ ...NOTHING, retried: 1 });
      h.clock.advance({ hours: 1 });
    }
    expect(await h.drain()).toEqual({ ...NOTHING, failed: 1 });

    const row = await delivery(h);
    expect(row).toMatchObject({
      status: "failed",
      attempts: maxAttempts,
      failedAt: h.clock.now(),
      lockedUntil: null,
      lastError: "Error: Mailbox [email] refused the message",
    });
    expect(await listFailedDeliveries(h.db)).toEqual([
      {
        id: row.id,
        eventId: row.eventId,
        eventType: "identity.user_signed_up",
        aggregateType: "user",
        aggregateId: member.id,
        handler: "notifications.send_welcome_email",
        attempts: maxAttempts,
        occurredAt: row.occurredAt,
        lastError: "Error: Mailbox [email] refused the message",
        failedAt: h.clock.now(),
      },
    ]);

    // Failed is final: no more tries, however long it waits.
    h.clock.advance({ days: 7 });
    expect(await h.drain()).toEqual(NOTHING);
    expect(h.email.sent).toEqual([]);
  });

  it("lists failed deliveries newest first, up to a limit", async () => {
    const h = await createHarness();
    const failForGood = async () => {
      const member = await newMember(h);
      h.email.failNext(maxAttempts);
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await h.drain();
        h.clock.advance({ hours: 1 });
      }
      return member;
    };
    const first = await failForGood();
    const second = await failForGood();

    const failed = await listFailedDeliveries(h.db);
    expect(failed.map((row) => row.aggregateId)).toEqual([second.id, first.id]);
    expect(await listFailedDeliveries(h.db, { limit: 1 })).toEqual([failed[0]]);
  });
});

describe("a delivery whose relay died mid-handler", () => {
  it("is due again once its lease runs out, and the late relay's result is dropped", async () => {
    const h = await createHarness();
    const member = await newMember(h);
    let handlerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      handlerStarted = resolve;
    });
    let release!: () => void;
    const stuck: EmailSender = {
      send: () => {
        handlerStarted();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    const deadRelay = drainOutbox({ ...h.deps, email: stuck });
    await started;

    // Claimed and never settled: not due while the lease holds.
    expect(await h.drain()).toEqual(NOTHING);
    h.clock.advance(leaseMs - 1);
    expect(await h.drain()).toEqual(NOTHING);

    h.clock.advance(1);
    expect(await h.drain()).toEqual({ ...NOTHING, dispatched: 1 });
    expect(h.email.inbox(member.email)).toHaveLength(1);
    const settled = await delivery(h);
    expect(settled).toMatchObject({ status: "dispatched", attempts: 2 });

    // The first relay wakes up: its claim was taken over, so it settles
    // nothing and counts nothing.
    release();
    expect(await deadRelay).toEqual(NOTHING);
    expect(await delivery(h)).toEqual(settled);
  });
});
