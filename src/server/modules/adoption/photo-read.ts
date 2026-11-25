// Serving an adoption photo's resized copy (#129), for the same-origin
// route /media/adoption/<photoId>/<kind>. One place decides:
//
//   - only the kinds in ADOPTION_PHOTO_KINDS, never the original;
//   - only a clean file whose copies are made;
//   - to anyone while the animal's page is public (published, on hold or
//     adopted, under a verified directory listing): `cacheable` is true;
//   - otherwise only to the listing's representatives, uncached, so they
//     can see a draft's photos.
//
// Anything else is not found, so a hidden animal's photo ids can't be
// probed. The bytes come from private storage; no URL to the bucket
// leaves the server, and the browser needs no other origin.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize, can } from "../../access/can";
import {
  adoptionListing,
  adoptionListingPhoto,
  directoryListing,
  fileAsset,
  fileDerivative,
  fileProcessing,
} from "../../db/schema";
import { ObjectMissingError } from "../../ports/storage";
import type { UseCaseContext } from "../../use-cases";
import { isPubliclyListed } from "../directory/domain/listing-status";
import { organisationResource } from "./acting-for";
import { ADOPTION_PHOTO_KINDS } from "./domain/photos";
import { publicVisibility } from "./domain/status";

export type ReadAdoptionPhotoResult =
  | {
      ok: true;
      body: ReadableStream<Uint8Array>;
      contentType: string;
      sizeBytes: number;
      /** True when anyone may see it, so caches may keep it a while. */
      cacheable: boolean;
    }
  | { ok: false; error: "not_found" };

const input = z.object({
  photoId: z.uuid(),
  kind: z.enum(ADOPTION_PHOTO_KINDS),
});

const NOT_FOUND = { ok: false, error: "not_found" } as const;

export async function readAdoptionPhoto(
  ctx: UseCaseContext,
  request: { photoId: string; kind: string }
): Promise<ReadAdoptionPhotoResult> {
  await authorize(ctx, "adoption.listing.read_public");
  const parsed = input.safeParse(request);
  if (!parsed.success) return NOT_FOUND;
  const { photoId, kind } = parsed.data;
  const [row] = await ctx.db
    .select({
      status: adoptionListing.status,
      directoryListingId: adoptionListing.directoryListingId,
      directoryStatus: directoryListing.status,
      bucket: fileDerivative.bucket,
      storageKey: fileDerivative.storageKey,
      contentType: fileDerivative.contentType,
      sizeBytes: fileDerivative.sizeBytes,
    })
    .from(adoptionListingPhoto)
    .innerJoin(
      adoptionListing,
      eq(adoptionListing.id, adoptionListingPhoto.listingId)
    )
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    )
    .innerJoin(fileAsset, eq(fileAsset.id, adoptionListingPhoto.fileAssetId))
    .innerJoin(
      fileProcessing,
      eq(fileProcessing.fileAssetId, adoptionListingPhoto.fileAssetId)
    )
    .innerJoin(
      fileDerivative,
      and(
        eq(fileDerivative.fileAssetId, adoptionListingPhoto.fileAssetId),
        eq(fileDerivative.kind, kind)
      )
    )
    .where(
      and(
        eq(adoptionListingPhoto.id, photoId),
        eq(fileAsset.purpose, "adoption_photo"),
        eq(fileAsset.status, "clean"),
        eq(fileProcessing.status, "done")
      )
    );
  if (!row) return NOT_FOUND;

  const cacheable =
    publicVisibility(row.status, isPubliclyListed(row.directoryStatus)) !==
    "hidden";
  if (!cacheable) {
    const decision = await can(
      ctx,
      "adoption.listing.manage",
      organisationResource(row.directoryListingId)
    );
    if (!decision.allowed) return NOT_FOUND;
  }
  try {
    const body = await ctx.storage.read({
      bucket: row.bucket,
      key: row.storageKey,
    });
    return {
      ok: true,
      body,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      cacheable,
    };
  } catch (error) {
    if (error instanceof ObjectMissingError) return NOT_FOUND;
    throw error;
  }
}
