import { createHash } from "node:crypto";
import { expect, it } from "vitest";

import { createHarness } from "@/test/harness";
import { seedAuctionResults } from "@/test/seed-auction-results";
import { SEED_AUCTIONS } from "@/server/seed/auctions";
import { gatewayWebhookEvent } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { signedInOfficer } from "../testing";
import { readZip } from "./read-zip";

it("exports auction capture timing and the financial outcome for the payer only, not the gateway identifiers or another payer's evidence", async () => {
  const h = await createHarness();
  await seedAuctionResults(h.deps);
  const buyer = h.as(await h.signIn(SEED_AUCTIONS.buyer));
  const other = h.as(await h.signIn(SEED_AUCTIONS.buyerMobile));
  const creator = h.as(await h.signIn(SEED_AUCTIONS.artist));
  const visitor = h.as(h.visitor());
  const worker = h.as({ kind: "system", process: "worker" });
  const officer = h.as((await signedInOfficer(h)).actor);
  const offer = (await buyer.getMyAuctionOffer({
    lotCode: SEED_AUCTIONS.paymentOffer,
  }))!;
  const otherOffer = (await other.getMyAuctionOffer({
    lotCode: SEED_AUCTIONS.paymentOfferMobile,
  }))!;
  const checkout = await buyer.openAuctionCheckout({ offerId: offer.id });
  const otherCheckout = await other.openAuctionCheckout({
    offerId: otherOffer.id,
  });
  if (!checkout.ok || !otherCheckout.ok) throw new Error("Checkout refused");
  expect(checkout.batchId).not.toBe(otherCheckout.batchId);

  const myTime = h.clock.now();
  const mine = h.gateway.capture(checkout.checkout.orderId);
  const signed = h.gateway.webhook({
    type: "payment.captured",
    orderId: checkout.checkout.orderId,
    capture: { paymentId: mine.paymentId, occurredBy: myTime },
  });
  const otherTime = new Date(+myTime + 1000);
  h.clock.set(otherTime);
  const theirs = h.gateway.capture(otherCheckout.checkout.orderId);
  const otherSigned = h.gateway.webhook({
    type: "payment.captured",
    orderId: otherCheckout.checkout.orderId,
    capture: { paymentId: theirs.paymentId, occurredBy: otherTime },
  });
  expect(await visitor.receiveGatewayWebhook(otherSigned)).toEqual({
    ok: true,
    outcome: "captured",
  });

  // A delayed signed event resolves the payer's timing review, so the
  // export must still convey the financial outcome as well as the evidence.
  h.clock.set(offer.expiresAt);
  await worker.expireAuctionOffer({ offerId: offer.id });
  expect(await visitor.receiveGatewayWebhook(signed)).toEqual({
    ok: true,
    outcome: "captured",
  });

  // Order identifiers are unique only within the gateway. This retained
  // historical technical event, without the matching gateway, is not ours.
  const foreignTime = new Date(+myTime + 2000);
  await h.db.insert(gatewayWebhookEvent).values({
    id: uuidv7(h.clock.now()),
    gateway: "razorpay",
    eventId: "historical-other-gateway-event",
    type: "payment.captured",
    orderId: checkout.checkout.orderId,
    capturePaymentFingerprint: "historical-other-gateway-fingerprint",
    captureOccurredBy: foreignTime,
    receivedAt: h.clock.now(),
  });

  async function exportAs(actor: typeof buyer) {
    const filed = await actor.submitPrivacyRequest({
      type: "access",
      subject: { kind: "self" },
    });
    if (!filed.ok) throw new Error("Request refused");
    expect(
      await officer.startPrivacyRequest({ id: filed.requestId })
    ).toMatchObject({ ok: true });
    expect(
      await officer.buildSubjectExport({ id: filed.requestId })
    ).toMatchObject({ ok: true });
    await h.drain();
    const link = await actor.getPrivacyExportLink({ id: filed.requestId });
    if (!link.ok) throw new Error("Export unavailable");
    const stored = await h.storage.get(link.url);
    if (!stored.ok) throw new Error(stored.error);
    return readZip(stored.bytes);
  }

  const ownZip = await exportAs(buyer);
  const data = JSON.parse(ownZip.text("data.json"));
  expect(data.sections.gateway_webhook_event).toEqual([
    { batch_id: checkout.batchId, capture_occurred_by: myTime.toISOString() },
  ]);
  expect(data.sections.payment_batch).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: checkout.batchId,
        amount_minor: offer.amountPaise.toString(),
        status: "captured",
      }),
    ])
  );
  expect(data.sections.payment_review_case).toEqual([
    expect.objectContaining({
      batch_id: checkout.batchId,
      reason: "auction_capture_time_unknown",
      outcome: "confirm",
      amount_minor: offer.amountPaise.toString(),
    }),
  ]);
  for (const secret of [
    checkout.checkout.orderId,
    mine.paymentId,
    createHash("sha256").update(mine.paymentId).digest("hex"),
    JSON.parse(signed.rawBody).id,
    otherCheckout.checkout.orderId,
    theirs.paymentId,
    createHash("sha256").update(theirs.paymentId).digest("hex"),
    otherCheckout.batchId,
    "historical-other-gateway-fingerprint",
  ])
    expect(ownZip.allText()).not.toContain(secret);

  const otherZip = await exportAs(other);
  expect(
    JSON.parse(otherZip.text("data.json")).sections.gateway_webhook_event
  ).toEqual([
    {
      batch_id: otherCheckout.batchId,
      capture_occurred_by: otherTime.toISOString(),
    },
  ]);
  expect(otherZip.allText()).not.toContain(checkout.batchId);
  const creatorZip = await exportAs(creator);
  expect(
    JSON.parse(creatorZip.text("data.json")).sections.gateway_webhook_event
  ).toBeUndefined();
  expect(creatorZip.allText()).not.toContain(checkout.batchId);
  expect(creatorZip.allText()).not.toContain(otherCheckout.batchId);
});
