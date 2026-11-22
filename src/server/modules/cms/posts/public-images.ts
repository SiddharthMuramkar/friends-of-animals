// Where a visitor's browser loads a post's uploaded images (#112b): their
// public copies only (`<prefix>public/cms_image/<fileId>/<kind>.webp` in the
// public bucket, ./images.ts), at the public bucket's own domain. The
// original's key is never read here, so no URL built here can name it. An
// image whose copies aren't written yet, or an environment whose public
// bucket has no domain, has no public image at all.

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import type { AppDb } from "../../../db/app-db";
import { cmsPostImage, fileAsset, fileDerivative } from "../../../db/schema";
import type { FilesConfig } from "../../../deps";
import type { DerivativeKind } from "../../files/domain/derivatives";
import {
  publicCopyKeyFor,
  storagePrefixOf,
} from "../../files/domain/storage-key";
import { POST_IMAGE_KINDS } from "./images";
import { isRowId } from "./store";
import type { PublicPostImage } from "./view";

/** A post image's public copies: the cover's size and the body's. */
export type PublicCopies = {
  cover?: PublicPostImage;
  inline?: PublicPostImage;
};

const SIZE_OF: Partial<Record<DerivativeKind, keyof PublicCopies>> = {
  post_cover_1200: "cover",
  post_inline_960: "inline",
};

/** The public copies of each image among `postImageIds` that has them. */
export async function publicCopiesOf(
  db: AppDb,
  files: Pick<FilesConfig, "publicBaseUrl">,
  postImageIds: readonly string[]
): Promise<Map<string, PublicCopies>> {
  const copies = new Map<string, PublicCopies>();
  const ids = [...new Set(postImageIds)].filter(isRowId);
  const base = files.publicBaseUrl;
  if (base === null || ids.length === 0) return copies;

  const rows = await db
    .select({
      id: cmsPostImage.id,
      alt: cmsPostImage.alt,
      fileId: fileAsset.id,
      purpose: fileAsset.purpose,
      storageKey: fileAsset.storageKey,
      kind: fileDerivative.kind,
      width: fileDerivative.width,
      height: fileDerivative.height,
    })
    .from(cmsPostImage)
    .innerJoin(fileAsset, eq(fileAsset.id, cmsPostImage.fileAssetId))
    .innerJoin(fileDerivative, eq(fileDerivative.fileAssetId, fileAsset.id))
    .where(
      and(
        inArray(cmsPostImage.id, ids),
        isNotNull(cmsPostImage.publicAt),
        eq(fileAsset.purpose, "cms_image"),
        inArray(fileDerivative.kind, [...POST_IMAGE_KINDS])
      )
    );

  for (const row of rows) {
    const size = SIZE_OF[row.kind as DerivativeKind];
    if (!size || row.width === null || row.height === null) continue;
    const key = publicCopyKeyFor({
      prefix: storagePrefixOf({
        id: row.fileId,
        purpose: row.purpose,
        storageKey: row.storageKey,
      }),
      purpose: row.purpose,
      fileId: row.fileId,
      kind: row.kind as DerivativeKind,
    });
    copies.set(row.id, {
      ...copies.get(row.id),
      [size]: {
        source: "public",
        url: new URL(key, base).href,
        width: row.width,
        height: row.height,
        alt: row.alt,
      },
    });
  }
  return copies;
}
