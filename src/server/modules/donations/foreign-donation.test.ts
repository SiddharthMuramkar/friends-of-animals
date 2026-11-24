import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  ledgerAccount,
  ledgerLine,
  ledgerPosting,
  paymentReviewCase,
  receipt,
  refund,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  donationRow,
  openDonations,
  openedOrder,
  paidByWebhook,
  startedDonation,
} from "./testing";

async function postings(h: Harness) {
  const rows = await h.db
    .select({
      sourceType: ledgerPosting.sourceType,
      code: ledgerAccount.code,
      debit: ledgerLine.debitMinor,
      credit: ledgerLine.creditMinor,
      reversal: ledgerPosting.reversalOfPostingId,
    })
    .from(ledgerPosting)
    .innerJoin(ledgerLine, eq(ledgerLine.postingId, ledgerPosting.id))
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
    .orderBy(asc(ledgerPosting.seq), asc(ledgerLine.lineNo));
  return rows.map(
    (row) =>
      `${row.sourceType}${row.reversal ? " (reversal)" : ""} ${row.code} ${row.debit > 0n ? `Dr ${row.debit}` : `Cr ${row.credit}`}`
  );
}

/** A donation paid from abroad, and its events drained. */
async function paidFromAbroad(h: Harness) {
  const started = await startedDonation(h);
  const orderId = await openedOrder(h, started);
  const paid = await paidByWebhook(h, orderId, { international: true });
  await h.drain();
  return { ...started, orderId, paymentId: paid.paymentId };
}

describe("a donation paid from abroad while FCRA is off", () => {
  it("is refunded in full at once, with no receipt, and held as owed back", async () => {
    const h = await createHarness();
    await openDonations(h);

    const { donationId, paymentId } = await paidFromAbroad(h);

    expect(h.gateway.refunds).toEqual([
      expect.objectContaining({
        paymentId,
        amountMinor: 50_000n,
        status: "processed",
      }),
    ]);
    const [returned] = await h.db.select().from(refund);
    expect(returned).toMatchObject({
      kind: "foreign_payment",
      status: "refunded",
      gatewayPaymentId: paymentId,
      requestedBy: null,
      decidedBy: null,
    });
    expect(await h.db.select().from(receipt)).toEqual([]);
    expect((await donationRow(h, donationId)).status).toBe("refunded");
    expect(await postings(h)).toEqual([
      "foreign_donation 1100 Dr 50000",
      "foreign_donation 2100 Cr 50000",
      "refund (reversal) 2100 Dr 50000",
      "refund (reversal) 1100 Cr 50000",
    ]);
  });

  it("tells the donor why their money came back, once", async () => {
    const h = await createHarness();
    await openDonations(h);

    await paidFromAbroad(h);
    await h.drain();

    const sent = h.email.sent.filter((each) => each.to === "asha@example.test");
    expect(sent.map((each) => each.subject)).toEqual([
      "We have returned your payment of ₹500.00",
    ]);
    expect(sent[0]!.text).toContain("outside India");
  });

  it("stays refund_pending while the gateway is still returning it", async () => {
    const h = await createHarness();
    await openDonations(h);
    h.gateway.answerNextRefund("pending");

    const { donationId, checkoutToken } = await paidFromAbroad(h);

    expect((await donationRow(h, donationId)).status).toBe("refund_pending");
    expect(await postings(h)).toEqual([
      "foreign_donation 1100 Dr 50000",
      "foreign_donation 2100 Cr 50000",
    ]);
    expect(
      await h.as(h.visitor()).getDonationOutcome({ donationId, checkoutToken })
    ).toEqual({
      ok: true,
      outcome: {
        status: "refund_pending",
        amountMinor: 50_000n,
        receiptNumber: null,
        receiptCancelled: false,
        foreignRefund: true,
      },
    });
  });

  it("is refused the same way when it is paid in another currency, which goes to review", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);

    await paidByWebhook(h, orderId, {
      amount: { amountMinor: 600n, currency: "USD" },
    });
    await h.drain();

    // Refunds go out in rupees only: finance returns it from the gateway's
    // dashboard, through review, and nothing is kept.
    expect(h.gateway.refunds).toEqual([]);
    expect(await h.db.select().from(paymentReviewCase)).toEqual([
      expect.objectContaining({ reason: "amount_mismatch", currency: "USD" }),
    ]);
    expect(await h.db.select().from(receipt)).toEqual([]);
    expect(await postings(h)).toEqual([]);
  });

  it("is taken as any donation once FOA is registered under FCRA", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("org.fcraEnabled", true);

    const { donationId } = await paidFromAbroad(h);

    expect((await donationRow(h, donationId)).status).toBe("captured");
    expect(h.gateway.refunds).toEqual([]);
    expect(await postings(h)).toEqual([
      "donation 1100 Dr 50000",
      "donation 4200 Cr 50000",
    ]);
  });

  it("refuses foreign money once, however often its signals arrive", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { orderId } = await paidFromAbroad(h);

    await h
      .as(h.visitor())
      .receiveGatewayWebhook(
        h.gateway.webhook({ type: "order.paid", orderId })
      );
    await h.drain();

    expect(h.gateway.refunds).toHaveLength(1);
    expect(await h.db.select().from(refund)).toHaveLength(1);
    expect(await postings(h)).toHaveLength(4);
  });
});
