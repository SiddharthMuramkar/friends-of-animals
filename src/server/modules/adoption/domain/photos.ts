// An adoption listing's photos (#129). A representative uploads each one
// as a private original (purpose `adoption_photo`); the Files module scans
// it and makes resized copies with the metadata stripped. Only those
// derived copies are ever public, and only while the listing is: the public
// read models carry photo ids and the sizes below, never a storage key.
//
// Pure: no I/O, no "server-only", no `@/` imports.

import { graphemeLength, normalisePlainText } from "./details";

export const ADOPTION_PHOTO_LIMITS = {
  maxPhotos: 8,
  /** The text alternative, in graphemes. */
  altTextMax: 150,
} as const;

/**
 * The derived copies public pages use: cards (320), the animal's page on a
 * phone (800) and on a wide screen (1600). Names match the Files module's
 * derivative kinds.
 */
export const ADOPTION_PHOTO_KINDS = [
  "thumb_320",
  "display_800",
  "display_1600",
] as const;

export type AdoptionPhotoKind = (typeof ADOPTION_PHOTO_KINDS)[number];

/** Where the Files module is with a photo's derived copies. */
export type PhotoProcessing = "queued" | "done" | "failed";

export type ListingPhoto = {
  id: string;
  position: number;
  altText: string;
  processing: PhotoProcessing;
};

export function checkAltText(
  text: string
):
  | { ok: true; altText: string }
  | { ok: false; refusal: "alt_required" | "alt_too_long" } {
  const altText = normalisePlainText(text, false);
  if (altText === "") return { ok: false, refusal: "alt_required" };
  if (graphemeLength(altText) > ADOPTION_PHOTO_LIMITS.altTextMax) {
    return { ok: false, refusal: "alt_too_long" };
  }
  return { ok: true, altText };
}

/** The photos a public page may show: derived copies ready, in order. */
export function publicPhotos<P extends ListingPhoto>(
  photos: readonly P[]
): P[] {
  return photos
    .filter((photo) => photo.processing === "done")
    .toSorted((a, b) => a.position - b.position);
}

export type PublishBlocker = "directory_not_verified" | "no_photo";

/** Why a draft can't be published yet; empty when it can. */
export function publishBlockers(listing: {
  directoryVerified: boolean;
  photos: readonly ListingPhoto[];
}): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (!listing.directoryVerified) blockers.push("directory_not_verified");
  if (publicPhotos(listing.photos).length === 0) blockers.push("no_photo");
  return blockers;
}
