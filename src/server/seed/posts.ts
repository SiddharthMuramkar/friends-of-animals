// Posts seed data (#112): one draft, one scheduled and one published blog
// post, so a preview shows every state of the blog's admin screens and the
// public blog has something to list. No uploaded images: previews have no
// public bucket yet (HR-06), so the published post uses a photo from the
// site's library and the others show the tile pattern. The scheduled post
// is due a week after seeding, with its publish delivery saved as
// schedulePost saves it. Seed data, not a staff action: no audit entry. A
// post whose address exists is left alone, so seeding again changes
// nothing. Loads under plain Node (the seed script): relative imports only.

import { cmsPost } from "../db/schema";
import { uuidv7 } from "../ids";
import type { PostStatus } from "../modules/cms/domain/post-status";
import { emit } from "../outbox/emit";
import type { PostBody } from "../rich-text/post-body";
import type { SeedDeps } from "./types";

const DAY = 24 * 60 * 60_000;

type SeedPost = {
  slug: string;
  title: string;
  excerpt: string;
  status: Exclude<PostStatus, "archived">;
  coverSiteImageId?: string;
  body: PostBody;
};

const SEED_POSTS: readonly SeedPost[] = [
  {
    slug: "kinder-skies-results",
    title: "Kinder Skies: what 1,200 children drew",
    excerpt:
      "Schools across Gujarat sent in drawings of birds and kites. Here is what the judges saw.",
    status: "published",
    coverSiteImageId: "dog-bengaluru-auto-rickshaw",
    body: {
      blocks: [
        {
          type: "paragraph",
          text: [
            "This is sample content for previews. Children drew birds, kites and the people who help them.",
          ],
        },
        { type: "heading", level: 2, text: "What the judges looked for" },
        {
          type: "list",
          style: "bullet",
          items: [["Kindness to animals"], ["Care in the drawing"]],
        },
      ],
      footnotes: [],
    },
  },
  {
    slug: "a-bowl-of-water-this-summer",
    title: "A bowl of water this summer",
    excerpt:
      "Sample content for previews: how a bowl of water on a step helps birds and street dogs.",
    status: "scheduled",
    body: {
      blocks: [
        {
          type: "paragraph",
          text: ["This is sample content for previews, scheduled a week out."],
        },
      ],
      footnotes: [],
    },
  },
  {
    slug: "volunteer-week-draft",
    title: "Volunteer week (draft)",
    excerpt: "Sample content for previews: a draft nobody outside staff sees.",
    status: "draft",
    body: {
      blocks: [
        {
          type: "paragraph",
          text: ["This is a sample draft for previews."],
        },
      ],
      footnotes: [],
    },
  },
];

export async function seedPosts({ db, clock }: SeedDeps): Promise<void> {
  const now = clock.now();
  await db.transaction(async (tx) => {
    for (const post of SEED_POSTS) {
      const publishAt =
        post.status === "scheduled" ? new Date(now.getTime() + 7 * DAY) : null;
      const inserted = await tx
        .insert(cmsPost)
        .values({
          id: uuidv7(now),
          slug: post.slug,
          kind: "blog",
          title: post.title,
          excerpt: post.excerpt,
          body: post.body,
          coverSiteImageId: post.coverSiteImageId ?? null,
          status: post.status,
          publishAt,
          publishedAt: post.status === "published" ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: cmsPost.slug })
        .returning({ id: cmsPost.id });
      const [row] = inserted;
      if (!row || !publishAt) continue;
      await emit(
        tx,
        clock,
        {
          type: "cms.post_scheduled",
          aggregate: { type: "cms_post", id: row.id },
          payload: { postId: row.id, publishAt: publishAt.toISOString() },
        },
        { availableAt: publishAt }
      );
    }
  });
}
