import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  ledgerAccount,
  ledgerLine,
  ledgerPosting,
  outbox,
  receipt,
  receiptLink,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  batchOf,
  capturedDonation,
  donationRow,
  openDonations,
  openedOrder,
  paidByWebhook,
  receiptTokenSentTo,
  startedDonation,
} from "./testing";

/** Each posting's source and lines, as account codes and sides. */
async function postings(h: Harness) {
  const rows = await h.db
    .select({
      sourceType: ledgerPosting.sourceType,
      sourceId: ledgerPosting.sourceId,
      code: ledgerAccount.code,
      debit: ledgerLine.debitMinor,
      credit: ledgerLine.creditMinor,
    })
    .from(ledgerPosting)
    .innerJoin(ledgerLine, eq(ledgerLine.postingId, ledgerPosting.id))
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, ledgerLine.accountId))
    .orderBy(asc(ledgerPosting.seq), asc(ledgerLine.lineNo));
  return rows.map(
    (row) =>
      `${row.sourceType} ${row.code} ${row.debit > 0n ? `Dr ${row.debit}` : `Cr ${row.credit}`}`
  );
}

async function receiptNumbers(h: Harness) {
  const rows = await h.db
    .select({ number: receipt.number })
    .from(receipt)
    .orderBy(asc(receipt.seq));
  return rows.map((row) => row.number);
}

/** What a replay must leave as it was. */
async function snapshot(h: Harness) {
  return {
    postings: await postings(h),
    receipts: await receiptNumbers(h),
    links: (await h.db.select().from(receiptLink)).length,
    outbox: (await h.db.select().from(outbox)).length,
    audit: (await h.db.select().from(auditLog)).length,
    emails: h.email.sent.length,
  };
}

describe("a captured donation", () => {
  it("gets exactly one ledger posting and one receipt with the year's next number", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    expect(h.gateway.orders).toEqual([
      expect.objectContaining({
        orderId,
        amount: { amountMinor: 50_000n, currency: "INR" },
      }),
    ]);

    const { paymentId } = await paidByWebhook(h, orderId);
    await h.drain();

    expect(await donationRow(h, started.donationId)).toMatchObject({
      status: "captured",
      gatewayPaymentId: paymentId,
    });
    expect(await batchOf(h, started.donationId)).toMatchObject({
      status: "captured",
      gatewayPaymentId: paymentId,
    });
    expect(await receiptNumbers(h)).toEqual(["FOA-RCPT-2627-000001"]);
    expect(await postings(h)).toEqual([
      "donation 1100 Dr 50000",
      "donation 4200 Cr 50000",
    ]);

    await capturedDonation(h, { email: "ravi@example.test", name: "Ravi K" });
    expect(await receiptNumbers(h)).toEqual([
      "FOA-RCPT-2627-000001",
      "FOA-RCPT-2627-000002",
    ]);
  });

  it.each([
    ["corporate", "4210"],
    ["csr", "4220"],
  ] as const)(
    "credits a %s donation to account %s",
    async (donorType, code) => {
      const h = await createHarness();
      await openDonations(h);

      await capturedDonation(h, {
        donorType,
        organisationName: "Acme Pvt Ltd",
        discloseOrganisation: false,
      });

      expect(await postings(h)).toEqual([
        "donation 1100 Dr 50000",
        `donation ${code} Cr 50000`,
      ]);
    }
  );

  it("emails the donor a 7-day receipt link, never an attachment, and stores only its hash", async () => {
    const h = await createHarness();
    await openDonations(h);

    await capturedDonation(h);

    const email = h.email.lastTo("asha@example.test");
    expect(email?.subject).toBe("Thank you for your donation of ₹500.00");
    expect(email?.text).toContain("FOA-RCPT-2627-000001");
    expect(email).not.toHaveProperty("attachments");
    const token = receiptTokenSentTo(h, "asha@example.test");
    const links = await h.db.select().from(receiptLink);
    expect(links).toEqual([
      expect.objectContaining({
        issuedTo: "donor",
        expiresAt: new Date(h.clock.now().getTime() + 7 * 24 * 3600 * 1000),
      }),
    ]);
    expect(links[0]!.tokenHash).not.toBe(token);
    const outboxRows = await h.db.select().from(outbox);
    expect(JSON.stringify(outboxRows)).not.toContain(token);
  });

  it("tells a signed-in donor in their inbox too, without the link", async () => {
    const h = await createHarness();
    await openDonations(h);
    const member = await h.seed.member({ email: "meera@example.test" });
    const actor = await h.signIn(member);

    await capturedDonation(h, { email: "meera@example.test" }, actor);

    const inbox = await h.as(actor).listInbox({});
    expect(JSON.stringify(inbox)).toContain("FOA-RCPT-2627-000001");
    expect(JSON.stringify(inbox)).not.toContain("/receipts/");
  });

  it("numbers by Indian financial year, restarting on 1 April in IST", async () => {
    const h = await createHarness({ now: new Date("2027-03-31T18:29:00Z") });
    await openDonations(h);

    await capturedDonation(h);
    h.clock.set(new Date("2027-03-31T18:30:00Z"));
    await capturedDonation(h, { email: "ravi@example.test" });

    expect(await receiptNumbers(h)).toEqual([
      "FOA-RCPT-2627-000001",
      "FOA-RCPT-2728-000001",
    ]);
  });

  it("uses up no number for a failed payment", async () => {
    const h = await createHarness();
    await openDonations(h);
    const failing = await startedDonation(h);
    const failingOrder = await openedOrder(h, failing);
    h.gateway.fail(failingOrder);
    await h
      .as(h.visitor())
      .receiveGatewayWebhook(
        h.gateway.webhook({ type: "payment.failed", orderId: failingOrder })
      );

    expect((await donationRow(h, failing.donationId)).status).toBe("failed");
    await capturedDonation(h, { email: "ravi@example.test" });
    expect(await receiptNumbers(h)).toEqual(["FOA-RCPT-2627-000001"]);

    // A later attempt on the failed donation's order still succeeds.
    await paidByWebhook(h, failingOrder);
    expect(await receiptNumbers(h)).toEqual([
      "FOA-RCPT-2627-000001",
      "FOA-RCPT-2627-000002",
    ]);
  });

  it("changes nothing on a replayed webhook, a later Checkout return, or both again", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    const paid = h.gateway.capture(orderId);
    const webhook = h.gateway.webhook({ type: "payment.captured", orderId });
    expect(await h.as(h.visitor()).receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "captured",
    });
    await h.drain();
    const before = await snapshot(h);

    expect(await h.as(h.visitor()).receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "duplicate",
    });
    const returned = {
      ...started,
      paymentId: paid.paymentId,
      signature: paid.signature,
    };
    expect(await h.as(h.visitor()).confirmDonationCheckout(returned)).toEqual({
      ok: true,
      status: "captured",
    });
    await h
      .as(h.visitor())
      .receiveGatewayWebhook(
        h.gateway.webhook({ type: "order.paid", orderId })
      );
    await h.as(h.visitor()).confirmDonationCheckout(returned);
    await h.drain();

    const after = await snapshot(h);
    // Only the new webhook's own event row and its sync are new.
    expect({ ...after, audit: before.audit }).toEqual(before);
  });

  it("captures once from the Checkout return, before any webhook", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    const paid = h.gateway.capture(orderId);

    expect(
      await h.as(h.visitor()).confirmDonationCheckout({
        ...started,
        paymentId: paid.paymentId,
        signature: paid.signature,
      })
    ).toEqual({ ok: true, status: "captured" });
    await h
      .as(h.visitor())
      .receiveGatewayWebhook(
        h.gateway.webhook({ type: "payment.captured", orderId })
      );
    await h.drain();

    expect(await receiptNumbers(h)).toEqual(["FOA-RCPT-2627-000001"]);
    expect(await postings(h)).toHaveLength(2);
  });

  it.each(["invalid", "missing"] as const)(
    "rejects a webhook with an %s signature and changes nothing",
    async (signature) => {
      const h = await createHarness();
      await openDonations(h);
      const started = await startedDonation(h);
      const orderId = await openedOrder(h, started);
      h.gateway.capture(orderId);
      const before = await snapshot(h);

      expect(
        await h
          .as(h.visitor())
          .receiveGatewayWebhook(
            h.gateway.webhook(
              { type: "payment.captured", orderId },
              { signature }
            )
          )
      ).toEqual({ ok: false, error: "rejected" });
      await h.drain();

      expect(await snapshot(h)).toEqual(before);
      expect((await donationRow(h, started.donationId)).status).toBe("pending");
    }
  );

  it("refuses a Checkout return whose signature isn't the gateway's", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    const paid = h.gateway.capture(orderId);

    expect(
      await h.as(h.visitor()).confirmDonationCheckout({
        ...started,
        paymentId: paid.paymentId,
        signature: "0".repeat(64),
      })
    ).toEqual({ ok: false, error: "invalid_signature" });
    expect(await receiptNumbers(h)).toEqual([]);
  });

  it("freezes the receipt as issued, the donor and FOA's facts as they were", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("org.legalName", "Friends of Animals Trust");

    await capturedDonation(h);

    const [issued] = await h.db.select().from(receipt);
    expect(issued!.snapshot).toMatchObject({
      number: "FOA-RCPT-2627-000001",
      fy: "2627",
      donor: { type: "individual", name: "Asha Rao", organisationName: null },
      amount: {
        minor: "50000",
        currency: "INR",
        inWords: "Rupees Five Hundred Only",
      },
      org: { legalName: "Friends of Animals Trust", address: null },
      taxExemption: null,
      noGoodsOrServices: true,
    });
  });
});

describe("a donation's checkout", () => {
  it("opens one order and reuses it when the page is opened again", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);

    const first = await openedOrder(h, started);
    const again = await openedOrder(h, started);

    expect(again).toBe(first);
    expect(h.gateway.orders).toHaveLength(1);
  });

  it("finds a payment no signal reported when the page is opened again", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    h.gateway.capture(orderId);

    expect(await h.as(h.visitor()).payForDonation(started)).toEqual({
      ok: true,
      kind: "settled",
      status: "captured",
    });
  });

  it("opens nothing with a wrong token or another donation's id", async () => {
    const h = await createHarness();
    await openDonations(h);
    const mine = await startedDonation(h);
    const theirs = await startedDonation(h, { email: "ravi@example.test" });

    for (const attempt of [
      { donationId: mine.donationId, checkoutToken: theirs.checkoutToken },
      { donationId: mine.donationId, checkoutToken: "x".repeat(43) },
      { donationId: mine.donationId, checkoutToken: "short" },
    ]) {
      expect(await h.as(h.visitor()).payForDonation(attempt)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await h.as(h.visitor()).getDonationOutcome(attempt)).toEqual({
        ok: false,
        error: "not_found",
      });
    }
    expect(h.gateway.orders).toEqual([]);
  });

  it("says nothing was charged when the gateway refuses the order, and lets the donor try again", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    h.gateway.refuseNextOrder();

    expect(await h.as(h.visitor()).payForDonation(started)).toEqual({
      ok: false,
      error: "gateway_unavailable",
    });
    expect(await openedOrder(h, started)).toEqual(expect.any(String));
  });
});
