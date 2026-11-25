import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { auctionBid, auctionLot, user } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { MAX_PAISE } from "../competitions/domain/fees";
import { lockFinancialStart } from "../privacy/requests/subject-data/financial-start";
import { isKnownMinor } from "../participants/known-minor";
import { readSetting } from "../settings/read";
import { decideBid } from "./domain/bid-rules";
import { parseLotCode } from "./domain/lot-code";
import { emit } from "../../outbox";
import { highestBid } from "./bid-history";
import { currentLotConsent } from "./lifecycle";

import { BID_DECLARATION_VERSION } from "./domain/bid-declaration";

const bidInput = z.strictObject({
  lotCode: z.string().max(32),
  amountPaise: z.bigint().positive().max(MAX_PAISE),
  declaredAdult: z.boolean(),
  declarationVersion: z.string().max(20),
});
export type PlaceBidInput = z.input<typeof bidInput>;

/** A bid, its price, audit and closing-time extension commit together. The
 * row lock serializes acceptance with every other bid and the close job.
 * The clock is read after acquiring the lock, not when a request arrived. */
export async function placeBid(ctx: UseCaseContext, input: PlaceBidInput) {
  const { role } = await authorize(ctx, "auction.bid.place");
  const parsed = bidInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const lotCode = parseLotCode(parsed.data.lotCode);
  if (!lotCode) return { ok: false, error: "not_found" } as const;
  if (ctx.actor.kind !== "user") throw new Error("Missing bidder");
  const bidderUserId = ctx.actor.userId;
  const startedAt = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    if (!(await lockFinancialStart(tx, bidderUserId, startedAt)))
      return { ok: false, error: "bidder_unavailable" } as const;
    const [bidder] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, bidderUserId))
      .for("no key update");
    if (!bidder) return { ok: false, error: "not_found" } as const;
    const [lot] = await tx
      .select()
      .from(auctionLot)
      .where(eq(auctionLot.lotCode, lotCode))
      .for("update");
    if (!lot) return { ok: false, error: "not_found" } as const;
    if (!(await readSetting(tx, "auctions.enabled", { lock: "share" })))
      return { ok: false, error: "auctions_disabled" } as const;
    if (await isKnownMinor(tx, ctx.cipher, bidderUserId, ctx.clock.now()))
      return { ok: false, error: "minor" } as const;
    if (
      !parsed.data.declaredAdult ||
      parsed.data.declarationVersion !== BID_DECLARATION_VERSION
    )
      return { ok: false, error: "declaration_required" } as const;
    if (!(await currentLotConsent({ ...ctx, db: tx }, lot, true)))
      return { ok: false, error: "auction_consent_missing" } as const;
    const previous = await highestBid(tx, lot.id);
    const rules = {
      minIncrementPaise: BigInt(
        await readSetting(tx, "auctions.minIncrementPaise", { lock: "share" })
      ),
      antiSnipingWindowMinutes: await readSetting(
        tx,
        "auctions.antiSnipingWindowMinutes",
        { lock: "share" }
      ),
    };
    const placedAt = ctx.clock.now();
    const decision = decideBid({
      lot: {
        ...lot,
        currentBidPaise: previous?.amountPaise ?? null,
        currentBidderUserId: previous?.bidderUserId ?? null,
      },
      bidderUserId,
      amountPaise: parsed.data.amountPaise,
      placedAt,
      rules,
    });
    if (!decision.ok)
      return "minimumPaise" in decision
        ? ({
            ok: false,
            error: decision.reason,
            minimumPaise: decision.minimumPaise,
          } as const)
        : ({ ok: false, error: decision.reason } as const);
    const bidId = uuidv7(placedAt);
    await tx.insert(auctionBid).values({
      id: bidId,
      lotId: lot.id,
      bidderUserId,
      amountPaise: parsed.data.amountPaise,
      declarationVersion: BID_DECLARATION_VERSION,
      placedAt,
    });
    await tx
      .update(auctionLot)
      .set({ closesAt: decision.next.closesAt, updatedAt: placedAt })
      .where(and(eq(auctionLot.id, lot.id), eq(auctionLot.status, "open")));
    await recordAudit(tx, ctx, {
      action: "auction_bid.placed",
      entity: { type: "auction_bid", id: bidId },
      before: null,
      after: {
        amountPaise: parsed.data.amountPaise.toString(),
        lotId: lot.id,
        closesAt: decision.next.closesAt.toISOString(),
      },
      actorRole: role,
    });
    if (decision.outbidUserId && previous) {
      await emit(tx, ctx.clock, {
        type: "auction.bid_outbid",
        aggregate: { type: "auction_bid", id: bidId },
        payload: { previousBidId: previous.id, lotCode: lot.lotCode },
      });
    }
    return {
      ok: true,
      amountPaise: parsed.data.amountPaise,
      closesAt: decision.next.closesAt,
      extended: decision.extended,
    } as const;
  });
}
