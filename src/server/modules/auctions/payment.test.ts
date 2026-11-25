import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { seedAuctionResults } from "@/test/seed-auction-results";
import { SEED_AUCTIONS } from "@/server/seed/auctions";
import { SEED_ACCOUNTS } from "@/server/seed/accounts";
import { signedInOfficer } from "../privacy/requests/testing";
import { readZip } from "../privacy/requests/subject-data/read-zip";
import { signInAs } from "../ledger/testing";
import { SEED_AUCTION_COMPETITION } from "@/server/seed/competitions";
import { SEED_GUARDIANS } from "@/server/seed/guardians";

describe("auction payment", () => {
  it("offers the winner an exclusive checkout and passes an expired offer to the next buyer", async () => {
    const h = await createHarness();
    await seedAuctionResults(h.deps);
    const first = h.as(await h.signIn(SEED_ACCOUNTS.members[2]));
    const next = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    const manager = h.as(await h.signIn(SEED_AUCTIONS.manager));
    const visitor = h.as(h.visitor());
    const code = { lotCode: SEED_AUCTIONS.open };
    const input = { ...code, declaredAdult: true, declarationVersion: "1" };
    expect(
      await next.placeBid({ ...input, amountPaise: 150000n })
    ).toMatchObject({ ok: true });
    expect(
      await first.placeBid({ ...input, amountPaise: 160000n })
    ).toMatchObject({ ok: true });
    h.clock.set((await visitor.getLot(code))!.closesAt);
    await h.drain();
    const lot = (await manager.listLotsForAdmin()).find(
      (l) => l.lotCode === code.lotCode
    )!;
    expect(lot.status).toBe("awaiting_payment");
    const offer = await first.getMyAuctionOffer(code);
    expect(offer).toMatchObject({ amountPaise: 160000n, status: "open" });
    expect(await next.getMyAuctionOffer(code)).toBeNull();
    expect(await first.listMyAuctionOffers()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: offer!.id })])
    );
    await expect(visitor.listMyAuctionOffers()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      first.expireAuctionOffer({ offerId: offer!.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(visitor.getMyAuctionOffer(code)).rejects.toMatchObject({
      code: "forbidden",
    });
    h.clock.set(offer!.expiresAt);
    await h.drain();
    expect(await next.getMyAuctionOffer(code)).toMatchObject({
      amountPaise: 150000n,
      status: "open",
    });
    expect(await first.getMyAuctionOffer(code)).toBeNull();
  });
});

describe("auction capture and delivery", () => {
  it("captures one sale, snapshots the policy, posts exact paise, and tracks receipt", async () => {
    const h = await createHarness();
    await seedAuctionResults(h.deps);
    const buyer = h.as(await h.signIn(SEED_ACCOUNTS.members[2]));
    const stranger = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    const manager = h.as(await h.signIn(SEED_AUCTIONS.manager));
    const financeStaff = await signInAs(h);
    let finance = h.as(financeStaff.actor);
    const visitor = h.as(h.visitor());
    const code = { lotCode: SEED_AUCTIONS.open };
    const competitionId = SEED_AUCTION_COMPETITION.id;
    expect(await finance.listAuctionProceedsPolicies()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ competitionId, creatorShareBps: 0 }),
      ])
    );
    await expect(buyer.listAuctionProceedsPolicies()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      buyer.setAuctionProceedsPolicy({ competitionId, creatorShareBps: 2500 })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await finance.setAuctionProceedsPolicy({
        competitionId,
        creatorShareBps: 2500,
      })
    ).toMatchObject({ ok: true });
    expect(
      await buyer.placeBid({
        ...code,
        amountPaise: 160101n,
        declaredAdult: true,
        declarationVersion: "1",
      })
    ).toMatchObject({ ok: true });
    h.clock.set((await visitor.getLot(code))!.closesAt);
    await h.drain();
    const offer = (await buyer.getMyAuctionOffer(code))!;
    expect(offer.amountPaise).toBe(160101n);
    finance = h.as(await h.signIn(financeStaff.user));
    expect(
      await finance.setAuctionProceedsPolicy({
        competitionId,
        creatorShareBps: 0,
      })
    ).toMatchObject({ ok: true });
    expect(
      await stranger.openAuctionCheckout({ offerId: offer.id })
    ).toMatchObject({ ok: false });
    await expect(
      visitor.openAuctionCheckout({ offerId: offer.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    const checkout = await buyer.openAuctionCheckout({ offerId: offer.id });
    if (!checkout.ok) throw new Error("Checkout refused");
    const paid = h.gateway.capture(checkout.checkout.orderId);
    const webhook = h.gateway.webhook({
      type: "payment.captured",
      orderId: checkout.checkout.orderId,
    });
    expect(await visitor.receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "captured",
    });
    expect(await visitor.receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "duplicate",
    });
    const confirm = {
      offerId: offer.id,
      paymentId: paid.paymentId,
      signature: paid.signature,
    };
    expect(await buyer.confirmAuctionCheckout(confirm)).toMatchObject({
      ok: true,
      outcome: "already_captured",
    });
    await expect(visitor.confirmAuctionCheckout(confirm)).rejects.toMatchObject(
      { code: "forbidden" }
    );
    expect(await stranger.confirmAuctionCheckout(confirm)).toMatchObject({
      ok: false,
      error: "invalid_signature",
    });
    expect(
      await buyer.payAuctionTestCheckout({ offerId: offer.id, outcome: "pay" })
    ).toMatchObject({ ok: false, error: "unavailable" });
    await expect(
      visitor.payAuctionTestCheckout({ offerId: offer.id, outcome: "pay" })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await buyer.getMyAuctionOffer(code)).toMatchObject({
      status: "paid",
      deliveryStatus: "awaiting_address",
    });
    const postings = await finance.listPostings({});
    if (!postings.ok) throw new Error("Ledger refused");
    const sales = postings.postings.filter(
      (p) => p.sourceType === "auction_sale"
    );
    expect(sales).toHaveLength(2);
    const sale = await finance.getPosting(
      sales.sort((a, b) => (a.seq > b.seq ? -1 : 1))[0]!.seq
    );
    if (!sale.ok) throw new Error("No sale ledger");
    expect(sale.posting.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountCode: "1100",
          debitMinor: 160101n,
          creditMinor: 0n,
        }),
        expect.objectContaining({
          accountCode: "4300",
          creditMinor: 120076n,
          debitMinor: 0n,
        }),
        expect.objectContaining({
          accountCode: "2200",
          creditMinor: 40025n,
          debitMinor: 0n,
        }),
      ])
    );
    const address = {
      recipientName: "Sample recipient",
      line1: "1 Fictional Street",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
    };
    expect(
      await stranger.saveAuctionAddress({ offerId: offer.id, address })
    ).toMatchObject({ ok: false });
    expect(
      await buyer.saveAuctionAddress({ offerId: offer.id, address })
    ).toMatchObject({ ok: true, status: "pending_dispatch" });
    await expect(
      buyer.moveAuctionDelivery({
        offerId: offer.id,
        command: "dispatch",
        courier: "Sample courier",
        trackingNumber: "FAKE-123",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await manager.moveAuctionDelivery({
        offerId: offer.id,
        command: "dispatch",
        courier: "Sample courier",
        trackingNumber: "FAKE-123",
      })
    ).toMatchObject({ ok: true, status: "dispatched" });
    expect(
      await manager.moveAuctionDelivery({
        offerId: offer.id,
        command: "mark_delivered",
      })
    ).toMatchObject({ ok: true, status: "delivered" });
    expect(
      await stranger.confirmAuctionReceipt({ offerId: offer.id })
    ).toMatchObject({ ok: false });
    expect(
      await buyer.confirmAuctionReceipt({ offerId: offer.id })
    ).toMatchObject({ ok: true, status: "receipt_confirmed" });
    await h.drain();
    const artist = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
    expect(
      (await artist.listInbox()).some((m) =>
        m.title.includes("Thank you for contributing")
      )
    ).toBe(true);
    const sold = (await manager.listLotsForAdmin()).find(
      (l) => l.lotCode === code.lotCode
    )!;
    expect(sold.status).toBe("sold");
    expect(
      await manager.getAdminAuctionOffer({ lotId: sold.id })
    ).toMatchObject({ deliveryStatus: "receipt_confirmed", address: null });
    await expect(
      buyer.getAdminAuctionOffer({ lotId: sold.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (await manager.listEligibleArtwork()).some(
        (a) => a.artworkId === sold.artworkId
      )
    ).toBe(false);
  });
});

describe("auction review and privacy", () => {
  it("never sells on a late capture, returns review money and relists after the last offer", async () => {
    const h = await createHarness();
    await seedAuctionResults(h.deps);
    const buyer = h.as(await h.signIn(SEED_AUCTIONS.buyer));
    const visitor = h.as(h.visitor());
    const manager = h.as(await h.signIn(SEED_AUCTIONS.manager));
    const code = { lotCode: SEED_AUCTIONS.paymentOffer };
    const offer = (await buyer.getMyAuctionOffer(code))!;
    const checkout = await buyer.openAuctionCheckout({ offerId: offer.id });
    if (!checkout.ok) throw new Error("Cannot open checkout");
    h.clock.set(offer.expiresAt);
    await h.drain();
    h.gateway.capture(checkout.checkout.orderId);
    const webhook = h.gateway.webhook({
      type: "payment.captured",
      orderId: checkout.checkout.orderId,
    });
    expect(await visitor.receiveGatewayWebhook(webhook)).toMatchObject({
      ok: true,
      outcome: "needs_review",
    });
    expect(await visitor.receiveGatewayWebhook(webhook)).toMatchObject({
      ok: true,
      outcome: "duplicate",
    });
    expect(
      (await manager.listLotsForAdmin()).find((l) => l.lotCode === code.lotCode)
        ?.status
    ).toBe("relisted");
    const finance = h.as((await signInAs(h)).actor);
    const cases = await finance.listPaymentReviewCases({ state: "open" });
    if (!cases.ok) throw new Error("Review list unavailable");
    const review = cases.cases.find((c) => c.batchId === checkout.batchId)!;
    expect(review.purpose).toBe("auction_sale");
    expect(
      await finance.resolvePaymentReviewCase({
        caseId: review.id,
        outcome: "confirm",
        reason: "The old offer has expired",
      })
    ).toMatchObject({ ok: false, error: "outcome_not_allowed" });
    expect(
      await finance.resolvePaymentReviewCase({
        caseId: review.id,
        outcome: "refund",
        reason: "The offer expired before capture",
      })
    ).toMatchObject({ ok: true });
    await h.drain();
    const returned = await finance.listRefunds({ state: "done" });
    if (!returned.ok) throw new Error("Refund queue inaccessible");
    await expect(buyer.listRefunds({ state: "done" })).rejects.toMatchObject({
      code: "forbidden",
    });
    const returnedOffer = returned.refunds.find(
      (r) => r.batchId === checkout.batchId
    )!;
    expect(returnedOffer).toMatchObject({
      auctionLotCode: code.lotCode,
      status: "refunded",
    });
    expect(
      await finance.getRefund({ refundId: returnedOffer.id })
    ).toMatchObject({
      ok: true,
      refund: { auctionLotCode: code.lotCode, status: "refunded" },
    });
    const ledger = await finance.listPostings({});
    if (!ledger.ok) throw new Error("No ledger");
    const liability = ledger.postings.find(
      (p) => p.sourceType === "auction_review"
    )!;
    expect(liability).toBeDefined();
    const original = await finance.getPosting(liability.seq);
    if (!original.ok) throw new Error("No original review posting");
    expect(original.posting.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "2210", creditMinor: 160101n }),
      ])
    );
    const reversal = ledger.postings.find(
      (p) => p.description === "Auction review payment returned"
    )!;
    expect(reversal).toBeDefined();
    const reversed = await finance.getPosting(reversal.seq);
    if (!reversed.ok) throw new Error("No reversal");
    expect(reversed.posting.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "2210", debitMinor: 160101n }),
      ])
    );
  });
});

it("keeps delivered sale accounting after either subject erases their data, without exposing buyer delivery fields to the creator", async () => {
  const h = await createHarness();
  await seedAuctionResults(h.deps);
  await h.settings.set("privacy.erasureEnabled", true);
  const buyer = h.as(await h.signIn(SEED_AUCTIONS.buyer));
  const creator = h.as(await h.signIn(SEED_AUCTIONS.artist));
  const officer = h.as((await signedInOfficer(h)).actor);
  const finance = h.as((await signInAs(h)).actor);
  const code = { lotCode: SEED_AUCTIONS.paid };
  const sale = (await buyer.getMyAuctionOffer(code))!;
  expect(sale.status).toBe("paid");
  async function exportAs(actor: typeof buyer) {
    const request = await actor.submitPrivacyRequest({
      type: "access",
      subject: { kind: "self" },
    });
    if (!request.ok) throw new Error("Request refused");
    expect(
      await officer.startPrivacyRequest({ id: request.requestId })
    ).toMatchObject({ ok: true });
    expect(
      await officer.buildSubjectExport({ id: request.requestId })
    ).toMatchObject({ ok: true });
    await h.drain();
    const link = await actor.getPrivacyExportLink({ id: request.requestId });
    if (!link.ok) throw new Error("Export unavailable");
    const bytes = await h.storage.get(link.url);
    if (!bytes.ok) throw new Error("Export unreadable");
    return JSON.parse(readZip(bytes.bytes).text("data.json")).sections
      .auction_offer as Record<string, unknown>[];
  }
  const buyerRows = await exportAs(buyer);
  expect(buyerRows.find((row) => row.id === sale.id)).toMatchObject({
    amount_paise: "160101",
    status: "paid",
    batch_id: expect.any(String),
  });
  const creatorRows = await exportAs(creator);
  const exported = creatorRows.find((row) => row.id === sale.id)!;
  expect(exported).toMatchObject({
    amount_paise: "160101",
    creator_share_bps: 2500,
  });
  for (const privateField of [
    "bid_id",
    "batch_id",
    "address",
    "courier",
    "tracking_number",
  ])
    expect(exported).not.toHaveProperty(privateField);
  async function erase(actor: typeof buyer) {
    const request = await actor.submitPrivacyRequest({
      type: "erasure",
      subject: { kind: "self" },
    });
    if (!request.ok) throw new Error("Erasure request refused");
    expect(
      await officer.startPrivacyRequest({ id: request.requestId })
    ).toMatchObject({ ok: true });
    const preview = await officer.previewErasure({ id: request.requestId });
    if (!preview.ok) throw new Error("Erasure plan refused");
    expect(
      await officer.executeErasure({
        id: request.requestId,
        fingerprint: preview.preview.plan.fingerprint,
      })
    ).toMatchObject({ ok: true });
    await h.drain();
  }
  await erase(creator);
  expect(await buyer.getMyAuctionOffer(code)).toMatchObject({
    status: "paid",
    deliveryStatus: "receipt_confirmed",
  });
  await erase(buyer);
  expect(await buyer.getMyAuctionOffer(code)).toBeNull();
  const ledger = await finance.listPostings({});
  if (!ledger.ok) throw new Error("Ledger unavailable");
  expect(
    ledger.postings.filter((p) => p.sourceType === "auction_sale")
  ).toHaveLength(1);
});

it("reviews wrong-currency and mismatched captures and extra money without selling twice", async () => {
  const h = await createHarness();
  await seedAuctionResults(h.deps);
  const visitor = h.as(h.visitor());
  const buyer = h.as(await h.signIn(SEED_AUCTIONS.buyer));
  const other = h.as(await h.signIn(SEED_AUCTIONS.buyerMobile));
  const finance = h.as((await signInAs(h)).actor);
  const code = { lotCode: SEED_AUCTIONS.paymentOffer },
    otherCode = { lotCode: SEED_AUCTIONS.paymentOfferMobile };
  const offer = (await buyer.getMyAuctionOffer(code))!,
    secondOffer = (await other.getMyAuctionOffer(otherCode))!;
  const order = await buyer.openAuctionCheckout({ offerId: offer.id }),
    secondOrder = await other.openAuctionCheckout({ offerId: secondOffer.id });
  if (!order.ok || !secondOrder.ok) throw new Error("Checkout refused");
  h.gateway.capture(order.checkout.orderId, {
    amount: { amountMinor: 500n, currency: "USD" },
  });
  h.gateway.capture(order.checkout.orderId, {
    amount: { amountMinor: 100n, currency: "INR" },
  });
  expect(
    await visitor.receiveGatewayWebhook(
      h.gateway.webhook({
        type: "payment.captured",
        orderId: order.checkout.orderId,
      })
    )
  ).toMatchObject({ ok: true, outcome: "needs_review" });
  expect(await buyer.getMyAuctionOffer(code)).toMatchObject({
    status: "open",
    batchStatus: "needs_review",
  });
  h.gateway.capture(secondOrder.checkout.orderId);
  expect(
    await visitor.receiveGatewayWebhook(
      h.gateway.webhook({
        type: "payment.captured",
        orderId: secondOrder.checkout.orderId,
      })
    )
  ).toMatchObject({ ok: true, outcome: "captured" });
  h.gateway.capture(secondOrder.checkout.orderId);
  expect(
    await visitor.receiveGatewayWebhook(
      h.gateway.webhook({
        type: "payment.captured",
        orderId: secondOrder.checkout.orderId,
      })
    )
  ).toMatchObject({ ok: true, outcome: "needs_review" });
  expect(await other.getMyAuctionOffer(otherCode)).toMatchObject({
    status: "paid",
    batchStatus: "captured",
  });
  const reviewed = await finance.listPaymentReviewCases({ state: "open" });
  if (!reviewed.ok) throw new Error("Review denied");
  expect(reviewed.cases.filter((c) => c.batchId === order.batchId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ currency: "USD", reason: "amount_mismatch" }),
      expect.objectContaining({
        currency: "INR",
        amountMinor: 100n,
        reason: "amount_mismatch",
      }),
    ])
  );
  expect(
    reviewed.cases.filter((c) => c.batchId === secondOrder.batchId)
  ).toEqual([
    expect.objectContaining({ reason: "already_paid", amountMinor: 160101n }),
  ]);
  const ledger = await finance.listPostings({});
  if (!ledger.ok) throw new Error("Ledger denied");
  expect(
    ledger.postings.filter((p) => p.sourceType === "auction_sale")
  ).toHaveLength(2);
  expect(
    ledger.postings.filter((p) => p.sourceType === "auction_review")
  ).toHaveLength(2);
});
