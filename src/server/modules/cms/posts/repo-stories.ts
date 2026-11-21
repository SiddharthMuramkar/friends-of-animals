// The five stories written in the repo (src/content/stories), as public
// posts. Two readers: the cached loaders, when there is no database to read
// (`next build`, a local run without DATABASE_URL), and `importRepoStories`,
// which copies them into the CMS. So the site shows the same thing either
// way. Repo articles use site photos only, so every image is a site image.

import {
  getStory,
  isStorySlug,
  loadArticle,
  STORIES,
  type Story,
} from "@/content/stories";
import type {
  PostCard,
  PostImage,
  PostView,
} from "@/server/modules/cms/domain/post-view";

/** A repo story's date is a day in India: it went live at 00:00 IST. */
export function repoStoryPublishedAt(story: Story): Date {
  return new Date(`${story.publishedOn}T00:00:00+05:30`);
}

function siteCover(story: Story): PostImage | null {
  return story.coverImageId ? { source: "site", id: story.coverImageId } : null;
}

function card(story: Story): PostCard {
  const publishedAt = repoStoryPublishedAt(story);
  return {
    slug: story.slug,
    kind: "story",
    title: story.title,
    seoTitle: story.seoTitle ?? null,
    excerpt: story.dek,
    audience: story.audience,
    topics: [...story.topics],
    featured: story.featured,
    readingMinutes: story.readingMinutes,
    cover: siteCover(story),
    publishedAt,
    updatedAt: publishedAt,
  };
}

/** Every repo story's card, in registry order. */
export function repoStoryCards(): PostCard[] {
  return STORIES.map(card);
}

/** A repo story as a whole post, or null for any other slug. */
export async function repoStoryView(slug: string): Promise<PostView | null> {
  if (!isStorySlug(slug)) return null;
  const story = getStory(slug);
  const article = await loadArticle(slug);
  return {
    ...card(story),
    easyRead: story.easyRead,
    authorName: null,
    body: {
      blocks: article.blocks.map((block) =>
        block.type === "image"
          ? {
              type: "image",
              image: { source: "site", id: block.imageId },
              caption: block.caption,
            }
          : block
      ),
      footnotes: article.footnotes,
    },
  };
}
