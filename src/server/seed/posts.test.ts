import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { cmsPost, cmsPostImage } from "@/server/db/schema";
import { publicPostFilter } from "@/server/modules/cms/posts/public-filter";
import { createHarness, type Harness } from "@/test/harness";

const DAY = 24 * 60 * 60_000;

async function contentManager(h: Harness) {
  const account = await h.seed.member();
  await h.seed.grant(account, {
    role: "content_manager",
    scope: { type: "global" },
  });
  return h.signIn(account);
}

async function publicSlugs(h: Harness) {
  const rows = await h.db
    .select({ slug: cmsPost.slug })
    .from(cmsPost)
    .where(publicPostFilter(h.clock.now()));
  return rows.map((row) => row.slug);
}

describe("the posts seed", () => {
  it("leaves one draft, one scheduled and one published blog post, however often it runs", async () => {
    const h = await createHarness();
    const seededAt = h.clock.now();
    await h.seed.preview();
    h.clock.advance({ minutes: 5 });
    await h.seed.preview();
    const actor = await contentManager(h);

    const posts = await h.as(actor).listPosts();

    expect(
      posts
        .map(({ status, kind, publishAt }) => ({ status, kind, publishAt }))
        .sort((a, b) => a.status.localeCompare(b.status))
    ).toEqual([
      { status: "draft", kind: "blog", publishAt: null },
      { status: "published", kind: "blog", publishAt: null },
      {
        status: "scheduled",
        kind: "blog",
        publishAt: new Date(seededAt.getTime() + 7 * DAY),
      },
    ]);
    const [images] = await h.db.select({ n: count() }).from(cmsPostImage);
    expect(images?.n).toBe(0);
    expect(await publicSlugs(h)).toHaveLength(1);
  });

  it("puts the scheduled post live a week after seeding", async () => {
    const h = await createHarness();
    await h.seed.preview();

    h.clock.advance({ days: 7 });
    await h.drain();

    expect(await publicSlugs(h)).toHaveLength(2);
  });

  it("seeds posts ready to go live, with bodies the sanitiser leaves alone", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const actor = await contentManager(h);

    for (const summary of await h.as(actor).listPosts()) {
      const found = await h.as(actor).getPostForEdit({ postId: summary.id });
      if (!found.ok) throw new Error(found.error);
      const [row] = (
        await h.db.select({ id: cmsPost.id, body: cmsPost.body }).from(cmsPost)
      ).filter((post) => post.id === summary.id);
      expect(found.post.body, summary.slug).toEqual(row?.body);
      expect(found.post.body.blocks.length).toBeGreaterThan(0);
      expect(found.post.excerpt.length).toBeGreaterThan(0);
    }
  });
});
