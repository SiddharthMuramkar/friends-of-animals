// What a post needs before it may go live, or stay live while it is
// edited (#112): every field going live needs (checkPostFields, not as a
// draft), alt text for an uploaded cover, and a public copy of every
// uploaded image it shows. Checked when it is scheduled or published, on
// every edit of a scheduled or published post (its fields in updatePost,
// an image's alt text in describePostImage), and again by the publish job,
// which takes a post that fails them back to a draft instead.
//
// Loads under plain Node: relative imports only.

import type { AppDb } from "../../../db/app-db";
import { postImageIdsIn, type PostBody } from "../../../rich-text/post-body";
import { checkPostFields } from "../domain/post-fields";
import { refusal, type PostInputRefusal } from "./input";
import { postImagesIn } from "./store";

export type GoingLiveFields = {
  title: string;
  seoTitle: string | null;
  excerpt: string;
  easyRead: string | null;
  authorName: string | null;
  body: PostBody;
  coverImageId: string | null;
};

export type ImageNotReady = { ok: false; error: "image_not_ready" };

/** An image's alt text as an edit would leave it, not yet saved. */
export type AltEdit = { postImageId: string; alt: string };

/**
 * Why the post can't go live as it is (with `edit` applied, if given), or
 * null when it can.
 */
export async function goingLiveRefusal(
  db: AppDb,
  postId: string,
  post: GoingLiveFields,
  edit?: AltEdit
): Promise<PostInputRefusal | ImageNotReady | null> {
  const named = postImageIdsIn(post.body);
  if (post.coverImageId) named.push(post.coverImageId);
  const images = (await postImagesIn(db, postId, [...new Set(named)])).map(
    (image) =>
      image.id === edit?.postImageId ? { ...image, alt: edit.alt } : image
  );
  const cover = images.find((image) => image.id === post.coverImageId);

  const fields = checkPostFields({
    title: post.title,
    seoTitle: post.seoTitle ?? undefined,
    excerpt: post.excerpt,
    easyRead: post.easyRead ?? undefined,
    authorName: post.authorName ?? undefined,
    cover: post.coverImageId ? { alt: cover?.alt ?? "" } : undefined,
  });
  if (!fields.ok) return refusal(fields.errors);
  if (images.some((image) => image.publicAt === null)) {
    return { ok: false, error: "image_not_ready" };
  }
  return null;
}
