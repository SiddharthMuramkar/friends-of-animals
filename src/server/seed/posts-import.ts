// The five stories written in the repo (src/content/stories) as published
// `story` posts in the CMS (#112b), so content managers edit them like any
// post and the public blog reads them from the CMS. Each keeps its address,
// title, search title, dek, Easy Read, audience, topics, featured flag,
// site-photo cover and body (headings, footnotes and photos as written),
// and is dated 00:00 IST on its publish day. A post already at a story's
// address is left alone, so importing again, or after a content manager
// edited or archived it, changes nothing.
//
// A seed step: production is never seeded, so there the repo stories stay
// on the public site until a post takes their address (../modules/cms/
// posts/public-read.ts). Seed data, not a staff action: no audit entry.

import {
  getStory,
  loadArticle,
  STORY_SLUGS,
  type ArticleBody,
} from "../../content/stories";
import { cmsPost } from "../db/schema";
import { uuidv7 } from "../ids";
import { repoStoryPublishedAt } from "../modules/cms/posts/repo-stories";
import { sanitizePostBody, type PostBody } from "../rich-text/post-body";
import type { SeedDeps } from "./types";

/** A repo article in the post profile: photos named by site image id. */
function postBodyOf(article: ArticleBody): PostBody {
  return sanitizePostBody({
    blocks: article.blocks.map((block) =>
      block.type === "image"
        ? {
            type: "image",
            siteImageId: block.imageId,
            ...(block.caption ? { caption: block.caption } : {}),
          }
        : block
    ),
    footnotes: article.footnotes,
  });
}

export async function importRepoStories({
  db,
  clock,
}: Pick<SeedDeps, "db" | "clock">): Promise<void> {
  const now = clock.now();
  for (const slug of STORY_SLUGS) {
    const story = getStory(slug);
    const publishedAt = repoStoryPublishedAt(story);
    await db
      .insert(cmsPost)
      .values({
        id: uuidv7(now),
        slug,
        kind: "story",
        title: story.title,
        seoTitle: story.seoTitle ?? null,
        excerpt: story.dek,
        easyRead: story.easyRead,
        audience: story.audience,
        topics: [...story.topics],
        featured: story.featured,
        body: postBodyOf(await loadArticle(slug)),
        coverSiteImageId: story.coverImageId ?? null,
        status: "published",
        publishedAt,
        // Dated as the story is, so the sitemap's lastModified stays true.
        createdAt: publishedAt,
        updatedAt: publishedAt,
      })
      .onConflictDoNothing({ target: cmsPost.slug });
  }
}
