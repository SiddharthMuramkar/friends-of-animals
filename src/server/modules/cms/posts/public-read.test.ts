// What a visitor sees of the blog (#112b): published posts and scheduled
// posts whose instant has come, never a draft, an archived post or one
// still waiting for its instant. Driven through the editors' use cases, so
// every post got to its status the way the admin pages put it there.

import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

const global = { type: "global" } as const;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

type Editor = Awaited<ReturnType<typeof contentManager>>;

/** A draft at `slug`, ready to go live; returns its id. */
async function draft(
  h: Harness,
  editor: Editor,
  slug: string,
  fields: { featured?: boolean; title?: string } = {}
) {
  const created = await h.as(editor).createPost({
    kind: "blog",
    title: fields.title ?? `Post ${slug}`,
    slug,
    excerpt: `What ${slug} is about.`,
    featured: fields.featured ?? false,
    body: {
      blocks: [{ type: "paragraph", text: [`The body of ${slug}.`] }],
      footnotes: [],
    },
  });
  if (!created.ok) throw new Error(JSON.stringify(created));
  return created.postId;
}

async function published(
  h: Harness,
  editor: Editor,
  slug: string,
  fields: { featured?: boolean } = {}
) {
  const postId = await draft(h, editor, slug, fields);
  const done = await h.as(editor).publishPost({ postId });
  if (!done.ok) throw new Error(JSON.stringify(done));
  return postId;
}

async function scheduled(h: Harness, editor: Editor, slug: string, at: Date) {
  const postId = await draft(h, editor, slug);
  const done = await h.as(editor).schedulePost({ postId, publishAt: at });
  if (!done.ok) throw new Error(JSON.stringify(done));
  return postId;
}

/** One post in every status, and a scheduled one whose instant has come. */
async function onePerStatus(h: Harness) {
  const editor = await contentManager(h);
  await draft(h, editor, "a-draft");
  await published(h, editor, "a-published-post");
  const archivedId = await published(h, editor, "an-archived-post");
  const archived = await h.as(editor).archivePost({ postId: archivedId });
  if (!archived.ok) throw new Error(JSON.stringify(archived));
  await scheduled(
    h,
    editor,
    "due-now",
    new Date(h.clock.now().getTime() + MINUTE)
  );
  await scheduled(
    h,
    editor,
    "next-week",
    new Date(h.clock.now().getTime() + 7 * DAY)
  );
  // The first scheduled post's instant passes; its job hasn't run yet.
  h.clock.advance({ minutes: 2 });
  return editor;
}

const PUBLIC = ["a-published-post", "due-now"];
const HIDDEN = ["a-draft", "an-archived-post", "next-week"];

const slugsOf = (posts: readonly { slug: string }[]) =>
  posts.map((post) => post.slug);

describe("the public read of posts", () => {
  it("shows a visitor published posts and due scheduled posts, and nothing else", async () => {
    const h = await createHarness();
    await onePerStatus(h);
    const visitor = h.as(h.visitor());

    const listed = slugsOf(await visitor.listPublishedPosts());
    const latest = slugsOf(await visitor.latestPublishedPosts({ limit: 20 }));
    const slugs = await visitor.publishedPostSlugs();

    for (const read of [listed, latest, slugs]) {
      expect(read).toEqual(expect.arrayContaining(PUBLIC));
      for (const slug of HIDDEN) expect(read).not.toContain(slug);
    }
    for (const slug of PUBLIC) {
      expect((await visitor.getPublishedPostBySlug({ slug }))?.slug, slug).toBe(
        slug
      );
    }
    for (const slug of [...HIDDEN, "no-such-post"]) {
      expect(await visitor.getPublishedPostBySlug({ slug }), slug).toBeNull();
    }
  });
});
