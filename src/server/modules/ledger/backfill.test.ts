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
import { capturedBatch } from "@/server/modules/payments/refunds/testing";
import {
  openOrder,
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
    expect(
      seeded.postings.filter((row) => row.sourceType === "manual")
    ).toHaveLength(2);
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
