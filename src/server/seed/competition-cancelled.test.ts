import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  competition,
  institutionRegistration,
  paymentBatch,
  refund,
  refundItem,
  registration,
} from "@/server/db/schema";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";

import { SEED_CANCELLED } from "./competition-cancelled";

describe("the cancelled competition seed (#80)", () => {
  it("adds a cancelled competition with a refunded and a cancelled registration, and running it again changes nothing", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const rows = async () => ({
      competitions: await h.db
        .select()
        .from(competition)
        .where(eq(competition.id, SEED_CANCELLED.competitionId)),
      institutions: await h.db
        .select()
        .from(institutionRegistration)
        .where(
          eq(
            institutionRegistration.competitionId,
            SEED_CANCELLED.competitionId
          )
        ),
      registrations: await h.db
        .select()
        .from(registration)
        .where(eq(registration.competitionId, SEED_CANCELLED.competitionId))
        .orderBy(asc(registration.id)),
      batches: await h.db
        .select()
        .from(paymentBatch)
        .where(eq(paymentBatch.competitionId, SEED_CANCELLED.competitionId)),
      refunds: await h.db
        .select()
        .from(refund)
        .where(eq(refund.batchId, SEED_CANCELLED.batchId)),
      items: await h.db
        .select()
        .from(refundItem)
        .where(eq(refundItem.batchId, SEED_CANCELLED.batchId)),
    });
    const once = await rows();
    await h.seed.preview();

    expect(once.competitions).toEqual([
      expect.objectContaining({
        code: "WINGS26",
        status: "cancelled",
        cancelledAt: expect.any(Date),
        cancelReason: expect.stringMatching(/\S/),
      }),
    ]);
    expect(once.institutions).toHaveLength(1);
    expect(
      once.registrations.map(({ id, status }) => ({ id, status }))
    ).toEqual([
      { id: SEED_CANCELLED.refunded.registrationId, status: "refunded" },
      { id: SEED_CANCELLED.cancelled.registrationId, status: "cancelled" },
    ]);
    expect(once.refunds).toEqual([
      expect.objectContaining({
        kind: "cancellation",
        status: "refunded",
        method: "gateway",
        requestedBy: null,
        decidedBy: null,
      }),
    ]);
    expect(once.items).toHaveLength(1);
    expect(await rows()).toEqual(once);
  });

  it("shows a super admin the cancelled competition, and finance its refund among the done", async () => {
    const h = await createHarness();
    await h.seed.preview();

    expect(
      await h
        .as((await signInStaff(h, "super_admin")).actor)
        .getCompetitionCancellation({
          competitionId: SEED_CANCELLED.competitionId,
        })
    ).toMatchObject({
      ok: true,
      competition: { status: "cancelled", name: "Wings at Dusk" },
      effects: null,
    });
    const done = await h
      .as((await signInStaff(h, "finance")).actor)
      .listRefunds({ state: "done" });
    expect(done).toMatchObject({ ok: true });
    expect(done.ok && done.refunds.map((each) => each.id)).toContain(
      SEED_CANCELLED.refundId
    );
  });
});
