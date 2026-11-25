// A lot reserves the original through the custody module, under the same
// row lock as every other custody transition. Physical status describes
// the artwork's actual location/condition; auction lifecycle lives on its lot.
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  artworkCustodyEvent,
  artworkDiscrepancy,
  artworkReturnRequest,
  auctionLot,
  physicalArtwork,
} from "../../db/schema";
import type { AppDb } from "../../db/app-db";
import type { Actor } from "../../actor";
import type { Clock } from "../../ports/clock";
import { recordAudit } from "../../audit/record";
import { monotonicUuidv7 } from "../../ids";
import { ACTIVE_LOT_STATUSES } from "../auctions/domain/lot-status";
import {
  LISTABLE_ARTWORK_STATUSES,
  type ListableArtworkStatus,
} from "../auctions/domain/eligibility";

const nextId = monotonicUuidv7();

export async function artworkAuctionFacts(
  db: AppDb,
  artworkId: string,
  lock = false
) {
  const q = db
    .select()
    .from(physicalArtwork)
    .where(eq(physicalArtwork.id, artworkId));
  const [work] = lock ? await q.for("update") : await q;
  if (!work) return null;
  const [discrepancy] = await db
    .select({ id: artworkDiscrepancy.id })
    .from(artworkDiscrepancy)
    .where(
      and(
        eq(artworkDiscrepancy.artworkId, artworkId),
        isNull(artworkDiscrepancy.resolvedAt)
      )
    );
  const [request] = await db
    .select({ id: artworkReturnRequest.artworkId })
    .from(artworkReturnRequest)
    .where(
      and(
        eq(artworkReturnRequest.artworkId, artworkId),
        isNull(artworkReturnRequest.fulfilledAt)
      )
    );
  return {
    work,
    openDiscrepancy: !!discrepancy,
    openReturnRequest: !!request,
    inActiveLot: await isHeldForAuction(db, artworkId),
  };
}
export async function isHeldForAuction(db: AppDb, artworkId: string) {
  const [lot] = await db
    .select({ id: auctionLot.id })
    .from(auctionLot)
    .where(
      and(
        eq(auctionLot.artworkId, artworkId),
        inArray(auctionLot.status, ACTIVE_LOT_STATUSES)
      )
    )
    .limit(1);
  return !!lot;
}

/** Called within the transaction holding the artwork lock after creating the active lot. */
export async function recordAuctionReservation(
  db: AppDb,
  ctx: { actor: Actor; clock: Clock },
  artworkId: string,
  lotId: string,
  previous: ListableArtworkStatus
) {
  const facts = await artworkAuctionFacts(db, artworkId, true);
  if (
    !facts ||
    facts.work.status !== previous ||
    facts.openDiscrepancy ||
    facts.openReturnRequest ||
    !facts.inActiveLot
  )
    throw new Error("Artwork is not reserved for auction");
  await recordHoldEvent(db, ctx, facts.work, lotId, "auction_reserved");
}

/** Release and restore the prior custody state in the lot transition transaction.
 * A physical mutation cannot have occurred while the lot was active. */
export async function releaseFromAuction(
  db: AppDb,
  ctx: { actor: Actor; clock: Clock },
  input: { artworkId: string; lotId: string; restoreTo: string }
) {
  const facts = await artworkAuctionFacts(db, input.artworkId, true);
  if (
    !facts ||
    facts.inActiveLot ||
    !LISTABLE_ARTWORK_STATUSES.some((s) => s === input.restoreTo) ||
    facts.work.status !== input.restoreTo
  )
    throw new Error("Artwork auction reservation is inconsistent");
  await recordHoldEvent(db, ctx, facts.work, input.lotId, "auction_released");
}

async function recordHoldEvent(
  db: AppDb,
  ctx: { actor: Actor; clock: Clock },
  work: typeof physicalArtwork.$inferSelect,
  lotId: string,
  kind: "auction_reserved" | "auction_released"
) {
  const now = ctx.clock.now();
  await db.insert(artworkCustodyEvent).values({
    id: nextId(now),
    artworkId: work.id,
    kind,
    location: work.storageLocation,
    actorUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
    at: now,
  });
  await recordAudit(db, ctx, {
    action: "physical_artwork." + kind,
    entity: { type: "physical_artwork", id: work.id },
    before: { status: work.status },
    after: { status: work.status, lotId },
    actorRole: ctx.actor.kind === "user" ? "auction_manager" : null,
  });
}
