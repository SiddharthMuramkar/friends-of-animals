import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  ledgerAccount,
  ledgerLine,
  ledgerPosting,
  paymentReviewCase,
  receipt,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import {
  batchOf,
  capturedDonation,
  donationRow,
  openDonations,
  openedOrder,
  paidByWebhook,
  startedDonation,
} from "./testing";

async function postings(h: Harness) {
  const rows = await h.db
    .select({
      id: ledgerPosting.id,
      sourceType: ledgerPosting.sourceType,
      reversalOf: ledgerPosting.reversalOfPostingId,
      code: ledgerAccount.code,
      debit: ledgerLine.debitMinor,
      credit: ledgerLine.creditMinor,
    })
    .from(ledgerPosting)
    .innerJoin(ledgerLine, eq(ledgerLine.postingId, ledgerPosting.id))
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
    .orderBy(asc(ledgerPosting.seq), asc(ledgerLine.lineNo));
  return rows;
}

const lines = (rows: Awaited<ReturnType<typeof postings>>) =>
  rows.map(
    (row) =>
      `${row.sourceType} ${row.code} ${row.debit > 0n ? `Dr ${row.debit}` : `Cr ${row.credit}`}`
  );

async function staff(
  h: Harness,
  role: "finance" | "staff_admin" | "competition_manager",
  email: string
) {
  const account = await h.seed.member({ email });
  await h.seed.grant(account, { role, scope: { type: "global" } });
  return h.signIn(account);
}

describe("refunding a donation", () => {
  it("reverses its posting, cancels its receipt and tells the donor", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);
    const admin = await staff(h, "staff_admin", "admin@example.test");
    const finance = await staff(h, "finance", "finance@example.test");

    const requested = await h.as(admin).requestDonationRefund({
      donationId,
      reason: "The donor gave twice by mistake and asked us to return one.",
    });
    expect(requested).toEqual({
      ok: true,
      refundId: expect.any(String),
      amountMinor: 50_000n,
    });
    if (!requested.ok) return;
    expect(
      await h.as(finance).approveRefund({ refundId: requested.refundId })
    ).toEqual({ ok: true, status: "approved" });
    await h.drain();

    expect((await donationRow(h, donationId)).status).toBe("refunded");
    const [issued] = await h.db.select().from(receipt);
    expect(issued!.cancelledAt).toEqual(expect.any(Date));
    const rows = await postings(h);
    expect(lines(rows)).toEqual([
      "donation 1100 Dr 50000",
      "donation 4200 Cr 50000",
      "refund 4200 Dr 50000",
      "refund 1100 Cr 50000",
    ]);
    expect(rows[2]!.reversalOf).toBe(rows[0]!.id);
    expect(h.email.lastTo("asha@example.test")?.subject).toBe(
      "Your donation of ₹500.00 was refunded"
    );
  });

  it("never gives a cancelled receipt's number to another donation", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);
    const admin = await staff(h, "staff_admin", "admin@example.test");
    const finance = await staff(h, "finance", "finance@example.test");
    const requested = await h.as(admin).requestDonationRefund({
      donationId,
      reason: "Returned at the donor's request.",
    });
    if (!requested.ok) throw new Error("No refund");
    await h.as(finance).approveRefund({ refundId: requested.refundId });
    await h.drain();

    await capturedDonation(h, { email: "ravi@example.test" });

    const numbers = (await h.db.select().from(receipt)).map((r) => r.number);
    expect(numbers.sort()).toEqual([
      "FOA-RCPT-2627-000001",
      "FOA-RCPT-2627-000002",
    ]);
  });

  it("refuses a second request while one is in progress, and a donation not yet paid", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);
    const pending = await startedDonation(h, { email: "ravi@example.test" });
    const admin = await staff(h, "staff_admin", "admin@example.test");
    const reason = "Returned at the donor's request.";

    expect(
      (await h.as(admin).requestDonationRefund({ donationId, reason })).ok
    ).toBe(true);
    expect(
      await h.as(admin).requestDonationRefund({ donationId, reason })
    ).toEqual({ ok: false, error: "refund_in_progress" });
    expect(
      await h
        .as(admin)
        .requestDonationRefund({ donationId: pending.donationId, reason })
    ).toEqual({ ok: false, error: "not_refundable" });
  });

  it("lets finance, a staff admin or a super admin ask; nobody else", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);
    const manager = await staff(h, "competition_manager", "cm@example.test");
    const member = await h.signIn(await h.seed.member());

    for (const actor of [manager, member, h.visitor()]) {
      await expect(
        h.as(actor).requestDonationRefund({ donationId, reason: "Please." })
      ).rejects.toThrow(DomainError);
    }
    const finance = await staff(h, "finance", "finance@example.test");
    expect(
      (
        await h
          .as(finance)
          .requestDonationRefund({ donationId, reason: "Please." })
      ).ok
    ).toBe(true);
  });

  it("never lets finance approve their own request", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);
    const finance = await staff(h, "finance", "finance@example.test");
    const requested = await h
      .as(finance)
      .requestDonationRefund({ donationId, reason: "Please." });
    if (!requested.ok) throw new Error("No refund");

    expect(
      await h.as(finance).approveRefund({ refundId: requested.refundId })
    ).toEqual({ ok: false, error: "same_person" });
  });
});

describe("expirePendingDonations", () => {
  it("expires a donation left unpaid past the setting's hours, and cancels its batch", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    await openedOrder(h, started);
    const worker = h.as({ kind: "system", process: "worker" });

    h.clock.advance({ hours: 23 });
    expect(await worker.expirePendingDonations()).toEqual({
      ok: true,
      expired: 0,
    });
    h.clock.advance({ hours: 1 });
    expect(await worker.expirePendingDonations()).toEqual({
      ok: true,
      expired: 1,
    });

    expect((await donationRow(h, started.donationId)).status).toBe("expired");
    expect((await batchOf(h, started.donationId)).status).toBe("cancelled");
    expect(await h.as(h.visitor()).payForDonation(started)).toEqual({
      ok: true,
      kind: "settled",
      status: "expired",
    });
  });

  it("captures a donation paid with no signal in, instead of expiring it", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    h.gateway.capture(orderId);
    h.clock.advance({ hours: 25 });

    expect(
      await h.as({ kind: "system", process: "worker" }).expirePendingDonations()
    ).toEqual({ ok: true, expired: 0 });
    expect((await donationRow(h, started.donationId)).status).toBe("captured");
  });

  it("runs only as the platform: a finance user is refused", async () => {
    const h = await createHarness();
    const finance = await staff(h, "finance", "finance@example.test");

    await expect(h.as(finance).expirePendingDonations()).rejects.toThrow(
      DomainError
    );
    expect(
      await h.as({ kind: "system", process: "cli" }).expirePendingDonations()
    ).toEqual({ ok: true, expired: 0 });
  });

  it("sends money that lands after expiry to review, never refunding it, and finance may accept it", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    h.clock.advance({ hours: 25 });
    await h.as({ kind: "system", process: "worker" }).expirePendingDonations();

    await paidByWebhook(h, orderId);
    await h.drain();

    expect((await donationRow(h, started.donationId)).status).toBe("expired");
    expect(await h.db.select().from(receipt)).toEqual([]);
    expect(h.gateway.refunds).toEqual([]);
    expect((await batchOf(h, started.donationId)).status).toBe("needs_review");
    const [reviewCase] = await h.db.select().from(paymentReviewCase);
    expect(reviewCase).toMatchObject({ reason: "donation_expired" });

    const finance = await staff(h, "finance", "finance@example.test");
    const view = await h
      .as(finance)
      .getPaymentReviewCase({ caseId: reviewCase!.id });
    expect(view).toMatchObject({
      ok: true,
      reviewCase: {
        purpose: "donation",
        donationId: started.donationId,
        competitionName: null,
        allowedOutcomes: ["confirm", "refund", "keep"],
      },
    });
    expect(
      await h.as(finance).resolvePaymentReviewCase({
        caseId: reviewCase!.id,
        outcome: "confirm",
        reason: "The donor paid a minute before the checkout expired.",
      })
    ).toEqual({ ok: true, batchStatus: "captured" });
    await h.drain();

    expect((await donationRow(h, started.donationId)).status).toBe("captured");
    expect((await h.db.select().from(receipt)).map((r) => r.number)).toEqual([
      "FOA-RCPT-2627-000001",
    ]);
    expect(lines(await postings(h))).toEqual([
      "donation 1100 Dr 50000",
      "donation 4200 Cr 50000",
    ]);
    expect(h.email.lastTo("asha@example.test")?.subject).toBe(
      "Thank you for your donation of ₹500.00"
    );
  });

  it("never confirms a donation's payment of another amount from review", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    await paidByWebhook(h, orderId, {
      amount: { amountMinor: 40_000n, currency: "INR" },
    });
    const [reviewCase] = await h.db.select().from(paymentReviewCase);
    const finance = await staff(h, "finance", "finance@example.test");

    expect(
      await h.as(finance).resolvePaymentReviewCase({
        caseId: reviewCase!.id,
        outcome: "confirm",
        reason: "Trying to accept a different amount.",
      })
    ).toEqual({ ok: false, error: "outcome_not_allowed" });
  });
});
