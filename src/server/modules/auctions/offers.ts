import { and, eq, desc, isNotNull, gte } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import {
  auctionLot,
  auctionBid,
  auctionOffer,
  competition,
  physicalArtwork,
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
  const [comp] = await tx
    .select({ id: competition.id, share: competition.auctionCreatorShareBps })
    .from(competition)
    .innerJoin(
      physicalArtwork,
      eq(physicalArtwork.competitionId, competition.id)
    )
    .where(eq(physicalArtwork.id, lot.artworkId));
  if (!comp) throw new Error("Missing auction competition");
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
    competitionId: comp.id,
    status: "open",
    amountPaise: decision.amountPaise,
    creatorShareBps: comp.share,
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
      creatorShareBps: comp.share,
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

export async function expireAuctionOffer(
  ctx: LotContext,
  input: { offerId: string }
) {
  const { role } = await authorize(ctx, "auction.lot.run");
  const parsed = z.object({ offerId: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ lotId: auctionOffer.lotId })
      .from(auctionOffer)
      .where(eq(auctionOffer.id, input.offerId));
    if (!found?.lotId) return { ok: false, error: "not_found" } as const;
    const [lot] = await tx
      .select()
      .from(auctionLot)
      .where(eq(auctionLot.id, found.lotId))
      .for("update");
    const [offer] = await tx
      .select()
      .from(auctionOffer)
      .where(eq(auctionOffer.id, input.offerId));
    if (
      !lot ||
      !offer ||
      offer.status !== "open" ||
      lot.status !== "awaiting_payment"
    )
      return { ok: false, error: "not_open" } as const;
    if (ctx.clock.now() < offer.expiresAt)
      return { ok: false, error: "not_due" } as const;
    if (
      !(await currentLotConsent({ ...ctx, db: tx }, lot, true)) ||
      !(await readSetting(tx, "auctions.enabled"))
    )
      return applyMove(tx, ctx, lot, "withdraw_consent", role);
    await changeOffer(tx, ctx, offer, "window_passed", role);
    return awardLockedLot(tx, ctx, lot, role);
  });
}
