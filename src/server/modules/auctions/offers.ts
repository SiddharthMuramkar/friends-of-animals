import { and, eq, desc, isNotNull, gte, gt } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import {
  auctionLot,
  auctionBid,
  auctionOffer,
  physicalArtwork,
  paymentBatch,
  outbox,
  type AuctionLotRow,
} from "../../db/schema";
import { emit } from "../../outbox/emit";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { financialStartAllowed } from "../privacy/requests/subject-data/financial-start";
import { isKnownMinor } from "../participants/known-minor";
import { readSetting } from "../settings/read";
import { decideAward } from "./domain/award";
import {
  offerExpiresAt,
  decideOfferTransition,
  type OfferEvent,
} from "./domain/payment-offer";
import { captureSignalIds } from "../payments/capture-evidence";
import { lockBatch } from "../payments/batches";
import { lockOfferLot } from "./checkout";
import { hasUnadjudicatedAuctionCapture, syncAuctionBatch } from "./payments";
import type { UseCaseContext } from "../../use-cases";
import { currentLotConsent, applyMove, type LotContext } from "./lifecycle";

export async function changeOffer(
  tx: AppDb,
  ctx: Pick<LotContext, "actor" | "clock">,
  row: typeof auctionOffer.$inferSelect,
  event: OfferEvent,
  role: Role | null
) {
  const move = decideOfferTransition({ from: row.status, event });
  if (!move.ok) throw new Error("Invalid auction offer transition");
  const now = ctx.clock.now();
  await tx
    .update(auctionOffer)
    .set({
      status: move.to,
      ...(event === "captured"
        ? {
            paidAt: now,
            deliveryStatus: "awaiting_address" as const,
            deliveryUpdatedAt: now,
          }
        : {}),
    })
    .where(eq(auctionOffer.id, row.id));
  await recordAudit(tx, ctx, {
    action: `auction_offer.${move.to}`,
    entity: { type: "auction_offer", id: row.id },
    before: { status: row.status },
    after: { status: move.to },
    actorRole: role,
  });
}

/** Lot lock, never an existing payment batch lock. A batch remains readable
 * by the common funnel even when its offer expires or is superseded. */
export async function awardLockedLot(
  tx: AppDb,
  ctx: LotContext,
  lot: AuctionLotRow,
  role: Role | null
) {
  const bids = await tx
    .select()
    .from(auctionBid)
    .where(
      and(
        eq(auctionBid.lotId, lot.id),
        isNotNull(auctionBid.bidderUserId),
        gte(auctionBid.amountPaise, lot.reservePricePaise)
      )
    )
    .orderBy(desc(auctionBid.amountPaise));
  const prior = await tx
    .select({
      status: auctionOffer.status,
      bidderUserId: auctionBid.bidderUserId,
    })
    .from(auctionOffer)
    .leftJoin(auctionBid, eq(auctionBid.id, auctionOffer.bidId))
    .where(eq(auctionOffer.lotId, lot.id));
  const eligible = [];
  for (const bid of bids) {
    const userId = bid.bidderUserId!;
    if (
      (await financialStartAllowed(tx, userId, bid.placedAt)) &&
      !(await isKnownMinor(tx, ctx.cipher, userId, ctx.clock.now()))
    )
      eligible.push({
        bidId: bid.id,
        bidderUserId: userId,
        amountPaise: bid.amountPaise,
        placedAt: bid.placedAt,
      });
  }
  const decision = decideAward({
    bids: eligible,
    reservePaise: lot.reservePricePaise,
    priorOffers: prior.map((row, i) => ({
      status: row.status,
      bidderUserId: row.bidderUserId ?? `erased-${i}`,
    })),
    maxOffers: await readSetting(tx, "auctions.maxPaymentOffers"),
  });
  if (decision.kind === "keep")
    return { ok: true, status: lot.status } as const;
  if (decision.kind !== "offer")
    return applyMove(
      tx,
      ctx,
      lot,
      decision.kind === "relist" ? "relist" : "settle_unsold",
      role
    );
  const consent = await currentLotConsent({ ...ctx, db: tx }, lot, true);
  if (!consent) return applyMove(tx, ctx, lot, "withdraw_consent", role);
  const [artwork] = await tx
    .select({ competitionId: physicalArtwork.competitionId })
    .from(physicalArtwork)
    .where(eq(physicalArtwork.id, lot.artworkId));
  if (!artwork) throw new Error("Missing auction competition");
  const now = ctx.clock.now(),
    id = uuidv7(now),
    expiresAt = offerExpiresAt(
      now,
      await readSetting(tx, "auctions.paymentWindowHours")
    );
  await tx.insert(auctionOffer).values({
    id,
    lotId: lot.id,
    bidId: decision.bidId,
    lotCode: lot.lotCode,
    competitionId: artwork.competitionId,
    status: "open",
    amountPaise: decision.amountPaise,
    creatorShareBps: consent.creatorShareBps,
    offeredAt: now,
    expiresAt,
  });
  await recordAudit(tx, ctx, {
    action: "auction_offer.opened",
    entity: { type: "auction_offer", id },
    before: null,
    after: {
      lotId: lot.id,
      amountPaise: decision.amountPaise.toString(),
      expiresAt: expiresAt.toISOString(),
      creatorShareBps: consent.creatorShareBps,
    },
    actorRole: role,
  });
  const aggregate = { type: "auction_offer" as const, id },
    payload = { offerId: id };
  await emit(tx, ctx.clock, {
    type: "auction.offer_opened",
    aggregate,
    payload,
  });
  await emit(
    tx,
    ctx.clock,
    { type: "auction.offer.expire", aggregate, payload },
    { availableAt: expiresAt }
  );
  return applyMove(tx, ctx, lot, "offer_payment", role);
}

/** Fetch provider truth outside the transaction, then serialize settlement
 * with the same batch → lot lock order as every capture. If checkout
 * attached an order while the read was in flight, reobserve that order. */
export async function expireAuctionOffer(
  ctx: LotContext & Pick<UseCaseContext, "payments">,
  input: { offerId: string }
) {
  const { role } = await authorize(ctx, "auction.lot.run");
  const parsed = z.object({ offerId: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  for (;;) {
    const [hint] = await ctx.db
      .select({ offer: auctionOffer, batch: paymentBatch })
      .from(auctionOffer)
      .leftJoin(paymentBatch, eq(paymentBatch.id, auctionOffer.batchId))
      .where(eq(auctionOffer.id, input.offerId));
    if (!hint) return { ok: false, error: "not_found" } as const;
    if (hint.offer.status !== "open")
      return { ok: false, error: "not_open" } as const;
    if (ctx.clock.now() < hint.offer.expiresAt)
      return { ok: false, error: "not_due" } as const;
    const orderId = hint.batch?.gatewayOrderId;
    if (orderId && hint.batch?.gateway !== ctx.payments.name)
      throw new Error(
        "Cannot reconcile auction offer with its original gateway"
      );
    const signals = new Set(
      hint.batch ? await captureSignalIds(ctx.db, hint.batch) : []
    );
    const payments = orderId
      ? await ctx.payments.fetchOrderPayments(orderId)
      : [];
    const observedAt = ctx.clock.now();
    const result = await ctx.db.transaction(async (tx) => {
      const batch = hint.offer.batchId
        ? await lockBatch(tx, hint.offer.batchId)
        : null;
      const found = await lockOfferLot(tx, input.offerId);
      if (
        !found?.lot ||
        found.offer.status !== "open" ||
        found.lot.status !== "awaiting_payment"
      )
        return { ok: false, error: "not_open" } as const;
      if (
        found.offer.batchId !== hint.offer.batchId ||
        (found.offer.batchId && !batch) ||
        batch?.gatewayOrderId !== hint.batch?.gatewayOrderId ||
        batch?.gateway !== hint.batch?.gateway
      )
        return "reobserve" as const;
      if (ctx.clock.now() < found.offer.expiresAt)
        return { ok: false, error: "not_due" } as const;
      const { lot, offer } = found;
      if (batch && orderId) {
        const outcome = await syncAuctionBatch(
          tx,
          ctx,
          batch,
          payments,
          role,
          observedAt
        );
        if (outcome === "captured" || outcome === "already_captured")
          return { ok: true, status: "sold" } as const;
      }
      if (
        !(await currentLotConsent({ ...ctx, db: tx }, lot, true)) ||
        !(await readSetting(tx, "auctions.enabled"))
      )
        return applyMove(tx, ctx, lot, "withdraw_consent", role);
      if (batch && (await hasUnadjudicatedAuctionCapture(tx, batch.id))) {
        // A review and future signed evidence can resolve this hold. Keep
        // one scheduled recheck for a delayed refund/event, never retry a
        // failing provider inside a transaction or award elsewhere blindly.
        const [pending] = await tx
          .select({ id: outbox.id })
          .from(outbox)
          .where(
            and(
              eq(outbox.eventType, "auction.offer.expire"),
              eq(outbox.aggregateId, offer.id),
              eq(outbox.status, "pending"),
              gt(outbox.availableAt, ctx.clock.now())
            )
          )
          .limit(1);
        if (!pending)
          await emit(
            tx,
            ctx.clock,
            {
              type: "auction.offer.expire",
              aggregate: { type: "auction_offer", id: offer.id },
              payload: { offerId: offer.id },
            },
            { availableAt: new Date(+ctx.clock.now() + 3600000) }
          );
        return { ok: true, status: "awaiting_payment" } as const;
      }
      if (
        batch &&
        (await captureSignalIds(tx, batch)).some((id) => !signals.has(id))
      )
        return "reobserve" as const;
      await changeOffer(tx, ctx, offer, "window_passed", role);
      return awardLockedLot(tx, ctx, lot, role);
    });
    if (result !== "reobserve") return result;
  }
}
