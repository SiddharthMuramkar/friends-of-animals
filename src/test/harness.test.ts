import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox, user } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { DEFAULT_DRAIN_LIMIT, drainOutbox } from "@/server/outbox";
import { emitUserSignedUp } from "@/server/outbox/testing";

import { createHarness } from "./harness";

describe("createHarness", () => {
  it("starts the clock at the instant asked for", async () => {
    const h = await createHarness({ now: "2027-04-01T00:00:00.000Z" });
    expect(h.clock.now().toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });

  it("gives every test its own database, clock and mailbox", async () => {
    const first = await createHarness();
    const second = await createHarness();

    await first.seed.member();
    first.clock.advance({ hours: 1 });
    await first.email.send({ to: "a@example.test", subject: "S", text: "t" });

    const [users] = await second.db.select({ n: count() }).from(user);
    expect(users?.n).toBe(0);
    expect(second.clock.now()).not.toEqual(first.clock.now());
    expect(second.email.sent).toEqual([]);
  });

  it("seeds with the harness database and clock", async () => {
    const h = await createHarness();
    h.clock.advance({ days: 3 });

    const member = await h.seed.member();

    const [users] = await h.db.select({ n: count() }).from(user);
    expect(users?.n).toBe(1);
    expect(member.createdAt).toEqual(h.clock.now());
  });

  it("makes visitors whose request details a test can set", async () => {
    const h = await createHarness();

    expect(h.visitor()).toEqual({
      kind: "visitor",
      meta: { ip: "203.0.113.10", userAgent: "Seam 1 test" },
    });
    expect(h.visitor({ ip: "198.51.100.4" })).toMatchObject({
      meta: { ip: "198.51.100.4" },
    });
  });

  it("hands use cases the harness deps, not production ones", async () => {
    const h = await createHarness();
    expect(h.deps.db).toBe(h.db);
    expect(h.deps.clock).toBe(h.clock);
    expect(h.deps.email).toBe(h.email);
    expect(h.deps.errors).toBe(h.errors);
  });
});

describe("drain", () => {
  it("delivers every due event in process, pass after pass, until none is due", async () => {
    const h = await createHarness();
    const events = DEFAULT_DRAIN_LIMIT + 5;
    for (let i = 0; i < events; i += 1) {
      // Accounts that don't exist: each delivery succeeds, sending nothing.
      await emitUserSignedUp(h.deps, uuidv7(h.clock.now()));
    }

    const report = await h.drain();

    expect(report).toEqual({
      dispatched: events,
      retried: 0,
      failed: 0,
      skipped: 0,
    });
    const statuses = await h.db.select({ status: outbox.status }).from(outbox);
    expect(new Set(statuses.map((row) => row.status))).toEqual(
      new Set(["dispatched"])
    );
    expect(await drainOutbox(h.deps)).toMatchObject({ dispatched: 0 });
  });

  it("needs nothing but the harness: no worker, no queue", async () => {
    const h = await createHarness();
    expect(await h.drain()).toEqual({
      dispatched: 0,
      retried: 0,
      failed: 0,
      skipped: 0,
    });
  });
});
