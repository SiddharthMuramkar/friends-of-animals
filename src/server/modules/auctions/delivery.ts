import { hasExplicitAuctionShare } from "../consent/domain/auction-proceeds";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  auctionOffer,
  auctionLot,
  competition,
  paymentBatch,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { invalidInput } from "../../input";
import { auctionPolicyDocument } from "../consent/auction-policy";
import { hasUnsettledAuctionLots } from "./reservations";
import { lockOfferLot, type OfferInput } from "./checkout";
import {
  checkDeliveryAddress,
  type DeliveryAddress,
  type DeliveryAddressInput,
} from "./domain/delivery-address";
import {
  decideDeliveryTransition,
  type DeliveryCommand,
} from "./domain/delivery-status";
import {
  financialStartAllowed,
  lockFinancialStart,
} from "../privacy/requests/subject-data/financial-start";
export const AUCTION_ADDRESS_PURPOSE = "auction_offer.address";

export async function setAuctionProceedsPolicy(
  ctx: UseCaseContext,
  input: { competitionId: string; creatorShareBps: number }
) {
  const { role } = await authorize(ctx, "auction.proceeds.manage");
  const parsed = z
    .strictObject({
      competitionId: z.uuid(),
      creatorShareBps: z.int().min(0).max(10000),
    })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ share: competition.auctionCreatorShareBps })
      .from(competition)
      .where(eq(competition.id, input.competitionId))
      .for("no key update");
    if (!row) return { ok: false, error: "not_found" } as const;
    const document = await auctionPolicyDocument(tx, input.competitionId);
    if (
      !document?.permitted ||
      document.acknowledgedShare !== input.creatorShareBps
    )
      return { ok: false, error: "policy_document_mismatch" } as const;
    if (
      row.share !== input.creatorShareBps &&
      !hasExplicitAuctionShare(document.document.body)
    )
      return { ok: false, error: "policy_document_mismatch" } as const;
    if (row.share === input.creatorShareBps) return { ok: true } as const;
    if (await hasUnsettledAuctionLots(tx, input.competitionId))
      return { ok: false, error: "auction_active" } as const;
    await tx
      .update(competition)
      .set({
        auctionCreatorShareBps: input.creatorShareBps,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(competition.id, input.competitionId));
    await recordAudit(tx, ctx, {
      action: "competition.auction_proceeds_policy",
      entity: { type: "competition", id: input.competitionId },
      before: { creatorShareBps: row.share },
      after: { creatorShareBps: input.creatorShareBps },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
export async function listAuctionProceedsPolicies(ctx: UseCaseContext) {
  await authorize(ctx, "auction.proceeds.read");
  const rows = await ctx.db
    .select({
      competitionId: competition.id,
      name: competition.name,
      creatorShareBps: competition.auctionCreatorShareBps,
    })
    .from(competition)
    .where(eq(competition.auctionPermitted, true));
  return Promise.all(
    rows.map(async (row) => {
      const policy = await auctionPolicyDocument(ctx.db, row.competitionId);
      return {
        ...row,
        document: policy
          ? {
              version: policy.document.version,
              creatorShareBps: policy.acknowledgedShare,
            }
          : null,
      };
    })
  );
}
export function addressOf(
  ctx: Pick<UseCaseContext, "cipher">,
  ciphertext: string | null
): DeliveryAddress | null {
  return ciphertext
    ? (JSON.parse(
        ctx.cipher.decrypt(AUCTION_ADDRESS_PURPOSE, ciphertext)
      ) as DeliveryAddress)
    : null;
}
const addressInput = z.strictObject({
  recipientName: z.string().max(500),
  line1: z.string().max(500),
  line2: z.string().max(500).nullable().optional(),
  city: z.string().max(500),
  state: z.string().max(100),
  pincode: z.string().max(20),
});
export type SaveAuctionAddressInput = OfferInput & {
  address: DeliveryAddressInput;
};
export async function saveAuctionAddress(
  ctx: UseCaseContext,
  input: SaveAuctionAddressInput
) {
  const { role } = await authorize(ctx, "auction.checkout");
  const parsed = z
    .strictObject({ offerId: z.uuid(), address: addressInput })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const valid = checkDeliveryAddress(parsed.data.address);
  if (!valid.ok)
    return {
      ok: false,
      error: "invalid_address",
      errors: valid.errors,
    } as const;
  if (ctx.actor.kind !== "user") throw new Error("Missing buyer");
  const buyer = ctx.actor.userId;
  return ctx.db.transaction(async (tx) => {
    if (!(await lockFinancialStart(tx, buyer, ctx.clock.now())))
      return { ok: false, error: "not_found" } as const;
    const row = await lockOfferLot(tx, input.offerId);
    if (
      !row ||
      row.payerUserId !== buyer ||
      !(await financialStartAllowed(tx, buyer, row.offer.offeredAt)) ||
      row.offer.status !== "paid" ||
      !row.offer.deliveryStatus
    )
      return { ok: false, error: "not_found" } as const;
    const move = decideDeliveryTransition({
      from: row.offer.deliveryStatus,
      command: "save_address",
    });
    if (!move.ok) return move;
    await tx
      .update(auctionOffer)
      .set({
        deliveryStatus: move.to,
        addressCiphertext: ctx.cipher.encrypt(
          AUCTION_ADDRESS_PURPOSE,
          JSON.stringify(valid.address)
        ),
        deliveryUpdatedAt: ctx.clock.now(),
      })
      .where(eq(auctionOffer.id, row.offer.id));
    await recordAudit(tx, ctx, {
      action: "auction_delivery.address_saved",
      entity: { type: "auction_offer", id: row.offer.id },
      before: { status: row.offer.deliveryStatus },
      after: { status: move.to },
      actorRole: role,
    });
    return { ok: true, status: move.to } as const;
  });
}
const managerCommands = [
  "dispatch",
  "update_tracking",
  "mark_delivered",
  "record_receipt",
] as const;
const managerInput = z.strictObject({
  offerId: z.uuid(),
  command: z.enum(managerCommands),
  courier: z.string().trim().min(1).max(100).optional(),
  trackingNumber: z.string().trim().min(1).max(100).optional(),
});
export type MoveAuctionDeliveryInput = z.input<typeof managerInput>;
export async function moveAuctionDelivery(
  ctx: UseCaseContext,
  input: MoveAuctionDeliveryInput
) {
  await authorize(ctx, "auction.lot.manage");
  const parsed = managerInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (
    ["dispatch", "update_tracking"].includes(input.command) &&
    (!parsed.data.courier || !parsed.data.trackingNumber)
  )
    return { ok: false, error: "tracking_required" } as const;
  return moveDelivery(ctx, parsed.data, false, parsed.data.command);
}
export async function confirmAuctionReceipt(
  ctx: UseCaseContext,
  input: OfferInput
) {
  await authorize(ctx, "auction.checkout");
  const parsed = z.strictObject({ offerId: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return moveDelivery(ctx, input, true, "confirm_receipt");
}
async function moveDelivery(
  ctx: UseCaseContext,
  input: OfferInput & { courier?: string; trackingNumber?: string },
  buyer: boolean,
  command: DeliveryCommand
) {
  const { role } = await authorize(
    ctx,
    buyer ? "auction.checkout" : "auction.lot.manage"
  );
  return ctx.db.transaction(async (tx) => {
    const row = await lockOfferLot(tx, input.offerId);
    if (
      !row ||
      row.offer.status !== "paid" ||
      !row.offer.deliveryStatus ||
      (buyer &&
        (ctx.actor.kind !== "user" ||
          row.payerUserId !== ctx.actor.userId ||
          !(await financialStartAllowed(
            tx,
            ctx.actor.userId,
            row.offer.offeredAt
          ))))
    )
      return { ok: false, error: "not_found" } as const;
    const move = decideDeliveryTransition({
      from: row.offer.deliveryStatus,
      command,
    });
    if (!move.ok) return move;
    if (command === "dispatch" && !row.offer.addressCiphertext)
      return { ok: false, error: "address_required" } as const;
    const tracking = command === "dispatch" || command === "update_tracking";
    await tx
      .update(auctionOffer)
      .set({
        deliveryStatus: move.to,
        deliveryUpdatedAt: ctx.clock.now(),
        ...(tracking
          ? { courier: input.courier, trackingNumber: input.trackingNumber }
          : {}),
        ...(move.to === "receipt_confirmed" ? { addressCiphertext: null } : {}),
      })
      .where(eq(auctionOffer.id, row.offer.id));
    await recordAudit(tx, ctx, {
      action: `auction_delivery.${command}`,
      entity: { type: "auction_offer", id: row.offer.id },
      before: { status: row.offer.deliveryStatus },
      after: { status: move.to },
      actorRole: role,
    });
    return { ok: true, status: move.to } as const;
  });
}
export async function getAdminAuctionOffer(
  ctx: UseCaseContext,
  input: { lotId: string }
) {
  await authorize(ctx, "auction.lot.admin");
  if (!z.uuid().safeParse(input?.lotId).success) return null;
  const [row] = await ctx.db
    .select({ offer: auctionOffer, batchStatus: paymentBatch.status })
    .from(auctionOffer)
    .leftJoin(paymentBatch, eq(paymentBatch.id, auctionOffer.batchId))
    .innerJoin(auctionLot, eq(auctionLot.id, auctionOffer.lotId))
    .where(
      and(eq(auctionOffer.lotId, input.lotId), eq(auctionOffer.status, "paid"))
    );
  if (!row) return null;
  const { offer } = row;
  return {
    id: offer.id,
    amountPaise: offer.amountPaise,
    creatorShareBps: offer.creatorShareBps,
    deliveryStatus: offer.deliveryStatus,
    courier: offer.courier,
    trackingNumber: offer.trackingNumber,
    address: addressOf(ctx, offer.addressCiphertext),
    paidAt: offer.paidAt,
  };
}
