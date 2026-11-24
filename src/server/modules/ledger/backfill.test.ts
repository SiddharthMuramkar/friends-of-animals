import { eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  ledgerAccount,
  ledgerLine,
  ledgerPosting,
  paymentBatch,
  user,
} from "@/server/db/schema";
import {
  capturedBatch,
  REASON,
  refundRow,
} from "@/server/modules/payments/refunds/testing";
import {
  confirmReviewedReceipt,
  openOrder,
  reviewCasesOf,
  schoolWithStudents,
  signInStaff,
} from "@/server/modules/payments/testing";
import { SCHEDULES } from "@/server/outbox/schedules";
import { SEED_PAYMENTS } from "@/server/seed/payments";
import { SEED_REFUNDS } from "@/server/seed/refunds";
import { createHarness } from "@/test/harness";

describe("backfillLedgerFromPayments", () => {
  it("books the historical captures once, including a capture from before offline payments", async () => {
    const h = await createHarness();
    const { actor } = await signInStaff(h);
    const first = await openOrder(await schoolWithStudents(h, { students: 1 }));
    const second = await openOrder(
      await schoolWithStudents(h, {
        students: 1,
        code: "PARK27",
        name: "Park Road School",
      })
    );
    const paymentIds = [];
    for (const { orderId } of [first, second]) {
      paymentIds.push(h.gateway.capture(orderId).paymentId);
      expect(
        await h.as(h.visitor()).receiveGatewayWebhook(
          h.gateway.webhook({
            type: "payment.captured",
            orderId,
          })
        )
      ).toMatchObject({ ok: true, outcome: "captured" });
    }
    await h.db
      .update(paymentBatch)
      .set({ captureMethod: null })
      .where(eq(paymentBatch.id, first.batchId));
    const read = () =>
      h.db.select().from(ledgerPosting).orderBy(ledgerPosting.seq);

    await expect(
      h.as(actor).backfillLedgerFromPayments()
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await read()).toEqual([]);
    const system = h.as({ kind: "system", process: "cli" });
    expect(await system.backfillLedgerFromPayments()).toEqual({
      capturesPosted: 2,
      refundsPosted: 0,
    });
    const posted = await read();
    expect(posted.map((row) => row.sourceId).sort()).toEqual(paymentIds.sort());
    expect(await system.backfillLedgerFromPayments()).toEqual({
      capturesPosted: 0,
      refundsPosted: 0,
    });
    await h.drain();
    expect(await read()).toEqual(posted);
  });

  it("reconciles a missed capture from the 03:00 IST worker schedule", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 1 });
    const schedule = SCHEDULES.find(
      ({ name }) => name === "ledger.reconcile_payments"
    );
    expect(schedule).toMatchObject({ cron: "0 3 * * *", tz: "Asia/Kolkata" });

    await schedule!.run(h.deps);
    expect(await h.db.select().from(ledgerPosting)).toEqual([
      expect.objectContaining({
        sourceId: paid.paymentId,
        sourceType: "payment_capture",
      }),
    ]);
  });

  it("reports an unsupported receipt and reconciles later INR captures and refunds once", async () => {
    const h = await createHarness();
    const { batchId, orderId } = await openOrder(
      await schoolWithStudents(h, { students: 1 })
    );
    h.gateway.capture(orderId, {
      amount: { amountMinor: 50_000n, currency: "USD" },
    });
    const visitor = h.as(h.visitor());
    expect(
      await visitor.receiveGatewayWebhook(
        h.gateway.webhook({ type: "payment.captured", orderId })
      )
    ).toEqual({ ok: true, outcome: "needs_review" });
    const [review] = await reviewCasesOf(h, batchId);
    const finance = h.as((await signInStaff(h)).actor);
    expect(
      await confirmReviewedReceipt(
        h,
        finance,
        review!,
        "Accept the payment after reviewing the receipt"
      )
    ).toEqual({ ok: true, batchStatus: "captured" });

    // The unsupported batch sorts before the INR batch in the capture scan.
    h.clock.advance({ seconds: 1 });
    const paid = await capturedBatch(h, { students: 1, code: "PARK27" });
    const staff = h.as((await signInStaff(h, "staff_admin")).actor);
    const requested = await staff.requestRefund({
      batchId: paid.batchId,
      reason: REASON,
    });
    if (!requested.ok) throw new Error(requested.error);
    const { refundId } = requested;
    expect(await finance.approveRefund({ refundId })).toMatchObject({
      ok: true,
    });
    expect(
      await visitor.receiveGatewayWebhook(
        h.gateway.webhook({
          type: "refund.processed",
          orderId: paid.orderId,
          refund: { refundId: "rfnd_reconcile", paymentId: paid.paymentId },
        })
      )
    ).toMatchObject({ ok: true, outcome: "refund_updated" });
    expect(await refundRow(h, refundId)).toMatchObject({ status: "refunded" });

    const read = () =>
      h.db.select().from(ledgerPosting).orderBy(ledgerPosting.seq);
    expect(await read()).toEqual([]);
    const schedule = SCHEDULES.find(
      ({ name }) => name === "ledger.reconcile_payments"
    )!;
    await schedule.run(h.deps);
    const posted = await read();
    expect(posted).toEqual([
      expect.objectContaining({
        sourceType: "payment_capture",
        sourceId: paid.paymentId,
      }),
      expect.objectContaining({
        sourceType: "refund",
        sourceId: refundId,
        reversalOfPostingId: posted[0]?.id,
      }),
    ]);

    await schedule.run(h.deps);
    expect(await read()).toEqual(posted);
    expect(h.errors.reported).toHaveLength(2);
    for (const { tags, extra } of h.errors.reported) {
      expect(tags).toEqual({
        where: "ledger.reconcile_payments",
        reason: "unsupported_currency",
        sourceType: "payment_batch",
      });
      expect(extra).toEqual({ sourceId: batchId });
    }
  });
});

describe("the preview ledger seed", () => {
  it("keeps the same journal, category and audit on reseed and gives the finance user access", async () => {
    const h = await createHarness();
    const read = async () => ({
      postings: await h.db
        .select()
        .from(ledgerPosting)
        .orderBy(ledgerPosting.seq),
      lines: await h.db.select().from(ledgerLine).orderBy(ledgerLine.id),
      accounts: await h.db
        .select()
        .from(ledgerAccount)
        .orderBy(ledgerAccount.code),
      audit: await h.db
        .select()
        .from(auditLog)
        .where(like(auditLog.action, "ledger.%"))
        .orderBy(auditLog.id),
    });
    await h.seed.preview();
    const seeded = await read();
    expect(seeded.postings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "payment_capture",
          sourceId: "pay_seed_paid",
        }),
        expect.objectContaining({
          sourceType: "offline_payment",
          sourceId: SEED_PAYMENTS.cheque.offlinePaymentId,
        }),
        expect.objectContaining({
          sourceType: "refund",
          sourceId: SEED_REFUNDS.refunded.refundId,
        }),
      ])
    );
    // Two from the ledger seed, and the year-end entry in the locked
    // March 2026 from the periods seed (#109).
    expect(
      seeded.postings.filter((row) => row.sourceType === "manual")
    ).toHaveLength(3);
    expect(
      seeded.postings.some((row) => row.sourceId === "pay_seed_review")
    ).toBe(false);
    expect(seeded.accounts).toContainEqual(
      expect.objectContaining({ code: "5110", name: "Venue hire" })
    );
    await h.seed.preview();
    expect(await read()).toEqual(seeded);

    const [finance] = await h.db
      .select()
      .from(user)
      .where(eq(user.email, "ledger-finance@example.test"));
    expect(finance).toBeDefined();
    const actor = await h.signIn({ email: finance!.email! });
    expect(await h.as(actor).listPostings({})).toMatchObject({ ok: true });
  });
});
