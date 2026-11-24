// A post's images (#112).
//
//   uploadPostImage({ postId, contentType, sizeBytes, alt? }) → content manager
//   describePostImage({ postImageId, alt })                   → content manager
//   publishPostImage({ fileId })  → the files.file_processed handler (worker)
//
// The editor's browser uploads the original to the private bucket like any
// file (#63): presigned here, then completeUpload. Once the scan passes,
// worker-media makes its post derivatives (#85); when they are stored,
// publishPostImage copies those derivative bytes to the public bucket and
// marks the image ready. The original is never read here and never copied:
// no public URL can resolve to it. An image that is flagged, or whose
// derivatives fail, never gets public copies, so its post can't go live
// with it (./publishing.ts).
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import {
  cmsPost,
  cmsPostImage,
  fileAsset,
  fileDerivative,
} from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { sanitizePlainText } from "../../../rich-text/blocks";
import type { Clock } from "../../../ports/clock";
import type { ObjectStorage } from "../../../ports/storage";
import type { UseCaseContext } from "../../../use-cases";
import type { DerivativeKind } from "../../files/domain/derivatives";
import { IMAGE_DERIVATIVES } from "../../files/domain/media-work";
import type { UploadRefusal } from "../../files/domain/purposes";
import {
  publicBucketFor,
  publicCopyKeyFor,
  storagePrefixOf,
} from "../../files/domain/storage-key";
import { presignUpload } from "../../files/use-cases/upload";
import { POST_FIELD_MAX } from "../domain/post-fields";
import { canEditPost } from "../domain/post-status";
import { postTags } from "./cache-tags";
import { goingLiveRefusal, type ImageNotReady } from "./gates";
import { refusal, type PostInputRefusal } from "./input";
import { isRowId, loadPost } from "./store";

/** The copies of a post image the public site shows. */
export const POST_IMAGE_KINDS: readonly DerivativeKind[] =
  IMAGE_DERIVATIVES.cms_image ?? [];

export type PostImagesContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "storage" | "files"
>;

export type UploadPostImageInput = {
  postId: string;
  contentType: string;
  sizeBytes: number;
  /** What the image shows, for people who can't see it. */
  alt?: string;
};

export type UploadPostImageResult =
  | {
      ok: true;
      /** What the post's body and cover name the image by. */
      postImageId: string;
      /** Pass to completeUpload once the browser has PUT the bytes. */
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
      expiresAt: Date;
    }
  | PostInputRefusal
  /** Archived posts are read-only until restored. */
  | { ok: false; error: "not_found" | "archived" | UploadRefusal };

export type DescribePostImageResult =
  /** `tags`: the public cache tags the Server Action refreshes. */
  | { ok: true; tags: string[] }
  | PostInputRefusal
  | ImageNotReady
  | { ok: false; error: "not_found" | "archived" };

const uploadInput = z.object({
  postId: z.string(),
  contentType: z.string().max(200),
  sizeBytes: z.number().int(),
  alt: z.string().max(5000).optional(),
});

const describeInput = z.object({
  postImageId: z.string(),
  alt: z.string().max(5000),
});

/** The alt text, cleaned, or the refusal for one that is too long. */
function readAlt(raw: string | undefined): string | PostInputRefusal {
  const alt = sanitizePlainText(raw ?? "");
  return alt.length > POST_FIELD_MAX.coverAlt
    ? refusal({ alt: "too_long" })
    : alt;
}

/** Clears an unpublished image before retention deletes its locked file. */
export async function retireQuarantinedPostImage(tx: AppDb, fileId: string) {
  const [image] = await tx
    .select()
    .from(cmsPostImage)
    .where(eq(cmsPostImage.fileAssetId, fileId));
  if (!image) return true;
  if (image.publicAt !== null) return false;

  const post = await loadPost(tx, image.postId, { lock: true });
  if (!post) return true;
  const blocks = post.body.blocks.filter(
    (block) =>
      block.type !== "image" ||
      !("postImageId" in block) ||
      block.postImageId !== image.id
  );
  const usedInBody = blocks.length !== post.body.blocks.length;
  const referenced = usedInBody || post.coverImageId === image.id;
  if (referenced && post.status !== "draft") return false;
  if (usedInBody) {
    await tx
      .update(cmsPost)
      .set({ body: { ...post.body, blocks } })
      .where(eq(cmsPost.id, post.id));
  }
  // The cover FK clears any cover reference in this same transaction.
  await tx.delete(cmsPostImage).where(eq(cmsPostImage.id, image.id));
  return true;
}

/**
 * Presigns the upload of an image for the post and records it. The
 * content manager becomes the file's owner, so they complete the upload.
 */
export async function uploadPostImage(
  ctx: PostImagesContext,
  input: UploadPostImageInput
): Promise<UploadPostImageResult> {
  await authorize(ctx, "cms.post.write");
  const parsed = uploadInput.safeParse(input);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ];
    return refusal(Object.fromEntries(fields.map((f) => [f, "invalid"])));
  }
  const alt = readAlt(parsed.data.alt);
  if (typeof alt !== "string") return alt;

  return ctx.db.transaction(async (tx): Promise<UploadPostImageResult> => {
    const post = await loadPost(tx, parsed.data.postId, { lock: true });
    if (!post) return { ok: false, error: "not_found" };
    if (!canEditPost(post.status)) return { ok: false, error: "archived" };
    const presigned = await presignUpload(ctx, tx, {
      purpose: "cms_image",
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes,
    });
    if (!presigned.ok) {
      return presigned.error === "invalid_input"
        ? refusal({ contentType: "invalid" })
        : { ok: false, error: presigned.error };
    }
    const now = ctx.clock.now();
    const postImageId = uuidv7(now);
    await tx.insert(cmsPostImage).values({
      id: postImageId,
      postId: post.id,
      fileAssetId: presigned.fileId,
      alt,
      createdAt: now,
    });
    return {
      ok: true,
      postImageId,
      fileId: presigned.fileId,
      uploadUrl: presigned.uploadUrl,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt,
    };
  });
}

/**
 * Changes what an image's alt text says. A scheduled or published post
 * stays ready to go live (./gates.ts), so its cover can't lose its alt text.
 */
export async function describePostImage(
  ctx: PostImagesContext,
  input: { postImageId: string; alt: string }
): Promise<DescribePostImageResult> {
  await authorize(ctx, "cms.post.write");
  const parsed = describeInput.safeParse(input);
  if (!parsed.success || !isRowId(parsed.data.postImageId)) {
    return { ok: false, error: "not_found" };
  }
  const alt = readAlt(parsed.data.alt);
  if (typeof alt !== "string") return alt;
  const { postImageId } = parsed.data;
  return ctx.db.transaction(async (tx): Promise<DescribePostImageResult> => {
    const [image] = await tx
      .select({ postId: cmsPostImage.postId })
      .from(cmsPostImage)
      .where(eq(cmsPostImage.id, postImageId));
    const post = image
      ? await loadPost(tx, image.postId, { lock: true })
      : null;
    if (!post) return { ok: false, error: "not_found" };
    if (!canEditPost(post.status)) return { ok: false, error: "archived" };
    const live = post.status !== "draft";
    if (live) {
      const refused = await goingLiveRefusal(tx, post.id, post, {
        postImageId,
        alt,
      });
      if (refused) return refused;
    }
    await tx
      .update(cmsPostImage)
      .set({ alt })
      .where(eq(cmsPostImage.id, postImageId));
    return { ok: true, tags: live ? postTags(post.slug) : [] };
  });
}

export type PublishPostImageDeps = {
  db: AppDb;
  clock: Clock;
  storage: ObjectStorage;
};

async function readAll(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The files.file_processed handler: if the file is a post image, copies
 * its post derivatives to the public bucket and marks it ready. Anything
 * else (another purpose's file, a file no longer clean, an image already
 * ready) does nothing. Safe to repeat: it writes the same objects again.
 */
export async function publishPostImage(
  { db, clock, storage }: PublishPostImageDeps,
  { fileId }: { fileId: string }
): Promise<void> {
  const [found] = await db
    .select({ image: cmsPostImage, file: fileAsset })
    .from(cmsPostImage)
    .innerJoin(fileAsset, eq(fileAsset.id, cmsPostImage.fileAssetId))
    .where(eq(cmsPostImage.fileAssetId, fileId));
  if (!found || found.image.publicAt !== null) return;
  const { file } = found;
  if (file.status !== "clean" || file.purpose !== "cms_image") return;
  const derivatives = await db
    .select()
    .from(fileDerivative)
    .where(
      and(
        eq(fileDerivative.fileAssetId, file.id),
        inArray(fileDerivative.kind, [...POST_IMAGE_KINDS])
      )
    );
  if (derivatives.length !== POST_IMAGE_KINDS.length) {
    throw new Error(`File ${file.id} is missing post derivatives`);
  }

  const bucket = publicBucketFor(file.bucket);
  const prefix = storagePrefixOf(file);
  for (const derivative of derivatives) {
    const body = await readAll(
      await storage.read({
        bucket: derivative.bucket,
        key: derivative.storageKey,
      })
    );
    await storage.write({
      bucket,
      key: publicCopyKeyFor({
        prefix,
        purpose: file.purpose,
        fileId: file.id,
        kind: derivative.kind as DerivativeKind,
      }),
      body,
      contentType: derivative.contentType,
    });
  }
  await db
    .update(cmsPostImage)
    .set({ publicAt: clock.now() })
    .where(
      and(eq(cmsPostImage.id, found.image.id), isNull(cmsPostImage.publicAt))
    );
}
