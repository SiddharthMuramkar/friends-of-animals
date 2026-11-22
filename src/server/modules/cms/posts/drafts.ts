// Writing blog posts and stories (#112).
//
//   checkPostWriter()               → content manager
//   createPost(input)               → content manager
//   updatePost({ postId, ...input }) → content manager
//   getPostForEdit({ postId })       → content manager
//   listPosts()                      → content manager
//
// A post starts as a draft at an address nobody else has. Every save
// cleans its fields and passes its body through the `post` profile of the
// sanitiser; every read passes the body through it again, so a row written
// behind the use cases' back is still shown clean.
//
// Loads under plain Node: relative imports only.

import { eq } from "drizzle-orm";

import { authorize } from "../../../access/can";
import { cmsPost, type CmsPost } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import type { AppDb } from "../../../db/app-db";
import {
  postImageIdsIn,
  sanitizePostBody,
  type PostBody,
  type PostImageRef,
} from "../../../rich-text/post-body";
import type { UseCaseContext } from "../../../use-cases";
import type { PostAudience, PostKind } from "../domain/post-kinds";
import { canEditPost, type PostStatus } from "../domain/post-status";
import { postTags } from "./cache-tags";
import { goingLiveRefusal, type ImageNotReady } from "./gates";
import {
  readPostInput,
  refusal,
  type PostInput,
  type PostInputRefusal,
  type PostValues,
} from "./input";
import {
  allPosts,
  imagesOf,
  isSlugConflict,
  loadPost,
  postImagesIn,
  slugTaken,
} from "./store";

export type PostsContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

export type PostImageSummary = {
  id: string;
  /** Its private original's file asset, which no page shows. */
  fileId: string;
  alt: string;
  /** Whether its public copies exist, so it may go live. */
  ready: boolean;
};

export type PostForEdit = {
  id: string;
  status: PostStatus;
  kind: PostKind;
  slug: string;
  title: string;
  seoTitle: string | null;
  excerpt: string;
  easyRead: string | null;
  audience: PostAudience;
  topics: string[];
  featured: boolean;
  authorName: string | null;
  body: PostBody;
  cover: PostImageRef | null;
  images: PostImageSummary[];
  publishAt: Date | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PostSummary = Pick<
  PostForEdit,
  | "id"
  | "status"
  | "kind"
  | "slug"
  | "title"
  | "publishAt"
  | "publishedAt"
  | "updatedAt"
>;

/** The body or the cover names an image that isn't this post's. */
export type UnknownImage = { ok: false; error: "unknown_image" };

export type CreatePostResult =
  | { ok: true; postId: string; slug: string }
  | PostInputRefusal
  | UnknownImage;

export type UpdatePostResult =
  /** `tags`: the public cache tags the Server Action refreshes. */
  | { ok: true; tags: string[] }
  | PostInputRefusal
  | UnknownImage
  | ImageNotReady
  /** Archived posts are read-only until restored. */
  | { ok: false; error: "not_found" | "archived" };

export type GetPostForEditResult =
  | { ok: true; post: PostForEdit }
  | { ok: false; error: "not_found" };

/** The signed-in user acting, for the created_by and updated_by columns. */
function userIdOf(ctx: PostsContext): string | null {
  return ctx.actor.kind === "user" ? ctx.actor.userId : null;
}

function coverOf(row: CmsPost): PostImageRef | null {
  if (row.coverImageId) return { postImageId: row.coverImageId };
  if (row.coverSiteImageId) {
    return { siteImageId: row.coverSiteImageId } as PostImageRef;
  }
  return null;
}

function columns(values: PostValues) {
  return {
    kind: values.kind,
    slug: values.slug,
    title: values.title,
    seoTitle: values.seoTitle,
    excerpt: values.excerpt,
    easyRead: values.easyRead,
    audience: values.audience,
    topics: values.topics,
    featured: values.featured,
    authorName: values.authorName,
    body: values.body,
    coverImageId: values.coverImageId,
    coverSiteImageId: values.coverSiteImageId,
  };
}

/** Every uploaded image the post's values name: its cover and its body's. */
function namedImages(values: PostValues): string[] {
  const ids = postImageIdsIn(values.body);
  if (values.coverImageId) ids.push(values.coverImageId);
  return [...new Set(ids)];
}

/** Whether every image the values name is one of the post's own. */
async function imagesBelong(
  db: AppDb,
  postId: string | null,
  values: PostValues
): Promise<boolean> {
  const named = namedImages(values);
  if (named.length === 0) return true;
  if (postId === null) return false;
  return (await postImagesIn(db, postId, named)).length === named.length;
}

/**
 * Runs a save, answering `slug: taken` when the unique index catches a post
 * saved at the same address since the save's own check.
 */
async function takenIfConflict<R>(
  save: () => Promise<R>
): Promise<R | PostInputRefusal> {
  try {
    return await save();
  } catch (error) {
    if (isSlugConflict(error)) return refusal({ slug: "taken" });
    throw error;
  }
}

/**
 * Refuses, as createPost and updatePost would, unless the actor may write
 * posts. The editor's Server Actions ask first and read the form after,
 * so a form sent by someone else is never parsed.
 */
export async function checkPostWriter(ctx: PostsContext): Promise<void> {
  await authorize(ctx, "cms.post.write");
}

/** Saves a new draft. */
export async function createPost(
  ctx: PostsContext,
  input: PostInput
): Promise<CreatePostResult> {
  await authorize(ctx, "cms.post.write");
  const read = readPostInput(input, { draft: true });
  if (!read.ok) return read;
  const { values } = read;
  // A new post has no images of its own yet.
  if (!(await imagesBelong(ctx.db, null, values))) {
    return { ok: false, error: "unknown_image" };
  }
  const now = ctx.clock.now();

  return takenIfConflict(() =>
    ctx.db.transaction(async (tx) => {
      if (await slugTaken(tx, values.slug)) return refusal({ slug: "taken" });
      const postId = uuidv7(now);
      await tx.insert(cmsPost).values({
        id: postId,
        ...columns(values),
        status: "draft",
        createdBy: userIdOf(ctx),
        updatedBy: userIdOf(ctx),
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, postId, slug: values.slug } as const;
    })
  );
}

/** Saves the editor's changes to a post. */
export async function updatePost(
  ctx: PostsContext,
  input: PostInput & { postId: string }
): Promise<UpdatePostResult> {
  await authorize(ctx, "cms.post.write");
  const { postId, ...fields } = input;
  const now = ctx.clock.now();

  return takenIfConflict(() =>
    ctx.db.transaction(async (tx): Promise<UpdatePostResult> => {
      const post = await loadPost(tx, postId, { lock: true });
      if (!post) return { ok: false, error: "not_found" };
      if (!canEditPost(post.status)) return { ok: false, error: "archived" };
      // A scheduled or published post stays ready to go live.
      const live = post.status !== "draft";
      const read = readPostInput(fields, { draft: !live });
      if (!read.ok) return read;
      const { values } = read;
      if (await slugTaken(tx, values.slug, post.id)) {
        return refusal({ slug: "taken" });
      }
      if (!(await imagesBelong(tx, post.id, values))) {
        return { ok: false, error: "unknown_image" };
      }
      if (live) {
        const refused = await goingLiveRefusal(tx, post.id, values);
        if (refused) return refused;
      }
      await tx
        .update(cmsPost)
        .set({ ...columns(values), updatedBy: userIdOf(ctx), updatedAt: now })
        .where(eq(cmsPost.id, post.id));
      return { ok: true, tags: live ? postTags(post.slug, values.slug) : [] };
    })
  );
}

/** A post as its editor sees it, body sanitised again on the way out. */
export async function getPostForEdit(
  ctx: PostsContext,
  input: { postId: string }
): Promise<GetPostForEditResult> {
  await authorize(ctx, "cms.post.read_drafts");
  const row = await loadPost(ctx.db, input.postId);
  if (!row) return { ok: false, error: "not_found" };
  const images = await imagesOf(ctx.db, row.id);
  return {
    ok: true,
    post: {
      id: row.id,
      status: row.status,
      kind: row.kind,
      slug: row.slug,
      title: row.title,
      seoTitle: row.seoTitle,
      excerpt: row.excerpt,
      easyRead: row.easyRead,
      audience: row.audience,
      topics: row.topics,
      featured: row.featured,
      authorName: row.authorName,
      body: sanitizePostBody(row.body),
      cover: coverOf(row),
      images: images.map((image) => ({
        id: image.id,
        fileId: image.fileAssetId,
        alt: image.alt,
        ready: image.publicAt !== null,
      })),
      publishAt: row.publishAt,
      publishedAt: row.publishedAt,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

/** Every post in every status, the most recently changed first. */
export async function listPosts(ctx: PostsContext): Promise<PostSummary[]> {
  await authorize(ctx, "cms.post.read_drafts");
  const rows = await allPosts(ctx.db);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    kind: row.kind,
    slug: row.slug,
    title: row.title,
    publishAt: row.publishAt,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  }));
}
