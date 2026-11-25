import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import {
  auctionLot,
  auctionBid,
  physicalArtwork,
  entry,
  type AuctionLotRow,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import { publishedRecognitionForEntry } from "../results/read-published";
import { auctionConsentCredit } from "../consent/auction-credit";
import { PUBLIC_LOT_STATUSES } from "./domain/lot-status";
import { parseLotCode } from "./domain/lot-code";
import { auctionsEnabled, currentLotConsent } from "./lifecycle";
import { minimumNextBid } from "./domain/bid-rules";
import { liveEntryStampSource, stampedImage } from "../stamping";
import { ObjectMissingError } from "../../ports/storage";

// Select only the amount, in the same SQL snapshot as the closing time,
// so a live refresh cannot combine an old deadline with a new bid.
const publicSelection = {
  row: auctionLot,
  currentBidPaise: sql<
    bigint | null
  >`(SELECT max(${auctionBid.amountPaise}) FROM ${auctionBid} WHERE ${auctionBid.lotId} = ${auctionLot}."id")`.mapWith(
    auctionBid.amountPaise
  ),
};

async function toPublic(
  ctx: UseCaseContext,
  row: AuctionLotRow,
  currentBidPaise: bigint | null
) {
  // Consent checked on every read, not on a cached copy of the creator's
  // name. Neither an original File nor its private derivatives is joined.
  const consent = await currentLotConsent(ctx, row);
  if (!consent) return null;
  const copy = await imageOf(ctx, consent.entryId);
  return {
    lotCode: row.lotCode,
    story: row.story,
    creatorCredit: consent.credit.name,
    status: row.status,
    basePricePaise: row.basePricePaise,
    currentBidPaise,
    minimumBidPaise: minimumNextBid(
      { ...row, currentBidPaise },
      {
        minIncrementPaise: BigInt(
          await ctx.settings.get("auctions.minIncrementPaise")
        ),
      }
    ),
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    award: await publishedRecognitionForEntry(ctx.db, consent.entryId),
    image: copy
      ? {
          url: `/media/auctions/${row.lotCode}`,
          width: copy.width,
          height: copy.height,
          alt: "Artwork with the Friends of Animals logo",
        }
      : null,
  };
}

async function imageOf(ctx: UseCaseContext, entryId: string) {
  const fileId = await liveEntryStampSource(ctx.db, entryId);
  return fileId ? stampedImage(ctx, { fileId, variant: "gallery" }) : null;
}

/** Public media bytes only; a fresh consent and lot-state check on every
 * request, with no CDN or signed storage URL. A missing stamp is not found. */
export async function readLotImage(
  ctx: UseCaseContext,
  input: { lotCode: string }
) {
  await authorize(ctx, "auction.lot.read_image");
  const missing = { ok: false, error: "not_found" } as const;
  if (!(await auctionsEnabled(ctx)) || typeof input?.lotCode !== "string")
    return missing;
  const code = parseLotCode(input.lotCode);
  if (!code) return missing;
  const [lot] = await ctx.db
    .select()
    .from(auctionLot)
    .where(
      and(
        eq(auctionLot.lotCode, code),
        inArray(auctionLot.status, PUBLIC_LOT_STATUSES),
        gt(auctionLot.closesAt, ctx.clock.now())
      )
    );
  if (!lot) return missing;
  const consent = await currentLotConsent(ctx, lot);
  if (!consent) return missing;
  const copy = await imageOf(ctx, consent.entryId);
  if (!copy) return missing;
  try {
    const body = await ctx.storage.read({ bucket: copy.bucket, key: copy.key });
    return {
      ok: true,
      body,
      contentType: copy.contentType,
      sizeBytes: copy.sizeBytes,
    } as const;
  } catch (error) {
    if (error instanceof ObjectMissingError) return missing;
    throw error;
  }
}

export async function browseLots(ctx: UseCaseContext) {
  if (!(await auctionsEnabled(ctx))) return [];
  const lots = await ctx.db
    .select(publicSelection)
    .from(auctionLot)
    .where(
      and(
        inArray(auctionLot.status, PUBLIC_LOT_STATUSES),
        gt(auctionLot.closesAt, ctx.clock.now())
      )
    )
    .orderBy(asc(auctionLot.opensAt), asc(auctionLot.lotCode));
  const result = [];
  for (const lot of lots) {
    const publicLot = await toPublic(ctx, lot.row, lot.currentBidPaise);
    if (publicLot) result.push(publicLot);
  }
  return result;
}
export async function getLot(ctx: UseCaseContext, input: { lotCode: string }) {
  if (!(await auctionsEnabled(ctx)) || typeof input?.lotCode !== "string")
    return null;
  const code = parseLotCode(input.lotCode);
  if (!code) return null;
  const [row] = await ctx.db
    .select(publicSelection)
    .from(auctionLot)
    .where(
      and(
        eq(auctionLot.lotCode, code),
        inArray(auctionLot.status, PUBLIC_LOT_STATUSES),
        gt(auctionLot.closesAt, ctx.clock.now())
      )
    );
  return row ? toPublic(ctx, row.row, row.currentBidPaise) : null;
}
async function adminView(ctx: UseCaseContext, lot: AuctionLotRow) {
  const [artwork] = await ctx.db
    .select({
      artworkCode: physicalArtwork.artworkCode,
      registrationId: physicalArtwork.registrationId,
      entryId: physicalArtwork.entryId,
      title: entry.title,
    })
    .from(physicalArtwork)
    .innerJoin(entry, eq(entry.id, physicalArtwork.entryId))
    .where(eq(physicalArtwork.id, lot.artworkId));
  const credit = artwork
    ? await auctionConsentCredit(ctx, artwork.registrationId)
    : null;
  return {
    ...lot,
    artworkCode: artwork?.artworkCode ?? null,
    title: artwork?.title ?? null,
    creatorCredit: credit?.credit.name ?? null,
    award: artwork
      ? await publishedRecognitionForEntry(ctx.db, artwork.entryId)
      : null,
  };
}
export async function listLotsForAdmin(ctx: UseCaseContext) {
  await authorize(ctx, "auction.lot.admin");
  const rows = await ctx.db
    .select()
    .from(auctionLot)
    .orderBy(desc(auctionLot.createdAt), asc(auctionLot.lotCode));
  return Promise.all(rows.map((row) => adminView(ctx, row)));
}
export async function getLotForAdmin(
  ctx: UseCaseContext,
  input: { lotId: string }
) {
  await authorize(ctx, "auction.lot.admin");
  if (!z.uuid().safeParse(input?.lotId).success) return null;
  const [lot] = await ctx.db
    .select()
    .from(auctionLot)
    .where(eq(auctionLot.id, input.lotId));
  return lot ? adminView(ctx, lot) : null;
}
export type PublicLot = NonNullable<Awaited<ReturnType<typeof getLot>>>;
