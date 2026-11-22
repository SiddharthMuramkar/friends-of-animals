// The five stories written in the repo become published `story` posts in
// the CMS (#112b), so content managers can edit them and the public blog
// reads them like any post. Imported however often the seed runs.

import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  getStory,
  loadArticle,
  STORY_SLUGS,
  type StorySlug,
} from "@/content/stories";
import { tableOfContents } from "@/content/stories/text";
import { cmsPost } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { importRepoStories } from "./posts-import";

describe("importRepoStories", () => {
  it("makes each repo story a published story post, once, however often it runs", async () => {
    const h = await createHarness();
    await importRepoStories(h.deps);
    h.clock.advance({ days: 1 });
    await importRepoStories(h.deps);

    const rows = await h.db
      .select()
      .from(cmsPost)
      .where(eq(cmsPost.kind, "story"));
    expect(rows.map((row) => row.slug).toSorted()).toEqual(
      [...STORY_SLUGS].toSorted()
    );
    const [all] = await h.db.select({ n: count() }).from(cmsPost);
    expect(all?.n).toBe(5);

    const kite = rows.find((row) => row.slug === "kinder-skies-in-kite-season");
    expect(kite).toMatchObject({
      kind: "story",
      status: "published",
      title: "Kinder skies in kite season",
      excerpt: getStory("kinder-skies-in-kite-season").dek,
      audience: getStory("kinder-skies-in-kite-season").audience,
      featured: false,
      authorName: null,
      coverImageId: null,
      // Published on 18 November 2026, a day in India: 00:00 IST.
      publishedAt: new Date("2026-11-17T18:30:00.000Z"),
      publishAt: null,
    });
    for (const row of rows) {
      const story = getStory(row.slug as StorySlug);
      expect(row, row.slug).toMatchObject({
        title: story.title,
        seoTitle: story.seoTitle ?? null,
        excerpt: story.dek,
        easyRead: story.easyRead,
        audience: story.audience,
        topics: [...story.topics],
        featured: story.featured,
        coverSiteImageId: story.coverImageId ?? null,
      });
    }
  });

  it("keeps every story's headings, footnotes and photos as the repo has them", async () => {
    const h = await createHarness();
    await importRepoStories(h.deps);
    const visitor = h.as(h.visitor());

    for (const slug of STORY_SLUGS) {
      const article = await loadArticle(slug);
      const post = await visitor.getPublishedPostBySlug({ slug });

      expect(tableOfContents(post!.body.blocks), slug).toEqual(
        tableOfContents(article.blocks)
      );
      expect(post!.body.footnotes, slug).toEqual(article.footnotes);
      expect(
        post!.body.blocks.flatMap((block) =>
          block.type === "image" ? [block.image] : []
        ),
        slug
      ).toEqual(
        article.blocks.flatMap((block) =>
          block.type === "image" ? [{ source: "site", id: block.imageId }] : []
        )
      );
      expect(post!.body.blocks.length, slug).toBe(article.blocks.length);
    }
  });

  it("leaves a post already at a story's address alone", async () => {
    const h = await createHarness();
    await importRepoStories(h.deps);
    await h.db
      .update(cmsPost)
      .set({ title: "Edited by a content manager" })
      .where(eq(cmsPost.slug, "two-pilots-two-puppies"));

    await importRepoStories(h.deps);

    const [row] = await h.db
      .select({ title: cmsPost.title })
      .from(cmsPost)
      .where(eq(cmsPost.slug, "two-pilots-two-puppies"));
    expect(row?.title).toBe("Edited by a content manager");
  });
});
