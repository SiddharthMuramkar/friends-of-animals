import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { outbox, paymentBatch } from "@/server/db/schema";
import { listFailedDeliveries } from "@/server/outbox";
import { RefundRefusedError } from "@/server/ports/payment-gateway";
import { createHarness, type Harness } from "@/test/harness";

import { signInStaff } from "../testing";
import {
  capturedBatch,
  chequePaidBatch,
  FEE_PAISE,
  REASON,
  refundAudit,
  refundRow,
  refundRows,
  signInManager,
  statusesOf,
} from "./testing";

// #80 slice 3: what the gateway makes of a refund, however its signals
// arrive. A pending refund waits (processing) until a refund webhook says
// it is processed or failed; a failed one can be retried by finance; a
// refund whose answer was lost is adopted, never sent twice. A batch paid
// offline is paid back by hand, and finance records how.

/** A whole-batch refund of a captured batch, approved by finance. */
async function approved(h: Harness, students = 2) {
  const paid = await capturedBatch(h, { students });
  const staff = await signInStaff(h, "staff_admin");
  const asked = await h
    .as(staff.actor)
    .requestRefund({ batchId: paid.batchId, reason: REASON });
  if (!asked.ok) throw new Error(JSON.stringify(asked));
  const finance = await signInStaff(h, "finance");
  const decided = await h
    .as(finance.actor)
    .approveRefund({ refundId: asked.refundId });
  if (!decided.ok) throw new Error(JSON.stringify(decided));
  return { paid, refundId: asked.refundId, finance };
}

/** A refund webhook as the gateway posts it, about our refund. */
function refundWebhook(
  h: Harness,
  type: "refund.processed" | "refund.failed",
  paid: { orderId: string; paymentId: string },
  refundId: string,
  options?: { signature?: "valid" | "invalid" | "missing" }
) {
  return h.gateway.webhook(
    {
      type,
      orderId: paid.orderId,
      refund: { refundId, paymentId: paid.paymentId },
    },
    options
  );
}

async function eventsOf(h: Harness, type: string) {
  return h.db
    .select()
    .from(outbox)
    .where(eq(outbox.eventType, type))
    .orderBy(asc(outbox.id));
}

describe("a refund the gateway holds", () => {
  it("waits as processing, then a refund.processed webhook refunds it; a replay changes nothing", async () => {
    const h = await createHarness();
    const { paid, refundId } = await approved(h);
    h.gateway.answerNextRefund("pending");

    await h.drain();

    expect(await refundRow(h, refundId)).toMatchObject({
      status: "processing",
      gatewayRefundId: h.gateway.refunds[0]!.id,
    });
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
    ]);

    h.gateway.settleRefund(h.gateway.refunds[0]!.id, "processed");
    const webhook = refundWebhook(
      h,
      "refund.processed",
      paid,
      h.gateway.refunds[0]!.id
    );
    expect(await h.as(h.visitor()).receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "refund_updated",
    });
    expect((await refundRow(h, refundId)).status).toBe("refunded");
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "refunded",
      "refunded",
    ]);
    expect(await eventsOf(h, "refund.processed")).toHaveLength(1);

    const settled = await refundRows(h);
    expect(await h.as(h.visitor()).receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "duplicate",
    });
    expect(await refundRows(h)).toEqual(settled);
    expect(h.gateway.refunds).toHaveLength(1);
  });

  it("ends the same whether the webhook comes before the drain or after it", async () => {
    const h = await createHarness();
    const early = await approved(h);
    // The webhook names a payment of ours before our drain has sent
    // anything: it sends and settles the refund itself.
    const webhookFirst = await h
      .as(h.visitor())
      .receiveGatewayWebhook(
        refundWebhook(h, "refund.processed", early.paid, "rfnd_unknown")
      );
    await h.drain();

    expect(webhookFirst).toEqual({ ok: true, outcome: "refund_updated" });
    expect((await refundRow(h, early.refundId)).status).toBe("refunded");
    expect(h.gateway.refunds).toHaveLength(1);
    expect((await refundAudit(h)).map((entry) => entry.action)).toEqual([
      "refund.requested",
      "refund.approved",
      "refund.sent",
      "refund.refunded",
    ]);
  });

  it("refuses a refund webhook with a bad signature, leaving no trace", async () => {
    const h = await createHarness();
    const { paid, refundId } = await approved(h);
    h.gateway.answerNextRefund("pending");
    await h.drain();
    const before = await refundRows(h);

    expect(
      await h.as(h.visitor()).receiveGatewayWebhook(
        refundWebhook(h, "refund.processed", paid, h.gateway.refunds[0]!.id, {
          signature: "invalid",
        })
      )
    ).toEqual({ ok: false, error: "rejected" });
    expect(await refundRows(h)).toEqual(before);
    expect((await refundRow(h, refundId)).status).toBe("processing");
  });
});

describe("a refund the gateway fails", () => {
  it("is failed with a refund.failed event; finance retries it with a fresh second factor and it goes once more", async () => {
    const h = await createHarness();
    const { paid, refundId, finance } = await approved(h);
    h.gateway.answerNextRefund("pending");
    await h.drain();
    const first = h.gateway.refunds[0]!;
    h.gateway.settleRefund(first.id, "failed");

    await h
      .as(h.visitor())
      .receiveGatewayWebhook(refundWebhook(h, "refund.failed", paid, first.id));

    expect(await refundRow(h, refundId)).toMatchObject({
      status: "failed",
      failedAt: h.clock.now(),
    });
    expect(await eventsOf(h, "refund.failed")).toHaveLength(1);
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
    ]);

    h.clock.advance({ minutes: 11 });
    await expect(
      h.as(finance.actor).retryRefund({ refundId })
    ).rejects.toMatchObject({ code: "step_up_required" });
    await h.passSecondFactor(finance.actor);
    expect(await h.as(finance.actor).retryRefund({ refundId })).toEqual({
      ok: true,
      status: "approved",
    });
    expect(await refundRow(h, refundId)).toMatchObject({
      status: "approved",
      attempt: 2,
      gatewayRefundId: null,
      failedAt: null,
    });
    await h.drain();

    expect(h.gateway.refunds).toHaveLength(2);
    expect(h.gateway.refunds[1]).toMatchObject({
      amountMinor: FEE_PAISE * 2n,
      idempotencyKey: `${refundId}-2`,
      notes: { refundId, attempt: "2" },
    });
    expect(await refundRow(h, refundId)).toMatchObject({
      status: "refunded",
      gatewayRefundId: h.gateway.refunds[1]!.id,
    });
    expect(await h.as(finance.actor).retryRefund({ refundId })).toEqual({
      ok: false,
      error: "not_failed",
    });
    expect((await refundAudit(h)).map((entry) => entry.action)).toEqual([
      "refund.requested",
      "refund.approved",
      "refund.sent",
      "refund.failed",
      "refund.retried",
      "refund.sent",
      "refund.refunded",
    ]);
  });

  it("lets finance close a failed refund instead, freeing its students", async () => {
    const h = await createHarness();
    const { refundId, finance } = await approved(h);
    h.gateway.answerNextRefund("failed");
    await h.drain();
    expect((await refundRow(h, refundId)).status).toBe("failed");

    expect(
      await h
        .as(finance.actor)
        .rejectRefund({ refundId, note: "Paid back by bank transfer instead." })
    ).toEqual({ ok: true, status: "rejected" });
  });

  it("never lets the requester close their own failed refund", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const both = await h.seed.member();
    await h.seed.grant(both, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    await h.seed.grant(both, { role: "finance", scope: { type: "global" } });
    const actor = await h.signIn(both);
    const asked = await h
      .as(actor)
      .requestRefund({ batchId: paid.batchId, reason: REASON });
    if (!asked.ok) throw new Error("not asked");
    const finance = await signInStaff(h, "finance");
    await h.as(finance.actor).approveRefund({ refundId: asked.refundId });
    h.gateway.answerNextRefund("failed");
    await h.drain();

    expect(
      await h
        .as(actor)
        .rejectRefund({ refundId: asked.refundId, note: "Closing my own." })
    ).toEqual({ ok: false, error: "same_person" });
    expect((await refundRow(h, asked.refundId)).status).toBe("failed");
  });

  it("lets only finance retry", async () => {
    const h = await createHarness();
    const { refundId } = await approved(h);
    h.gateway.answerNextRefund("failed");
    await h.drain();

    for (const actor of [
      (await signInStaff(h, "staff_admin")).actor,
      (await signInManager(h, "global")).actor,
    ]) {
      await expect(h.as(actor).retryRefund({ refundId })).rejects.toMatchObject(
        { code: "forbidden" }
      );
    }
  });
});

describe("a lost answer", () => {
  it("is adopted on the next drain: the gateway holds exactly one refund", async () => {
    const h = await createHarness();
    const { refundId } = await approved(h);
    h.gateway.answerNextRefund("lost_response");

    await h.drain();

    expect(h.gateway.refunds).toHaveLength(1);
    expect((await refundRow(h, refundId)).status).toBe("approved");

    h.clock.advance({ minutes: 5 });
    await h.drain();

    expect(h.gateway.refunds).toHaveLength(1);
    expect(await refundRow(h, refundId)).toMatchObject({
      status: "refunded",
      gatewayRefundId: h.gateway.refunds[0]!.id,
    });
    expect(await listFailedDeliveries(h.db)).toEqual([]);
  });

  it("is sent again when the gateway refused it outright, once it answers", async () => {
    const h = await createHarness();
    const { refundId } = await approved(h);
    h.gateway.answerNextRefund("refused");

    await h.drain();
    expect(h.gateway.refunds).toHaveLength(0);

    h.clock.advance({ minutes: 5 });
    await h.drain();
    expect(h.gateway.refunds).toHaveLength(1);
    expect((await refundRow(h, refundId)).status).toBe("refunded");
  });
});

describe("a refund the gateway refuses for good", () => {
  it("is failed at once, so finance may close it or send it again, and its students aren't held forever", async () => {
    const h = await createHarness();
    const { paid, refundId, finance } = await approved(h);
    // Someone refunded the whole payment from the gateway's dashboard, so
    // nothing is left for ours: the gateway will never take it.
    await h.gateway.refund({
      paymentId: paid.paymentId,
      amount: { amountMinor: FEE_PAISE * 2n, currency: "INR" },
      idempotencyKey: "dashboard",
      notes: {},
    });

    await h.drain();

    expect(await refundRow(h, refundId)).toMatchObject({
      status: "failed",
      failedAt: h.clock.now(),
      gatewayRefundId: null,
    });
    expect(h.gateway.refunds).toHaveLength(1);
    expect(await eventsOf(h, "refund.failed")).toHaveLength(1);
    expect(await listFailedDeliveries(h.db)).toEqual([]);
    expect((await refundAudit(h)).at(-1)).toMatchObject({
      action: "refund.failed",
      before: { status: "approved" },
      after: { status: "failed", refusedByGateway: true },
    });
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "confirmed",
      "confirmed",
    ]);

    // Draining again sends nothing more and changes nothing.
    const before = await refundRows(h);
    h.clock.advance({ minutes: 30 });
    await h.drain();
    expect(await refundRows(h)).toEqual(before);

    await h.passSecondFactor(finance.actor);
    expect(
      await h.as(finance.actor).rejectRefund({
        refundId,
        note: "Refunded from the gateway's dashboard already.",
      })
    ).toEqual({ ok: true, status: "rejected" });
  });

  it("ignores a delayed refusal after the gateway has acknowledged the attempt", async () => {
    const h = await createHarness();
    const { paid, refundId } = await approved(h);
    const started = Promise.withResolvers<void>();
    const refuse = Promise.withResolvers<void>();
    vi.spyOn(h.gateway, "refund").mockImplementationOnce(async () => {
      started.resolve();
      await refuse.promise;
      throw new RefundRefusedError("Delayed definitive refusal");
    });
    const delivery = h.drain();
    try {
      await started.promise;
      h.gateway.answerNextRefund("pending");
      expect(
        await h
          .as(h.visitor())
          .receiveGatewayWebhook(
            refundWebhook(h, "refund.processed", paid, "rfnd_unknown")
          )
      ).toEqual({ ok: true, outcome: "refund_updated" });
      const acknowledged = await refundRow(h, refundId);
      expect(acknowledged).toMatchObject({
        status: "processing",
        gatewayRefundId: h.gateway.refunds[0]!.id,
      });
      refuse.resolve();
      await delivery;
      expect(await refundRow(h, refundId)).toEqual(acknowledged);
      expect(await eventsOf(h, "refund.failed")).toEqual([]);
    } finally {
      refuse.resolve();
      await delivery;
    }
  });
});

describe("a batch paid through another gateway", () => {
  it("is never refunded through this one: it stays approved and the delivery fails for staff to see", async () => {
    const h = await createHarness();
    const { paid, refundId } = await approved(h);
    await h.db
      .update(paymentBatch)
      .set({ gateway: "razorpay" })
      .where(eq(paymentBatch.id, paid.batchId));

    await h.drain();

    expect(h.gateway.refunds).toHaveLength(0);
    expect((await refundRow(h, refundId)).status).toBe("approved");
    expect(
      await h
        .as(h.visitor())
        .receiveGatewayWebhook(
          refundWebhook(h, "refund.processed", paid, "rfnd_elsewhere")
        )
    ).toEqual({ ok: true, outcome: "refund_updated" });
    expect(h.gateway.refunds).toHaveLength(0);
  });
});

describe("a batch paid offline", () => {
  it("is approved to be paid by hand; finance records how, and it is refunded with no gateway call", async () => {
    const h = await createHarness();
    const paid = await chequePaidBatch(h);
    const staff = await signInStaff(h, "staff_admin");
    const asked = await h
      .as(staff.actor)
      .requestRefund({ batchId: paid.batchId, reason: REASON });
    if (!asked.ok) throw new Error("not asked");
    const finance = await signInStaff(h, "finance");
    await h.as(finance.actor).approveRefund({ refundId: asked.refundId });
    await h.drain();

    expect((await refundRow(h, asked.refundId)).status).toBe("approved");
    expect(
      await h.as(finance.actor).recordManualRefund({
        refundId: asked.refundId,
        method: "bank_transfer",
        reference: "  ",
      })
    ).toEqual({ ok: false, error: "reference_invalid" });
    expect(
      await h.as(finance.actor).recordManualRefund({
        refundId: asked.refundId,
        method: "bank_transfer",
        reference: "utib0001234567",
      })
    ).toEqual({ ok: true, status: "refunded" });

    expect(await refundRow(h, asked.refundId)).toMatchObject({
      status: "refunded",
      manualMethod: "bank_transfer",
      manualReference: "UTIB0001234567",
      manualRecordedBy: finance.userId,
      refundedAt: h.clock.now(),
    });
    expect(await statusesOf(h, paid.registrationIds)).toEqual([
      "refunded",
      "refunded",
    ]);
    expect(h.gateway.refunds).toHaveLength(0);
    expect((await refundAudit(h)).at(-1)).toMatchObject({
      action: "refund.refunded",
      actorUserId: finance.userId,
      after: { status: "refunded", method: "bank_transfer" },
    });
    expect(JSON.stringify((await refundAudit(h)).at(-1)?.after)).not.toContain(
      "UTIB"
    );
  });

  it("never lets the requester record paying back their own refund", async () => {
    const h = await createHarness();
    const paid = await chequePaidBatch(h);
    const both = await h.seed.member();
    await h.seed.grant(both, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    await h.seed.grant(both, { role: "finance", scope: { type: "global" } });
    const actor = await h.signIn(both);
    const asked = await h
      .as(actor)
      .requestRefund({ batchId: paid.batchId, reason: REASON });
    if (!asked.ok) throw new Error("not asked");
    const finance = await signInStaff(h, "finance");
    await h.as(finance.actor).approveRefund({ refundId: asked.refundId });
    const before = await refundRows(h);

    expect(
      await h.as(actor).recordManualRefund({
        refundId: asked.refundId,
        method: "bank_transfer",
        reference: "UTIB0001234567",
      })
    ).toEqual({ ok: false, error: "same_person" });
    expect(await refundRows(h)).toEqual(before);
    expect(
      await h.as(finance.actor).recordManualRefund({
        refundId: asked.refundId,
        method: "bank_transfer",
        reference: "UTIB0001234567",
      })
    ).toEqual({ ok: true, status: "refunded" });
  });

  it("records a manual refund only for an approved manual refund, by finance", async () => {
    const h = await createHarness();
    const { refundId, finance } = await approved(h);
    const manual = {
      refundId,
      method: "cheque",
      reference: "004512",
    } as const;

    expect(await h.as(finance.actor).recordManualRefund(manual)).toEqual({
      ok: false,
      error: "not_manual",
    });
    await expect(
      h
        .as((await signInStaff(h, "staff_admin")).actor)
        .recordManualRefund(manual)
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
