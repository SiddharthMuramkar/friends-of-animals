// What a visitor sees of the blog (#112b): published posts and scheduled
// posts whose instant has come, never a draft, an archived post or one
// still waiting for its instant. Driven through the editors' use cases, so
// every post got to its status the way the admin pages put it there.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { cmsPost } from "@/server/db/schema";

import {
  blogPostingJsonLd,
  postMetadata,
} from "@/server/modules/cms/domain/post-seo";
import { createHarness, TEST_FILES, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

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

const REPO_STORIES = [
  "rukmini-devi-and-indias-animal-law",
  "a-drawing-that-feeds-tiny-guests",
  "the-stork-that-gets-a-baby-shower",
  "two-pilots-two-puppies",
  "kinder-skies-in-kite-season",
];

describe("the repo stories", () => {
  it("stay on the site until the CMS has a post at their address", async () => {
    const h = await createHarness();
    const visitor = h.as(h.visitor());

    expect((await visitor.publishedPostSlugs()).toSorted()).toEqual(
      REPO_STORIES.toSorted()
    );
    expect(
      (await visitor.getPublishedPostBySlug({ slug: "two-pilots-two-puppies" }))
        ?.title
    ).toBe("Two pilots, two puppies and the start of Blue Cross");

    // A draft at a story's address takes it down until it is published.
    const editor = await contentManager(h);
    const postId = await draft(h, editor, "two-pilots-two-puppies", {
      title: "Two pilots, as the CMS tells it",
    });
    expect(await visitor.publishedPostSlugs()).not.toContain(
      "two-pilots-two-puppies"
    );
    expect(
      await visitor.getPublishedPostBySlug({ slug: "two-pilots-two-puppies" })
    ).toBeNull();

    expect(await h.as(editor).publishPost({ postId })).toMatchObject({
      ok: true,
    });
    expect(
      (await visitor.getPublishedPostBySlug({ slug: "two-pilots-two-puppies" }))
        ?.title
    ).toBe("Two pilots, as the CMS tells it");
    expect(
      slugsOf(await visitor.listPublishedPosts()).filter(
        (slug) => slug === "two-pilots-two-puppies"
      )
    ).toHaveLength(1);
  });

  it("are stories, not blog posts", async () => {
    const h = await createHarness();
    const visitor = h.as(h.visitor());

    expect(await visitor.listPublishedPosts({ kind: "blog" })).toEqual([]);
    expect(
      slugsOf(await visitor.listPublishedPosts({ kind: "story" })).toSorted()
    ).toEqual(REPO_STORIES.toSorted());
  });
});

describe("latestPublishedPosts", () => {
  it("lists featured posts first, then the newest", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);
    await published(h, editor, "older-but-featured", { featured: true });
    h.clock.advance({ hours: 1 });
    await published(h, editor, "in-between");
    h.clock.advance({ hours: 1 });
    await published(h, editor, "the-newest");

    const latest = await h.as(h.visitor()).latestPublishedPosts({ limit: 3 });

    // The featured repo story (18 Nov 2026) is older than every CMS post.
    expect(slugsOf(latest)).toEqual([
      "older-but-featured",
      "rukmini-devi-and-indias-animal-law",
      "the-newest",
    ]);
  });
});

describe("who may read public posts", () => {
  it("is everyone: a visitor, a member and a content manager", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);
    await published(h, editor, "for-everyone");
    const member = await h.signIn(await h.seed.member());

    for (const actor of [h.visitor(), member, editor]) {
      const reads = h.as(actor);
      expect(await reads.publishedPostSlugs()).toContain("for-everyone");
      expect(slugsOf(await reads.listPublishedPosts())).toContain(
        "for-everyone"
      );
      expect(slugsOf(await reads.latestPublishedPosts({ limit: 3 }))).toContain(
        "for-everyone"
      );
      expect(
        (await reads.getPublishedPostBySlug({ slug: "for-everyone" }))?.slug
      ).toBe("for-everyone");
    }
  });
});

/** Uploads a JPEG for the post and waits for its public copies. */
async function uploadedImage(
  h: Harness,
  editor: Editor,
  postId: string,
  alt: string
) {
  const jpeg = readMediaFixture("gpsJpeg");
  const requested = await h.as(editor).uploadPostImage({
    postId,
    contentType: "image/jpeg",
    sizeBytes: jpeg.length,
    alt,
  });
  if (!requested.ok) throw new Error(JSON.stringify(requested));
  const stored = await h.storage.put(
    requested.uploadUrl,
    jpeg,
    requested.headers
  );
  if (!stored.ok) throw new Error(`not stored: ${stored.error}`);
  const completed = await h
    .as(editor)
    .completeUpload({ fileId: requested.fileId });
  if (!completed.ok) throw new Error(JSON.stringify(completed));
  await h.drain();
  return requested;
}

/** Every string in `value` that looks like a URL or a storage key. */
function urlsIn(value: unknown): string[] {
  const json = JSON.stringify(value);
  return [...json.matchAll(/"((?:https?:\/\/|\/|local\/)[^"]*)"/g)].map(
    (match) => match[1]!
  );
}

describe("a post's uploaded images, publicly", () => {
  it("show only through their public copies, never the original upload", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);
    const postId = await draft(h, editor, "kite-season");
    const cover = await uploadedImage(h, editor, postId, "A kite over a roof");
    const inline = await uploadedImage(h, editor, postId, "Volunteers");
    const updated = await h.as(editor).updatePost({
      postId,
      kind: "blog",
      title: "Kinder skies in kite season",
      slug: "kite-season",
      excerpt: "Gujarat ran bird-care points.",
      body: {
        blocks: [
          { type: "paragraph", text: ["Birds first."] },
          { type: "image", postImageId: inline.postImageId, caption: "Help" },
        ],
        footnotes: [],
      },
      cover: { postImageId: cover.postImageId },
    });
    if (!updated.ok) throw new Error(JSON.stringify(updated));
    expect(await h.as(editor).publishPost({ postId })).toMatchObject({
      ok: true,
    });

    const visitor = h.as(h.visitor());
    const post = await visitor.getPublishedPostBySlug({ slug: "kite-season" });
    const publicBase = `${TEST_FILES.publicBaseUrl}local/public/cms_image/`;

    expect(post?.cover).toEqual({
      source: "public",
      url: `${publicBase}${cover.fileId}/post_cover_1200.webp`,
      width: 1200,
      height: 900,
      alt: "A kite over a roof",
    });
    expect(post?.body.blocks[1]).toEqual({
      type: "image",
      image: {
        source: "public",
        url: `${publicBase}${inline.fileId}/post_inline_960.webp`,
        width: 960,
        height: 720,
        alt: "Volunteers",
      },
      caption: "Help",
    });
    const [card] = (await visitor.listPublishedPosts()).filter(
      (c) => c.slug === "kite-season"
    );
    expect(card?.cover).toEqual(post?.cover);

    const shown = [
      post,
      card,
      blogPostingJsonLd(post!, new URL("https://foa.example.test")),
      postMetadata(post!),
    ];
    const images = urlsIn(shown).filter((url) => url.includes("cms_image"));
    expect(images.length).toBeGreaterThanOrEqual(4);
    for (const url of images)
      expect(url.startsWith(publicBase), url).toBe(true);
    for (const fileId of [cover.fileId, inline.fileId]) {
      expect(JSON.stringify(shown)).not.toContain(`local/cms_image/${fileId}`);
    }
    expect(JSON.stringify(shown)).not.toContain(TEST_FILES.bucket + "/");
  });

  it("are left out while their public copies don't exist", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);
    const postId = await published(h, editor, "no-copies-yet");
    // An image whose copies aren't made yet can't go live, so it reaches a
    // public body only through a stored body (a row edited by hand).
    const requested = await h.as(editor).uploadPostImage({
      postId,
      contentType: "image/jpeg",
      sizeBytes: 100,
      alt: "Not ready",
    });
    if (!requested.ok) throw new Error(JSON.stringify(requested));
    await h.db
      .update(cmsPost)
      .set({
        body: {
          blocks: [
            { type: "paragraph", text: ["Words."] },
            { type: "image", postImageId: requested.postImageId },
          ],
          footnotes: [],
        },
        coverImageId: requested.postImageId,
      })
      .where(eq(cmsPost.id, postId));

    const post = await h
      .as(h.visitor())
      .getPublishedPostBySlug({ slug: "no-copies-yet" });

    expect(post?.cover).toBeNull();
    expect(post?.body.blocks).toEqual([
      { type: "paragraph", text: ["Words."] },
    ]);
  });
});

describe("fresh without a deploy", () => {
  it("a hand publish hands the Server Action the tags the public reads are cached under", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);
    const postId = await draft(h, editor, "kite-season");

    expect(await h.as(editor).publishPost({ postId })).toMatchObject({
      ok: true,
      tags: ["posts", "post:kite-season"],
    });
  });

  it("the reads know when the next scheduled post goes live, so they expire then", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);
    const visitor = h.as(h.visitor());
    expect(await visitor.nextPostGoingLive()).toBeNull();

    const soon = new Date(h.clock.now().getTime() + 60 * MINUTE);
    const later = new Date(h.clock.now().getTime() + 2 * DAY);
    await scheduled(h, editor, "later", later);
    await scheduled(h, editor, "soon", soon);
    await draft(h, editor, "never");
    expect(await visitor.nextPostGoingLive()).toEqual(soon);

    h.clock.set(soon);
    expect(await visitor.publishedPostSlugs()).toContain("soon");
    expect(await visitor.nextPostGoingLive()).toEqual(later);
  });
});
