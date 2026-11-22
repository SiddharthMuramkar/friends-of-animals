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
import { postImageIdsIn, sanitizePostBody } from "../../../rich-text/post-body";
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
import { publicCopiesOf, type PublicCopies } from "./public-images";
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

type Copies = ReadonlyMap<string, PublicCopies>;

function coverOf(row: CmsPost, copies: Copies): PostImage | null {
  if (row.coverImageId) return copies.get(row.coverImageId)?.cover ?? null;
  return isSiteImageId(row.coverSiteImageId)
    ? { source: "site", id: row.coverSiteImageId }
    : null;
}

function cardOf(row: CmsPost, copies: Copies): PostCard {
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
    cover: coverOf(row, copies),
    publishedAt: liveAt(row),
    updatedAt: row.updatedAt,
  };
}

/** The public copies of the covers of `rows` (and their bodies' images). */
function copiesFor(
  { db, files }: PublicReadContext,
  rows: readonly CmsPost[],
  { bodies = false }: { bodies?: boolean } = {}
): Promise<Map<string, PublicCopies>> {
  const ids = rows.flatMap((row) => [
    ...(row.coverImageId ? [row.coverImageId] : []),
    ...(bodies ? postImageIdsIn(sanitizePostBody(row.body)) : []),
  ]);
  return publicCopiesOf(db, files, ids);
}

async function cardsOf(
  ctx: PublicReadContext,
  rows: readonly CmsPost[]
): Promise<PostCard[]> {
  const copies = await copiesFor(ctx, rows);
  return rows.map((row) => cardOf(row, copies));
}

async function viewOf(ctx: PublicReadContext, row: CmsPost): Promise<PostView> {
  const copies = await copiesFor(ctx, [row], { bodies: true });
  const inline = new Map(
    [...copies].flatMap(([id, copy]) =>
      copy.inline ? [[id, copy.inline] as const] : []
    )
  );
  return {
    ...cardOf(row, copies),
    easyRead: row.easyRead,
    authorName: row.authorName,
    body: postBodyView(sanitizePostBody(row.body), inline),
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
  return [
    ...(await cardsOf(ctx, rows)),
    ...(await repoCards(ctx, kind)),
  ].toSorted(newestFirst);
}

export async function latestPublishedPosts(
  ctx: PublicReadContext,
  input: { limit: number }
): Promise<PostCard[]> {
  await authorize(ctx, "cms.post.read_published");
  const { limit } = limitInput.parse(input);
  const rows = await publicRows(ctx);
  return latestPosts(
    [...(await cardsOf(ctx, rows)), ...(await repoCards(ctx))],
    limit
  );
}

export async function getPublishedPostBySlug(
  ctx: PublicReadContext,
  input: { slug: string }
): Promise<PostView | null> {
  await authorize(ctx, "cms.post.read_published");
  const { slug } = slugInput.parse(input);
  const [row] = await publicRows(ctx, eq(cmsPost.slug, slug));
  if (row) return viewOf(ctx, row);
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
