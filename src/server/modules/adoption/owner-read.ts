// What a directory listing's representatives read of its animals (#129):
// every adoption listing in any status, and one in full with its photos,
// what stops it being published and the moves open to them.

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { adoptionListing, type AdoptionListingRow } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  adoptionListingManaged,
  directoryManaged,
  type ManagedDirectory,
} from "./acting-for";
import type { AdoptionListingDetails } from "./domain/details";
import { publishBlockers, type PublishBlocker } from "./domain/photos";
import {
  acceptsChanges,
  canMoveAdoptionListing,
  type AdoptionListingStatus,
} from "./domain/status";
import { photosOf, type StoredPhoto } from "./photo-rows";
import { detailsOf } from "./stored";

export type AdoptionListingSummary = {
  id: string;
  slug: string;
  name: string;
  species: AdoptionListingRow["species"];
  status: AdoptionListingStatus;
  /** The cover's thumbnail, once a photo is ready. */
  cover: { url: string; alt: string } | null;
  photoCount: number;
  updatedAt: Date;
};

export type ListAdoptionListingsResult =
  | {
      ok: true;
      directory: ManagedDirectory;
      listings: AdoptionListingSummary[];
    }
  | InvalidInput;

const directoryInput = z.object({ directoryListingId: z.uuid() });

/** Every animal a directory listing has listed, newest first. */
export async function listAdoptionListings(
  ctx: UseCaseContext,
  input: { directoryListingId: string }
): Promise<ListAdoptionListingsResult> {
  const parsed = directoryInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { directory } = await directoryManaged(
    ctx,
    ctx.db,
    parsed.data.directoryListingId
  );
  const rows = await ctx.db
    .select()
    .from(adoptionListing)
    .where(eq(adoptionListing.directoryListingId, directory.id))
    .orderBy(desc(adoptionListing.createdAt), desc(adoptionListing.id));
  const photos = await photosOf(
    ctx.db,
    rows.map((row) => row.id)
  );
  return {
    ok: true,
    directory,
    listings: rows.map((row) => {
      const own = photos.get(row.id) ?? [];
      const cover = own.find((photo) => photo.processing === "done");
      const thumb = cover?.variants[0];
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        species: row.species,
        status: row.status,
        cover: cover && thumb ? { url: thumb.url, alt: cover.altText } : null,
        photoCount: own.length,
        updatedAt: row.updatedAt,
      };
    }),
  };
}

/** The moves a representative can make from a status. */
export type OwnerMoves = {
  publish: boolean;
  hold: boolean;
  resume: boolean;
  withdraw: boolean;
};

export type AdoptionListingForOwner = {
  id: string;
  slug: string;
  status: AdoptionListingStatus;
  details: AdoptionListingDetails;
  directory: ManagedDirectory;
  photos: StoredPhoto[];
  /** Why it can't be published now; empty when it can. */
  publishBlockers: PublishBlocker[];
  /** Whether details and photos may still change. */
  editable: boolean;
  moves: OwnerMoves;
  publishedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date;
};

export type GetAdoptionListingForOwnerResult =
  | { ok: true; listing: AdoptionListingForOwner }
  | InvalidInput;

const listingInput = z.object({ adoptionListingId: z.uuid() });

function movesFrom(status: AdoptionListingStatus): OwnerMoves {
  const can = (to: AdoptionListingStatus) =>
    canMoveAdoptionListing(status, to, "representative");
  return {
    publish: status === "draft" && can("published"),
    hold: can("on_hold"),
    resume: status === "on_hold" && can("published"),
    withdraw: can("withdrawn"),
  };
}

export async function getAdoptionListingForOwner(
  ctx: UseCaseContext,
  input: { adoptionListingId: string }
): Promise<GetAdoptionListingForOwnerResult> {
  const parsed = listingInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { row, directory } = await adoptionListingManaged(
    ctx,
    ctx.db,
    parsed.data.adoptionListingId
  );
  const photos = (await photosOf(ctx.db, [row.id])).get(row.id) ?? [];
  return {
    ok: true,
    listing: {
      id: row.id,
      slug: row.slug,
      status: row.status,
      details: detailsOf(row, ctx.clock.now()),
      directory,
      photos,
      publishBlockers: publishBlockers({
        directoryVerified: directory.verified,
        photos,
      }),
      editable: acceptsChanges(row.status),
      moves: movesFrom(row.status),
      publishedAt: row.publishedAt,
      closedAt: row.closedAt,
      updatedAt: row.updatedAt,
    },
  };
}
