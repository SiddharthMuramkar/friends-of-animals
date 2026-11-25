import { and, eq, or } from "drizzle-orm";
import { authorize } from "../../access/can";
import {
  auctionOffer,
  auctionBid,
  auctionLot,
  paymentBatch,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { currentLotConsent } from "./lifecycle";
import { addressOf } from "./delivery";
import { parseLotCode } from "./domain/lot-code";

export async function getMyAuctionOffer(
  ctx: UseCaseContext,
  input: { lotCode: string }
) {
  await authorize(ctx, "auction.checkout");
  if (ctx.actor.kind !== "user" || typeof input?.lotCode !== "string")
    return null;
  const lotCode = parseLotCode(input.lotCode);
  if (!lotCode) return null;
  const [found] = await ctx.db
    .select({ offer: auctionOffer, lot: auctionLot })
    .from(auctionOffer)
    .leftJoin(auctionBid, eq(auctionBid.id, auctionOffer.bidId))
    .leftJoin(auctionLot, eq(auctionLot.id, auctionOffer.lotId))
    .leftJoin(paymentBatch, eq(paymentBatch.id, auctionOffer.batchId))
    .where(
      and(
        eq(auctionOffer.lotCode, lotCode),
        or(
          and(
            eq(auctionOffer.status, "open"),
            eq(auctionBid.bidderUserId, ctx.actor.userId)
          ),
          and(
            eq(auctionOffer.status, "paid"),
            eq(paymentBatch.payerUserId, ctx.actor.userId)
          )
        )
      )
    );
  if (!found) return null;
  const { offer, lot } = found;
  if (!(await financialStartAllowed(ctx.db, ctx.actor.userId, offer.offeredAt)))
    return null;
  if (
    offer.status === "open" &&
    (!lot ||
      lot.status !== "awaiting_payment" ||
      ctx.clock.now() >= offer.expiresAt ||
      !(await currentLotConsent(ctx, lot)) ||
      !(await ctx.settings.get("auctions.enabled")))
  )
    return null;
  const [batch] = offer.batchId
    ? await ctx.db
        .select({ status: paymentBatch.status })
        .from(paymentBatch)
        .where(eq(paymentBatch.id, offer.batchId))
    : [];
  return {
    id: offer.id,
    lotCode: offer.lotCode,
    amountPaise: offer.amountPaise,
    status: offer.status,
    expiresAt: offer.expiresAt,
    batchStatus: batch?.status ?? null,
    deliveryStatus: offer.deliveryStatus,
    courier: offer.courier,
    trackingNumber: offer.trackingNumber,
    address: addressOf(ctx, offer.addressCiphertext),
  };
}

import { z } from "zod";
import type { AppDb } from "../../db/app-db";
import { recordAudit } from "../../audit/record";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { lockBatch } from "../payments/batches";
import { syncBatch } from "../payments/sync-batch";
import {
  lockFinancialStart,
  financialStartAllowed,
} from "../privacy/requests/subject-data/financial-start";
import { isKnownMinor } from "../participants/known-minor";
import { readSetting } from "../settings/read";
import { isFallbackGateway } from "../../ports/payment-gateway-fallback";
import { answerTestCheckout } from "../payments/test-checkout";

const offerInput = z.strictObject({ offerId: z.uuid() });
export type OfferInput = z.input<typeof offerInput>;

/** Every writer reads the lot under its lock, then its offer. The common
 * payment funnel already holds the batch lock when it calls this helper. */
export async function lockOfferLot(tx: AppDb, offerId: string) {
  const [found] = await tx
    .select({ lotId: auctionOffer.lotId })
    .from(auctionOffer)
    .where(eq(auctionOffer.id, offerId));
  const [lot] = found?.lotId
    ? await tx
        .select()
        .from(auctionLot)
        .where(eq(auctionLot.id, found.lotId))
        .for("update")
    : [];
  const [offer] = await tx
    .select()
    .from(auctionOffer)
    .where(eq(auctionOffer.id, offerId))
    .for("update");
  const [bid] = offer?.bidId
    ? await tx.select().from(auctionBid).where(eq(auctionBid.id, offer.bidId))
    : [];
  const [payer] = offer?.batchId
    ? await tx
        .select({ id: paymentBatch.payerUserId })
        .from(paymentBatch)
        .where(eq(paymentBatch.id, offer.batchId))
    : [];
  return offer
    ? {
        offer,
        lot: lot ?? null,
        bid: bid ?? null,
        payerUserId: payer?.id ?? null,
      }
    : null;
}
export async function payableOffer(
  ctx: Pick<UseCaseContext, "db" | "cipher" | "clock">,
  found: Awaited<ReturnType<typeof lockOfferLot>>
) {
  if (
    !found?.lot ||
    !found.bid?.bidderUserId ||
    found.offer.status !== "open" ||
    found.lot.status !== "awaiting_payment"
  )
    return false;
  if (
    !(await currentLotConsent(ctx, found.lot, true)) ||
    !(await readSetting(ctx.db, "auctions.enabled", { lock: "share" }))
  )
    return false;
  const now = ctx.clock.now();
  return (
    now < found.offer.expiresAt &&
    (await financialStartAllowed(
      ctx.db,
      found.bid.bidderUserId,
      found.bid.placedAt
    )) &&
    !(await isKnownMinor(ctx.db, ctx.cipher, found.bid.bidderUserId, now))
  );
}
export async function openAuctionCheckout(
  ctx: UseCaseContext,
  input: OfferInput
) {
  const { role } = await authorize(ctx, "auction.checkout");
  const parsed = offerInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (ctx.actor.kind !== "user") throw new Error("Missing buyer");
  const buyerId = ctx.actor.userId;
  const batchId = await ctx.db.transaction(async (tx) => {
    if (!(await lockFinancialStart(tx, buyerId, ctx.clock.now()))) return null;
    const found = await lockOfferLot(tx, input.offerId);
    if (
      found?.bid?.bidderUserId !== buyerId ||
      !(await payableOffer({ ...ctx, db: tx }, found))
    )
      return null;
    if (found.offer.batchId) return found.offer.batchId;
    const now = ctx.clock.now(),
      id = uuidv7(now);
    await tx.insert(paymentBatch).values({
      id,
      purpose: "auction_sale",
      payerUserId: buyerId,
      status: "created",
      amountMinor: found.offer.amountPaise,
      gateway: ctx.payments.name,
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .update(auctionOffer)
      .set({ batchId: id })
      .where(eq(auctionOffer.id, found.offer.id));
    await recordAudit(tx, ctx, {
      action: "payment.batch_created",
      entity: { type: "payment_batch", id },
      before: null,
      after: {
        purpose: "auction_sale",
        offerId: found.offer.id,
        amountMinor: found.offer.amountPaise.toString(),
      },
      actorRole: role,
    });
    return id;
  });
  if (!batchId) return { ok: false, error: "not_payable" } as const;
  const [initial] = await ctx.db
    .select()
    .from(paymentBatch)
    .where(eq(paymentBatch.id, batchId));
  if (!initial || initial.gateway !== ctx.payments.name)
    return { ok: false, error: "gateway_unavailable" } as const;
  try {
    if (initial.status === "order_created") await syncBatch(ctx, batchId, role);
    let madeOrderId: string | null = null;
    if (initial.status === "created")
      ({ orderId: madeOrderId } = await ctx.payments.createOrder({
        amount: { amountMinor: initial.amountMinor, currency: "INR" },
        receipt: batchId,
        notes: { batchId, offerId: input.offerId },
      }));
    return ctx.db.transaction(async (tx) => {
      const batch = await lockBatch(tx, batchId);
      if (!batch) return { ok: false, error: "not_payable" } as const;
      // Store the order before rechecking eligibility: if it expires while
      // the adapter is returning, the common funnel can still see money.
      let orderId = batch.gatewayOrderId;
      if (batch.status === "created" && madeOrderId) {
        orderId = madeOrderId;
        await tx
          .update(paymentBatch)
          .set({
            status: "order_created",
            gatewayOrderId: orderId,
            updatedAt: ctx.clock.now(),
          })
          .where(eq(paymentBatch.id, batchId));
        await recordAudit(tx, ctx, {
          action: "payment.order_opened",
          entity: { type: "payment_batch", id: batchId },
          before: { status: "created" },
          after: { status: "order_created", gatewayOrderId: orderId },
          actorRole: role,
        });
      }
      const found = await lockOfferLot(tx, input.offerId);
      if (
        found?.bid?.bidderUserId !== buyerId ||
        !orderId ||
        !["created", "order_created"].includes(batch.status) ||
        !(await payableOffer({ ...ctx, db: tx }, found))
      )
        return { ok: false, error: "not_payable" } as const;
      return {
        ok: true,
        batchId,
        checkout: ctx.payments.checkout({
          orderId,
          amount: { amountMinor: batch.amountMinor, currency: "INR" },
          description: "FOA auction artwork",
        }),
      } as const;
    });
  } catch (error) {
    ctx.errors.report(error, {
      where: "auctions.checkout",
      extra: { batchId },
    });
    return { ok: false, error: "gateway_unavailable" } as const;
  }
}

async function ownOrder(ctx: UseCaseContext, id: string) {
  if (ctx.actor.kind !== "user") return null;
  const [row] = await ctx.db
    .select({ batch: paymentBatch, offer: auctionOffer })
    .from(auctionOffer)
    .innerJoin(auctionBid, eq(auctionBid.id, auctionOffer.bidId))
    .innerJoin(paymentBatch, eq(paymentBatch.id, auctionOffer.batchId))
    .where(
      and(
        eq(auctionOffer.id, id),
        eq(auctionBid.bidderUserId, ctx.actor.userId),
        eq(paymentBatch.payerUserId, ctx.actor.userId)
      )
    );
  return row?.batch.gateway === ctx.payments.name && row.batch.gatewayOrderId
    ? { ...row, orderId: row.batch.gatewayOrderId }
    : null;
}
export type ConfirmAuctionCheckoutInput = OfferInput & {
  paymentId: string;
  signature: string;
};
export async function confirmAuctionCheckout(
  ctx: UseCaseContext,
  input: ConfirmAuctionCheckoutInput
) {
  const { role } = await authorize(ctx, "auction.checkout");
  const parsed = offerInput
    .extend({
      paymentId: z.string().min(1).max(100),
      signature: z.string().min(1).max(200),
    })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const found = await ownOrder(ctx, input.offerId);
  if (
    !found ||
    !ctx.payments.verifyCheckout({
      orderId: found.orderId,
      paymentId: input.paymentId,
      signature: input.signature,
    })
  )
    return { ok: false, error: "invalid_signature" } as const;
  return {
    ok: true,
    outcome: await syncBatch(ctx, found.batch.id, role),
  } as const;
}
export type AuctionTestCheckoutInput = OfferInput & {
  outcome: "pay" | "decline";
};
export async function payAuctionTestCheckout(
  ctx: UseCaseContext,
  input: AuctionTestCheckoutInput
) {
  await authorize(ctx, "auction.checkout");
  const parsed = offerInput
    .extend({ outcome: z.enum(["pay", "decline"]) })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const gateway = ctx.payments;
  if (!isFallbackGateway(gateway))
    return { ok: false, error: "unavailable" } as const;
  const found = await ownOrder(ctx, input.offerId);
  if (
    !found ||
    found.batch.status !== "order_created" ||
    found.offer.status !== "open" ||
    ctx.clock.now() >= found.offer.expiresAt
  )
    return { ok: false, error: "not_payable" } as const;
  return answerTestCheckout(gateway, found.orderId, input.outcome);
}

export async function listMyAuctionOffers(ctx: UseCaseContext) {
  await authorize(ctx, "auction.checkout");
  if (ctx.actor.kind !== "user") return [];
  const rows = await ctx.db
    .select({ lotCode: auctionOffer.lotCode })
    .from(auctionOffer)
    .leftJoin(auctionBid, eq(auctionBid.id, auctionOffer.bidId))
    .leftJoin(paymentBatch, eq(paymentBatch.id, auctionOffer.batchId))
    .where(
      and(
        or(
          and(
            eq(auctionOffer.status, "open"),
            eq(auctionBid.bidderUserId, ctx.actor.userId)
          ),
          and(
            eq(auctionOffer.status, "paid"),
            eq(paymentBatch.payerUserId, ctx.actor.userId)
          )
        )
      )
    );
  const offers = await Promise.all(
    rows.map((row) => getMyAuctionOffer(ctx, row))
  );
  return offers.filter((o) => o !== null);
}
