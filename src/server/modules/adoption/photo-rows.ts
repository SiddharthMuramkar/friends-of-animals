// Reading adoption listings' photos (#129): each photo's place, text
// alternative and how far its file has got (upload, scan, resized
// copies), and the sizes of its ready copies. Never a storage key: what
// leaves here names a photo by its id, and the public loads its copies
// through /media/adoption/<photoId>/<kind> (./photo-read.ts).

import { and, asc, eq, inArray } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  adoptionListingPhoto,
  fileAsset,
  fileDerivative,
  fileProcessing,
} from "../../db/schema";
import type { FileStatus } from "../files/domain/file-status";
import {
  ADOPTION_PHOTO_KINDS,
  publicPhotos,
  type AdoptionPhotoKind,
  type ListingPhoto,
} from "./domain/photos";

/**
 * Where a photo is, as its representative sees it: still uploading, being
 * scanned, being resized, ready, or refused (flagged by the scan, or its
 * copies couldn't be made).
 */
export type PhotoState =
  | "uploading"
  | "scanning"
  | "processing"
  | "ready"
  | "refused";

export type PhotoVariant = {
  kind: AdoptionPhotoKind;
  /** Same-origin: /media/adoption/<photoId>/<kind>. */
  url: string;
  width: number;
  height: number;
};

export type StoredPhoto = ListingPhoto & {
  listingId: string;
  state: PhotoState;
  /** The ready copies, smallest first; empty until it is ready. */
  variants: PhotoVariant[];
};

/** The public address of one copy of a photo. */
export function adoptionPhotoPath(
  photoId: string,
  kind: AdoptionPhotoKind
): string {
  return `/media/adoption/${photoId}/${kind}`;
}

function stateOf(
  fileStatus: FileStatus,
  processing: "queued" | "done" | "failed" | null
): PhotoState {
  switch (fileStatus) {
    case "pending_upload":
      return "uploading";
    case "uploaded":
    case "scanning":
      return "scanning";
    case "clean":
      return processing === "done"
        ? "ready"
        : processing === "failed"
          ? "refused"
          : "processing";
    case "quarantined":
    case "rejected":
    case "deleted":
      return "refused";
  }
}

const KIND_ORDER = new Map(ADOPTION_PHOTO_KINDS.map((kind, i) => [kind, i]));

function isPhotoKind(kind: string): kind is AdoptionPhotoKind {
  return KIND_ORDER.has(kind as AdoptionPhotoKind);
}

/** Every photo of each listing in `listingIds`, in gallery order. */
export async function photosOf(
  db: AppDb,
  listingIds: readonly string[]
): Promise<Map<string, StoredPhoto[]>> {
  const byListing = new Map<string, StoredPhoto[]>();
  if (listingIds.length === 0) return byListing;
  const rows = await db
    .select({
      id: adoptionListingPhoto.id,
      listingId: adoptionListingPhoto.listingId,
      position: adoptionListingPhoto.position,
      altText: adoptionListingPhoto.altText,
      fileStatus: fileAsset.status,
      processing: fileProcessing.status,
    })
    .from(adoptionListingPhoto)
    .innerJoin(fileAsset, eq(fileAsset.id, adoptionListingPhoto.fileAssetId))
    .leftJoin(
      fileProcessing,
      eq(fileProcessing.fileAssetId, adoptionListingPhoto.fileAssetId)
    )
    .where(inArray(adoptionListingPhoto.listingId, [...new Set(listingIds)]))
    .orderBy(
      asc(adoptionListingPhoto.position),
      asc(adoptionListingPhoto.createdAt)
    );
  const ready = rows.filter(
    (row) => stateOf(row.fileStatus, row.processing) === "ready"
  );
  const variants = await variantsOf(
    db,
    ready.map((row) => row.id)
  );
  for (const row of rows) {
    const state = stateOf(row.fileStatus, row.processing);
    const photo: StoredPhoto = {
      id: row.id,
      listingId: row.listingId,
      position: row.position,
      altText: row.altText,
      state,
      // A photo counts as ready only once every public copy exists.
      processing:
        state === "ready" && variants.get(row.id)?.length === KIND_ORDER.size
          ? "done"
          : state === "refused"
            ? "failed"
            : "queued",
      variants: variants.get(row.id) ?? [],
    };
    byListing.set(row.listingId, [
      ...(byListing.get(row.listingId) ?? []),
      photo,
    ]);
  }
  return byListing;
}

async function variantsOf(
  db: AppDb,
  photoIds: readonly string[]
): Promise<Map<string, PhotoVariant[]>> {
  const byPhoto = new Map<string, PhotoVariant[]>();
  if (photoIds.length === 0) return byPhoto;
  const rows = await db
    .select({
      photoId: adoptionListingPhoto.id,
      kind: fileDerivative.kind,
      width: fileDerivative.width,
      height: fileDerivative.height,
    })
    .from(adoptionListingPhoto)
    .innerJoin(
      fileDerivative,
      eq(fileDerivative.fileAssetId, adoptionListingPhoto.fileAssetId)
    )
    .where(
      and(
        inArray(adoptionListingPhoto.id, [...photoIds]),
        inArray(fileDerivative.kind, [...ADOPTION_PHOTO_KINDS])
      )
    );
  for (const row of rows) {
    if (!isPhotoKind(row.kind) || row.width === null || row.height === null) {
      continue;
    }
    const variant = {
      kind: row.kind,
      url: adoptionPhotoPath(row.photoId, row.kind),
      width: row.width,
      height: row.height,
    };
    byPhoto.set(
      row.photoId,
      [...(byPhoto.get(row.photoId) ?? []), variant].toSorted(
        (a, b) => (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0)
      )
    );
  }
  return byPhoto;
}

/** What the public sees of a photo: its copies and its text alternative. */
export type PublicPhoto = {
  id: string;
  alt: string;
  variants: PhotoVariant[];
};

/** The photos a public page shows: ready, in gallery order. */
export function publicPhotosOf(photos: readonly StoredPhoto[]): PublicPhoto[] {
  return publicPhotos(photos).map((photo) => ({
    id: photo.id,
    alt: photo.altText,
    variants: photo.variants,
  }));
}
