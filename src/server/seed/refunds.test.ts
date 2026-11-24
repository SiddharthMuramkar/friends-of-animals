import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { refund, refundItem, registration } from "@/server/db/schema";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";

import { SEED_CANCELLED } from "./competition-cancelled";
import { SEED_PAYMENTS } from "./payments";
import { SEED_REFUNDS } from "./refunds";

describe("the refunds seed", () => {
  it("adds a refund waiting for finance and a refunded one, and running it again changes nothing", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const rows = async () => ({
      refunds: await h.db.select().from(refund).orderBy(asc(refund.id)),
      items: await h.db.select().from(refundItem),
      registrations: await h.db.select().from(registration),
    });
    const once = await rows();
    await h.seed.preview();

    expect(
      once.refunds.map(({ id, status, kind }) => ({ id, status, kind }))
    ).toEqual([
      {
        id: SEED_REFUNDS.requested.refundId,
        status: "requested",
        kind: "discretionary",
      },
      {
        id: SEED_REFUNDS.refunded.refundId,
        status: "refunded",
        kind: "discretionary",
      },
      // The cancelled competition's seed (./competition-cancelled.ts).
      {
        id: SEED_CANCELLED.refundId,
        status: "refunded",
        kind: "cancellation",
      },
    ]);
    expect(await rows()).toEqual(once);
  });

  it("shows finance the waiting partial refund, and the refunded batch's student as refunded", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const finance = await signInStaff(h, "finance");

    expect(
      await h.as(finance.actor).listRefunds({ state: "waiting" })
    ).toMatchObject({
      ok: true,
      refunds: [
        {
          id: SEED_REFUNDS.requested.refundId,
          batchId: SEED_PAYMENTS.paid.batchId,
          amountMinor: 100_000n,
          students: 1,
          competitionName: "Kinder Skies",
        },
      ],
    });
    const done = await h
      .as(finance.actor)
      .getRefund({ refundId: SEED_REFUNDS.refunded.refundId });
    expect(done).toMatchObject({
      ok: true,
      refund: {
        status: "refunded",
        gatewayRefundId: SEED_REFUNDS.refunded.gatewayRefundId,
        items: [
          {
            registrationId: SEED_REFUNDS.refunded.registrationId,
            registrationNumber: SEED_REFUNDS.refunded.registrationNumber,
            status: "refunded",
          },
        ],
      },
    });
    const waiting = await h
      .as(finance.actor)
      .getRefund({ refundId: SEED_REFUNDS.requested.refundId });
    expect(waiting).toMatchObject({
      ok: true,
      refund: { items: [{ status: "confirmed" }] },
    });
  });
});
