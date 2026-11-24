import { sql } from "drizzle-orm";
import { expect, it } from "vitest";

import { outbox } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { DISPATCHED_OUTBOX } from "./policies/messages";

it("pages only expired dispatched rows by dispatch time and id", async () => {
  const h = await createHarness();
  const ids = [
    "01938a00-0000-7000-8000-000000000001",
    "01938a00-0000-7000-8000-000000000002",
    "01938a00-0000-7000-8000-000000000003",
    "01938a00-0000-7000-8000-000000000004",
  ] as const;
  const [first, second, earlier, fresh] = ids;
  const cutoff = h.clock.now();
  for (const [id, offset] of [
    [first, 0],
    [second, 0],
    [earlier, -1],
    [fresh, 1],
  ] as const) {
    await h.db.insert(outbox).values({
      id,
      eventId: id,
      aggregateType: "user",
      aggregateId: id,
      eventType: "identity.user_signed_up",
      payload: { userId: id },
      handler: "notifications.dispatch",
      status: "dispatched",
      dispatchedAt: new Date(cutoff.getTime() + offset),
      occurredAt: new Date(cutoff.getTime() - 1000),
      availableAt: new Date(cutoff.getTime() - 1000),
    });
  }

  const query = {
    now: cutoff,
    cutoff,
    limit: 2,
    blindIndex: h.deps.blindIndex,
    cipher: h.deps.cipher,
  };
  await h.db.transaction(async (tx) => {
    const page = await DISPATCHED_OUTBOX.candidates(tx, {
      ...query,
      after: null,
    });
    expect(page.candidates.map(({ id }) => id)).toEqual([earlier, first]);
    expect(page.next).toMatchObject({ id: first, anchor: expect.any(String) });
    const rest = await DISPATCHED_OUTBOX.candidates(tx, {
      ...query,
      after: page.next,
    });
    expect(rest.candidates.map(({ id }) => id)).toEqual([second]);
    expect(rest.next).toBeNull();
  });
});

it("migrates the active-hold and dispatched-expiry indexes", async () => {
  const h = await createHarness();
  const { rows } = await h.db.execute<{ indexdef: string }>(sql`
    SELECT indexdef FROM pg_indexes
    WHERE indexname IN ('legal_hold_active_placed_at_idx', 'outbox_dispatched_at_idx')
    ORDER BY indexname
  `);
  expect(rows.map(({ indexdef }) => indexdef)).toEqual([
    expect.stringMatching(/\(placed_at, id\) WHERE \(released_at IS NULL\)/),
    expect.stringMatching(
      /\(dispatched_at, id\) WHERE \(dispatched_at IS NOT NULL\)/
    ),
  ]);
});
