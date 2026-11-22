// What the public site reads of blog posts and stories (#112b):
//
//   listPublishedPosts({ kind? })      → visitor: every public post, newest first
//   latestPublishedPosts({ limit })    → visitor: featured first, then newest
//   getPublishedPostBySlug({ slug })   → visitor: one public post, or null
//   publishedPostSlugs()               → visitor: the proxy's /blog/<slug> check
//
// "Public" is publicPostFilter: a published post, or a scheduled one whose
// instant has come (even before its job runs). Drafts, archived posts and
// posts still waiting for their instant are never read here.
//
// The five stories written in the repo (src/content/stories) stay on the
// site until the CMS has a post at their address: importRepoStories copies
// them in (the seed), and from then on that post decides, so archiving it
// takes the story down. Production is never seeded, so without this its
// blog would be empty until someone imported them.

import { and, eq, type SQL } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { cmsPost, type CmsPost } from "../../../db/schema";
import { sanitizePostBody } from "../../../rich-text/post-body";
import type { UseCaseContext } from "../../../use-cases";
import { readingMinutes, articleWords } from "../../../../content/stories/text";
import {
  SITE_IMAGE_IDS,
  type SiteImageId,
} from "../../../../lib/images/credits";
import { POST_KINDS, type PostKind } from "../domain/post-kinds";
import { latestPosts } from "../domain/post-listing";
import type { PostCard, PostImage, PostView } from "../domain/post-view";
import { publicPostFilter } from "./public-filter";
import { repoStoryCards, repoStoryView } from "./repo-stories";
import { postBodyView } from "./view";

export type PublicReadContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "files"
>;

const listInput = z.object({ kind: z.enum(POST_KINDS).optional() }).optional();
const slugInput = z.object({ slug: z.string().max(200) });
const limitInput = z.object({ limit: z.int().min(1).max(50) });

function isSiteImageId(id: string | null): id is SiteImageId {
  return id !== null && (SITE_IMAGE_IDS as readonly string[]).includes(id);
}

/** When the post went live: its publish instant if the job hasn't run. */
function liveAt(row: CmsPost): Date {
  return row.publishedAt ?? row.publishAt ?? row.updatedAt;
}

function coverOf(row: CmsPost): PostImage | null {
  return isSiteImageId(row.coverSiteImageId)
    ? { source: "site", id: row.coverSiteImageId }
    : null;
}

function cardOf(row: CmsPost): PostCard {
  const body = sanitizePostBody(row.body);
  return {
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    seoTitle: row.seoTitle,
    excerpt: row.excerpt,
    audience: row.audience,
    topics: [...row.topics],
    featured: row.featured,
    readingMinutes: readingMinutes(articleWords(body)),
    cover: coverOf(row),
    publishedAt: liveAt(row),
    updatedAt: row.updatedAt,
  };
}

function viewOf(row: CmsPost): PostView {
  return {
    ...cardOf(row),
    easyRead: row.easyRead,
    authorName: row.authorName,
    body: postBodyView(sanitizePostBody(row.body), new Map()),
  };
}

/** The public posts matching `where`, newest first. */
async function publicRows(
  { db, clock }: PublicReadContext,
  where?: SQL
): Promise<CmsPost[]> {
  const rows = await db
    .select()
    .from(cmsPost)
    .where(and(publicPostFilter(clock.now()), where));
  return rows.toSorted((a, b) => liveAt(b).getTime() - liveAt(a).getTime());
}

/** Every address the CMS has a post at, whatever its status. */
async function cmsSlugs({ db }: PublicReadContext): Promise<Set<string>> {
  const rows = await db.select({ slug: cmsPost.slug }).from(cmsPost);
  return new Set(rows.map((row) => row.slug));
}

/** The repo stories the CMS has no post for, of `kind` if given. */
async function repoCards(
  ctx: PublicReadContext,
  kind?: PostKind
): Promise<PostCard[]> {
  if (kind && kind !== "story") return [];
  const taken = await cmsSlugs(ctx);
  return repoStoryCards().filter((card) => !taken.has(card.slug));
}

const newestFirst = (a: PostCard, b: PostCard) =>
  b.publishedAt.getTime() - a.publishedAt.getTime();

export async function listPublishedPosts(
  ctx: PublicReadContext,
  input?: { kind?: PostKind }
): Promise<PostCard[]> {
  await authorize(ctx, "cms.post.read_published");
  const { kind } = listInput.parse(input) ?? {};
  const rows = await publicRows(ctx, kind ? eq(cmsPost.kind, kind) : undefined);
  return [...rows.map(cardOf), ...(await repoCards(ctx, kind))].toSorted(
    newestFirst
  );
}

export async function latestPublishedPosts(
  ctx: PublicReadContext,
  input: { limit: number }
): Promise<PostCard[]> {
  await authorize(ctx, "cms.post.read_published");
  const { limit } = limitInput.parse(input);
  const rows = await publicRows(ctx);
  return latestPosts([...rows.map(cardOf), ...(await repoCards(ctx))], limit);
}

export async function getPublishedPostBySlug(
  ctx: PublicReadContext,
  input: { slug: string }
): Promise<PostView | null> {
  await authorize(ctx, "cms.post.read_published");
  const { slug } = slugInput.parse(input);
  const [row] = await publicRows(ctx, eq(cmsPost.slug, slug));
  if (row) return viewOf(row);
  // A post at the address that isn't public hides the repo story too.
  return (await cmsSlugs(ctx)).has(slug) ? null : repoStoryView(slug);
}

export async function publishedPostSlugs(
  ctx: PublicReadContext
): Promise<string[]> {
  await authorize(ctx, "cms.post.read_published");
  const rows = await publicRows(ctx);
  const repo = await repoCards(ctx);
  return [...rows, ...repo].map((post) => post.slug);
}
