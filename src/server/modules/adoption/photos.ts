// An adoption listing's photos (#129).
//
//   requestAdoptionPhotoUpload({ adoptionListingId, altText, contentType, sizeBytes })
//       → a presigned upload of purpose adoption_photo, already placed
//         last in the gallery; the browser PUTs it and calls completeUpload.
//         The scan and worker-media then make its resized copies, and the
//         photo shows once they are ready.
//   describeAdoptionPhoto({ photoId, altText }) → a new text alternative
//   removeAdoptionPhoto({ photoId })             → out of the gallery
//
// The original is never public (./photo-read.ts serves only copies).
// A removed photo's file stays private until retention removes it (HR-31).

import { and, count, eq, max } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { adoptionListingPhoto } from "../../db/schema";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  presignUpload,
  type RequestUploadResult,
} from "../files/use-cases/upload";
import { adoptionListingManaged } from "./acting-for";
import { ADOPTION_PHOTO_LIMITS, checkAltText } from "./domain/photos";
import { acceptsChanges } from "./domain/status";
import { photosOf } from "./photo-rows";

export type RequestAdoptionPhotoUploadInput = {
  adoptionListingId: string;
  altText: string;
  contentType: string;
  sizeBytes: number;
};

type ListingRefusal = {
  ok: false;
  error: "listing_closed" | "directory_not_verified";
};

type AltRefusal = { ok: false; error: "alt_required" | "alt_too_long" };

export type RequestAdoptionPhotoUploadResult =
  | (Extract<RequestUploadResult, { ok: true }> & { photoId: string })
  | Exclude<RequestUploadResult, { ok: true }>
  | InvalidInput
  | ListingRefusal
  | AltRefusal
  | { ok: false; error: "too_many_photos" };

const uploadInput = z.object({
  adoptionListingId: z.uuid(),
  altText: z.string().max(2000),
  contentType: z.string().max(200),
  sizeBytes: z.number(),
});

export async function requestAdoptionPhotoUpload(
  ctx: UseCaseContext,
  input: RequestAdoptionPhotoUploadInput
): Promise<RequestAdoptionPhotoUploadResult> {
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { adoptionListingId, contentType, sizeBytes } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const { row, directory, role } = await adoptionListingManaged(
      ctx,
      tx,
      adoptionListingId,
      { lock: true }
    );
    if (!acceptsChanges(row.status)) {
      return { ok: false, error: "listing_closed" } as const;
    }
    if (!directory.verified) {
      return { ok: false, error: "directory_not_verified" } as const;
    }
    const alt = checkAltText(parsed.data.altText);
    if (!alt.ok) return { ok: false, error: alt.refusal } as const;
    const [counted] = await tx
      .select({ photos: count(), last: max(adoptionListingPhoto.position) })
      .from(adoptionListingPhoto)
      .where(eq(adoptionListingPhoto.listingId, row.id));
    if ((counted?.photos ?? 0) >= ADOPTION_PHOTO_LIMITS.maxPhotos) {
      return { ok: false, error: "too_many_photos" } as const;
    }
    const upload = await presignUpload(ctx, tx, {
      purpose: "adoption_photo",
      contentType,
      sizeBytes,
    });
    if (!upload.ok) return upload;

    const now = ctx.clock.now();
    const photoId = uuidv7(now);
    await tx.insert(adoptionListingPhoto).values({
      id: photoId,
      listingId: row.id,
      fileAssetId: upload.fileId,
      position: (counted?.last ?? 0) + 1,
      altText: alt.altText,
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "adoption.photo_added",
      entity: { type: "adoption_listing", id: row.id },
      before: null,
      after: { photoId, fileId: upload.fileId },
      actorRole: role,
    });
    return { ...upload, photoId };
  });
}

const photoInput = z.object({ photoId: z.uuid() });

/** The photo and its listing, if the actor manages it; throws otherwise. */
async function photoManaged(ctx: UseCaseContext, tx: AppDb, photoId: string) {
  const [photo] = await tx
    .select()
    .from(adoptionListingPhoto)
    .where(eq(adoptionListingPhoto.id, photoId));
  if (!photo) {
    throw new DomainError(
      "forbidden",
      `${ctx.actor.kind} may not adoption.listing.manage`
    );
  }
  const managed = await adoptionListingManaged(ctx, tx, photo.listingId, {
    lock: true,
  });
  return { photo, ...managed };
}

export type AdoptionPhotoChangeResult =
  | { ok: true; slug: string; directoryListingId: string }
  | InvalidInput
  | ListingRefusal
  | AltRefusal
  | { ok: false; error: "last_photo" };

export async function describeAdoptionPhoto(
  ctx: UseCaseContext,
  input: { photoId: string; altText: string }
): Promise<AdoptionPhotoChangeResult> {
  const parsed = photoInput
    .extend({ altText: z.string().max(2000) })
    .safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const { photo, row, directory, role } = await photoManaged(
      ctx,
      tx,
      parsed.data.photoId
    );
    if (!acceptsChanges(row.status)) {
      return { ok: false, error: "listing_closed" } as const;
    }
    if (!directory.verified) {
      return { ok: false, error: "directory_not_verified" } as const;
    }
    const alt = checkAltText(parsed.data.altText);
    if (!alt.ok) return { ok: false, error: alt.refusal } as const;
    await tx
      .update(adoptionListingPhoto)
      .set({ altText: alt.altText })
      .where(eq(adoptionListingPhoto.id, photo.id));
    await recordAudit(tx, ctx, {
      action: "adoption.photo_described",
      entity: { type: "adoption_listing", id: row.id },
      before: null,
      after: { photoId: photo.id },
      actorRole: role,
    });
    return {
      ok: true,
      slug: row.slug,
      directoryListingId: row.directoryListingId,
    };
  });
}

/**
 * Takes a photo out of the gallery. A public listing keeps at least one
 * ready photo: its last one can't go until another is ready.
 */
export async function removeAdoptionPhoto(
  ctx: UseCaseContext,
  input: { photoId: string }
): Promise<AdoptionPhotoChangeResult> {
  const parsed = photoInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const { photo, row, role } = await photoManaged(
      ctx,
      tx,
      parsed.data.photoId
    );
    if (!acceptsChanges(row.status)) {
      return { ok: false, error: "listing_closed" } as const;
    }
    if (row.status !== "draft") {
      const photos = (await photosOf(tx, [row.id])).get(row.id) ?? [];
      const ready = photos.filter((p) => p.processing === "done");
      if (ready.length === 1 && ready[0]?.id === photo.id) {
        return { ok: false, error: "last_photo" } as const;
      }
    }
    await tx
      .delete(adoptionListingPhoto)
      .where(
        and(
          eq(adoptionListingPhoto.id, photo.id),
          eq(adoptionListingPhoto.listingId, row.id)
        )
      );
    await recordAudit(tx, ctx, {
      action: "adoption.photo_removed",
      entity: { type: "adoption_listing", id: row.id },
      before: { photoId: photo.id, fileId: photo.fileAssetId },
      after: null,
      actorRole: role,
    });
    return {
      ok: true,
      slug: row.slug,
      directoryListingId: row.directoryListingId,
    };
  });
}
