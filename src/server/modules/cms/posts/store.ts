// Reading and locking posts and their images (#112). Loads under plain Node
// (the worker): relative imports only.

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import type { AppDb } from "../../../db/app-db";
import {
  cmsPost,
  cmsPostImage,
  type CmsPost,
  type CmsPostImage,
} from "../../../db/schema";
import { sqlState } from "../../../errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` can name a row: anything else is simply not found. */
export function isRowId(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

/** The post, or null; locked until the transaction ends when `lock`. */
export async function loadPost(
  db: AppDb,
  postId: string,
  { lock = false }: { lock?: boolean } = {}
): Promise<CmsPost | null> {
  if (!isRowId(postId)) return null;
  const query = db.select().from(cmsPost).where(eq(cmsPost.id, postId));
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/**
 * Whether `error` is the unique index refusing a second post at one
 * address: a save that committed between slugTaken and this write.
 */
export function isSlugConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "object" || current === null) return false;
    // PGlite's errors name it `constraint`, postgres-js's `constraint_name`.
    const record = current as Record<string, unknown>;
    const name = record.constraint ?? record.constraint_name;
    if (sqlState(current) === "23505" && name === "cms_post_slug_unique") {
      return true;
    }
    current = record.cause;
  }
  return false;
}

/** Whether another post than `exceptId` has the address `slug`. */
export async function slugTaken(
  db: AppDb,
  slug: string,
  exceptId?: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: cmsPost.id })
    .from(cmsPost)
    .where(
      exceptId
        ? and(eq(cmsPost.slug, slug), ne(cmsPost.id, exceptId))
        : eq(cmsPost.slug, slug)
    );
  return row !== undefined;
}

/** The post's uploaded images, oldest first. */
export async function imagesOf(
  db: AppDb,
  postId: string
): Promise<CmsPostImage[]> {
  return db
    .select()
    .from(cmsPostImage)
    .where(eq(cmsPostImage.postId, postId))
    .orderBy(cmsPostImage.createdAt, cmsPostImage.id);
}

/** The images among `ids` that belong to the post. */
export async function postImagesIn(
  db: AppDb,
  postId: string,
  ids: readonly string[]
): Promise<CmsPostImage[]> {
  const valid = ids.filter(isRowId);
  if (valid.length === 0) return [];
  return db
    .select()
    .from(cmsPostImage)
    .where(
      and(eq(cmsPostImage.postId, postId), inArray(cmsPostImage.id, valid))
    );
}

/** Every post, the most recently changed first. */
export async function allPosts(db: AppDb): Promise<CmsPost[]> {
  return db
    .select()
    .from(cmsPost)
    .orderBy(desc(cmsPost.updatedAt), desc(cmsPost.id));
}
