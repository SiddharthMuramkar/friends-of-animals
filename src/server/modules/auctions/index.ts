import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  auctionLot,
  competition,
  entry,
  physicalArtwork,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { withUniqueCode } from "../codes/codes";
import { auctionConsentCredit } from "../consent/auction-credit";
import {
  artworkAuctionFacts,
  recordAuctionReservation,
} from "../physical-artwork/auction-hold";
import {
  assessLotEligibility,
  LISTABLE_ARTWORK_STATUSES,
  type ListableArtworkStatus,
} from "./domain/eligibility";
import { lotCodeFormat } from "./domain/lot-code";
import { validateLotTerms } from "./domain/lot-terms";
import {
  scheduleLot,
  cancelLot,
  openLot,
  closeLot,
  settleClosedLot,
  type LotInput,
  type CancelLotInput,
} from "./lifecycle";
import { browseLots, getLot, listLotsForAdmin, getLotForAdmin } from "./read";
import { emit } from "../../outbox";

export const createLotInput = z.object({
  artworkId: z.uuid(),
  story: z.string().trim().min(1).max(2000),
  basePricePaise: z.bigint(),
  reservePricePaise: z.bigint(),
  opensAt: z.date(),
  closesAt: z.date(),
});
export type CreateLotInput = z.input<typeof createLotInput>;

async function eligibility(
  ctx: Pick<UseCaseContext, "db" | "cipher" | "clock">,
  artworkId: string,
  lock = false
) {
  const facts = await artworkAuctionFacts(ctx.db, artworkId, lock);
  if (!facts) return null;
  const [comp] = await ctx.db
    .select({ auctionPermitted: competition.auctionPermitted })
    .from(competition)
    .where(eq(competition.id, facts.work.competitionId));
  const consent = await auctionConsentCredit(
    ctx,
    facts.work.registrationId,
    lock && !facts.inActiveLot
  );
  const eligibility = assessLotEligibility({
    artworkStatus: facts.work.status,
    openDiscrepancy: facts.openDiscrepancy,
    openReturnRequest: facts.openReturnRequest,
    inActiveLot: facts.inActiveLot,
    competitionAllowsAuction: !!comp?.auctionPermitted,
    creatorIsMinor: consent?.minor ?? false,
    auctionConsent: consent
      ? {
          state: "given",
          by: consent.minor ? "guardian" : "creator",
          guardianVerified: true,
        }
      : { state: "none" },
  });
  return { ...facts, consent, eligibility };
}

async function createLot(ctx: UseCaseContext, input: CreateLotInput) {
  const { role } = await authorize(ctx, "auction.lot.manage");
  const parsed = createLotInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { artworkId, story, ...terms } = parsed.data;
  const valid = validateLotTerms(terms, ctx.clock.now());
  if (!valid.ok)
    return { ok: false, error: "invalid_terms", errors: valid.errors } as const;
  return ctx.db.transaction(async (tx) => {
    const facts = await eligibility({ ...ctx, db: tx }, artworkId, true);
    if (!facts) return { ok: false, error: "not_found" } as const;
    if (!facts.eligibility.eligible)
      return {
        ok: false,
        error: "ineligible",
        reasons: facts.eligibility.reasons,
      } as const;
    if (!facts.consent) throw new Error("Auction consent not resolved");
    const now = ctx.clock.now(),
      id = uuidv7(now);
    const previous = facts.work.status as ListableArtworkStatus;
    const lotCode = await withUniqueCode(
      { format: lotCodeFormat(now), constraint: "auction_lot_lot_code_unique" },
      (lotCode) =>
        tx.transaction(async (savepoint) => {
          await savepoint.insert(auctionLot).values({
            id,
            lotCode,
            artworkId,
            artworkStatusBeforeListing: previous,
            consentEventId: facts.consent!.consentEventId,
            status: "draft",
            story,
            ...terms,
            createdAt: now,
            updatedAt: now,
            createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
          });
          return lotCode;
        })
    );
    await recordAuctionReservation(tx, ctx, artworkId, id, previous);
    await recordAudit(tx, ctx, {
      action: "auction_lot.created",
      entity: { type: "auction_lot", id },
      before: null,
      after: { status: "draft", artworkId },
      actorRole: role,
    });
    await emit(tx, ctx.clock, {
      type: "auction.lot_created",
      aggregate: { type: "auction_lot", id },
      payload: { lotId: id },
    });
    return { ok: true, lotId: id, lotCode } as const;
  });
}

async function listEligibleArtwork(ctx: UseCaseContext) {
  await authorize(ctx, "auction.lot.admin");
  const rows = await ctx.db
    .select({
      id: physicalArtwork.id,
      artworkCode: physicalArtwork.artworkCode,
      title: entry.title,
      status: physicalArtwork.status,
    })
    .from(physicalArtwork)
    .innerJoin(entry, eq(entry.id, physicalArtwork.entryId))
    .where(inArray(physicalArtwork.status, LISTABLE_ARTWORK_STATUSES))
    .orderBy(asc(physicalArtwork.artworkCode));
  const result = [];
  for (const row of rows) {
    const found = await eligibility(ctx, row.id);
    if (found?.eligibility.eligible && found.consent)
      result.push({
        artworkId: row.id,
        artworkCode: row.artworkCode,
        title: row.title,
        status: row.status,
        credit: found.consent.credit.name,
      });
  }
  return result;
}

export const auctionsUseCases = (ctx: UseCaseContext) => ({
  browseLots: () => browseLots(ctx),
  getLot: (input: { lotCode: string }) => getLot(ctx, input),
  listLotsForAdmin: () => listLotsForAdmin(ctx),
  getLotForAdmin: (input: { lotId: string }) => getLotForAdmin(ctx, input),
  createLot: (input: CreateLotInput) => createLot(ctx, input),
  listEligibleArtwork: () => listEligibleArtwork(ctx),
  scheduleLot: (input: LotInput) => scheduleLot(ctx, input),
  cancelLot: (input: CancelLotInput) => cancelLot(ctx, input),
  openLot: (input: LotInput) => openLot(ctx, input),
  closeLot: (input: LotInput) => closeLot(ctx, input),
  settleClosedLot: (input: LotInput) => settleClosedLot(ctx, input),
});
