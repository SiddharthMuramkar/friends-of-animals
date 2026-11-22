// A post's images (#112): uploaded privately, shown publicly only through
// resized copies in the public bucket, and named in a post only by their
// id. Driven through a real upload with the storage, scanner and media
// fakes and `h.drain()`.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { cmsPost, cmsPostImage, fileDerivative } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, TEST_FILES, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";
import { webpSize } from "@/test/webp";

const JPEG = readMediaFixture("gpsJpeg");
const PUBLIC_BUCKET = "foa-files-test-public";
const global = { type: "global" } as const;

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

type Actor = Awaited<ReturnType<typeof contentManager>>;

async function draft(h: Harness, actor: Actor, slug = "kite-season") {
  const created = await h.as(actor).createPost({
    kind: "blog",
    title: "Kinder skies in kite season",
    slug,
    excerpt: "Gujarat ran bird-care points.",
    body: { blocks: [], footnotes: [] },
  });
  if (!created.ok) throw new Error(JSON.stringify(created));
  return created.postId;
}

/** Uploads `bytes` as an image of the post, as the editor's browser does. */
async function uploadImage(
  h: Harness,
  actor: Actor,
  postId: string,
  bytes: Uint8Array = JPEG,
  alt = "A kite over a rooftop"
) {
  const requested = await h.as(actor).uploadPostImage({
    postId,
    contentType: "image/jpeg",
    sizeBytes: bytes.length,
    alt,
  });
  if (!requested.ok) throw new Error(JSON.stringify(requested));
  const stored = await h.storage.put(
    requested.uploadUrl,
    bytes,
    requested.headers
  );
  if (!stored.ok) throw new Error(`not stored: ${stored.error}`);
  const completed = await h
    .as(actor)
    .completeUpload({ fileId: requested.fileId });
  if (!completed.ok) throw new Error(JSON.stringify(completed));
  return requested;
}

/**
 * Uploads an image with alt text, waits for its public copies and makes it
 * the post's cover: a post ready to go live. Returns the image's id.
 */
async function coverPost(h: Harness, actor: Actor, postId: string) {
  const { postImageId } = await uploadImage(h, actor, postId);
  await h.drain();
  const updated = await h.as(actor).updatePost({
    postId,
    kind: "blog",
    title: "Kinder skies in kite season",
    slug: "kite-season",
    excerpt: "Gujarat ran bird-care points.",
    body: { blocks: [], footnotes: [] },
    cover: { postImageId },
  });
  if (!updated.ok) throw new Error(JSON.stringify(updated));
  return postImageId;
}

async function altOf(h: Harness, postImageId: string) {
  const [row] = await h.db
    .select({ alt: cmsPostImage.alt })
    .from(cmsPostImage)
    .where(eq(cmsPostImage.id, postImageId));
  return row?.alt;
}

/** What going live refuses for a cover without alt text. */
const COVER_ALT_REQUIRED = {
  ok: false,
  error: "invalid_input",
  fields: ["coverAlt"],
  errors: { coverAlt: "required" },
};

async function readBytes(h: Harness, bucket: string, key: string) {
  const stream = await h.storage.read({ bucket, key });
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("uploadPostImage", () => {
  it("publishes only resized copies, and keeps the original private", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);

    const { fileId, postImageId } = await uploadImage(h, actor, postId);
    await h.drain();

    const original = `local/cms_image/${fileId}`;
    const publicKeys = h.storage.keys(PUBLIC_BUCKET);
    expect(publicKeys).toEqual([
      `local/public/cms_image/${fileId}/post_cover_1200.webp`,
      `local/public/cms_image/${fileId}/post_inline_960.webp`,
    ]);
    for (const key of publicKeys) expect(key).not.toContain(original);
    expect(h.storage.keys(TEST_FILES.bucket)).toContain(original);
    expect(
      await h.storage.head({ bucket: PUBLIC_BUCKET, key: original })
    ).toBeNull();
    expect(webpSize(await readBytes(h, PUBLIC_BUCKET, publicKeys[0]!))).toEqual(
      { width: 1200, height: 900 }
    );
    expect(webpSize(await readBytes(h, PUBLIC_BUCKET, publicKeys[1]!))).toEqual(
      { width: 960, height: 720 }
    );
    expect(
      await h.storage.head({ bucket: PUBLIC_BUCKET, key: publicKeys[0]! })
    ).toMatchObject({ contentType: "image/webp" });

    const [image] = await h.db
      .select()
      .from(cmsPostImage)
      .where(eq(cmsPostImage.id, postImageId));
    expect(image).toMatchObject({
      postId,
      fileAssetId: fileId,
      alt: "A kite over a rooftop",
      publicAt: h.clock.now(),
    });
    expect(await h.as(actor).getPostForEdit({ postId })).toMatchObject({
      post: {
        images: [
          {
            id: postImageId,
            fileId,
            alt: "A kite over a rooftop",
            ready: true,
          },
        ],
      },
    });
  });

  it("never publishes a copy of an upload the scan flagged", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);

    const { postImageId, fileId } = await uploadImage(
      h,
      actor,
      postId,
      EICAR_TEST_BYTES
    );
    await h.drain();

    expect(h.storage.keys(PUBLIC_BUCKET)).toEqual([]);
    expect(
      await h.db
        .select()
        .from(fileDerivative)
        .where(eq(fileDerivative.fileAssetId, fileId))
    ).toEqual([]);
    expect(await h.as(actor).getPostForEdit({ postId })).toMatchObject({
      post: { images: [{ id: postImageId, ready: false }] },
    });
  });

  it("is not ready until its copies are made", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);

    const { postImageId } = await uploadImage(h, actor, postId);

    expect(await h.as(actor).getPostForEdit({ postId })).toMatchObject({
      post: { images: [{ id: postImageId, ready: false }] },
    });
    expect(h.storage.keys(PUBLIC_BUCKET)).toEqual([]);
  });

  it("refuses a type posts don't take, or a post that doesn't exist", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);

    expect(
      await h.as(actor).uploadPostImage({
        postId,
        contentType: "application/pdf",
        sizeBytes: 1000,
      })
    ).toEqual({ ok: false, error: "type_not_allowed" });
    expect(
      await h.as(actor).uploadPostImage({
        postId: uuidv7(h.clock.now()),
        contentType: "image/jpeg",
        sizeBytes: 1000,
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await h.db.select().from(cmsPostImage)).toEqual([]);
  });

  it("leaves an archived post's images alone until it is restored", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const { postImageId } = await uploadImage(h, actor, postId);
    await h.as(actor).publishPost({ postId });
    await h.as(actor).archivePost({ postId });

    expect(
      await h.as(actor).uploadPostImage({
        postId,
        contentType: "image/jpeg",
        sizeBytes: 1000,
      })
    ).toEqual({ ok: false, error: "archived" });
    expect(
      await h.as(actor).describePostImage({ postImageId, alt: "Changed" })
    ).toEqual({ ok: false, error: "archived" });
    expect(await h.db.select().from(cmsPostImage)).toMatchObject([
      { id: postImageId, alt: "A kite over a rooftop" },
    ]);
  });

  it("can't be sidestepped by uploading a post image through the Files module", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    expect(
      await h.as(member).requestUpload({
        purpose: "cms_image",
        contentType: "image/jpeg",
        sizeBytes: JPEG.length,
      })
    ).toEqual({ ok: false, error: "purpose_unavailable" });
  });
});

describe("describePostImage", () => {
  it("changes an image's alt text, within its limit", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const { postImageId } = await uploadImage(h, actor, postId, JPEG, "");

    expect(
      await h.as(actor).describePostImage({
        postImageId,
        alt: "Volunteers <b>untangle</b> a kite",
      })
    ).toEqual({ ok: true, tags: [] });
    expect(
      await h.as(actor).describePostImage({ postImageId, alt: "a".repeat(201) })
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["alt"],
      errors: { alt: "too_long" },
    });
    expect(
      await h.as(actor).describePostImage({
        postImageId: uuidv7(h.clock.now()),
        alt: "Anything",
      })
    ).toEqual({ ok: false, error: "not_found" });

    expect(await h.as(actor).getPostForEdit({ postId })).toMatchObject({
      post: {
        images: [{ id: postImageId, alt: "Volunteers untangle a kite" }],
      },
    });
  });

  it("keeps a published post's cover described, and returns the tags to refresh", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const cover = await coverPost(h, actor, postId);
    expect(await h.as(actor).publishPost({ postId })).toMatchObject({
      ok: true,
    });

    expect(
      await h.as(actor).describePostImage({ postImageId: cover, alt: " " })
    ).toEqual(COVER_ALT_REQUIRED);
    expect(await altOf(h, cover)).toBe("A kite over a rooftop");

    expect(
      await h
        .as(actor)
        .describePostImage({ postImageId: cover, alt: "Kites at dusk" })
    ).toEqual({ ok: true, tags: ["posts", "post:kite-season"] });
    expect(await altOf(h, cover)).toBe("Kites at dusk");
  });

  it("holds a scheduled post's cover to the same rule, so its job never puts it up without alt text", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const cover = await coverPost(h, actor, postId);
    const at = new Date(h.clock.now().getTime() + 60 * 60_000);
    expect(
      await h.as(actor).schedulePost({ postId, publishAt: at })
    ).toMatchObject({ ok: true });

    expect(
      await h.as(actor).describePostImage({ postImageId: cover, alt: "" })
    ).toEqual(COVER_ALT_REQUIRED);
    expect(
      await h
        .as(actor)
        .describePostImage({ postImageId: cover, alt: "Kites at dusk" })
    ).toEqual({ ok: true, tags: ["posts", "post:kite-season"] });

    h.clock.set(at);
    await h.drain();
    const [row] = await h.db
      .select({ status: cmsPost.status })
      .from(cmsPost)
      .where(eq(cmsPost.id, postId));
    expect(row).toEqual({ status: "published" });
    expect(await altOf(h, cover)).toBe("Kites at dusk");
  });
});

describe("images in a post", () => {
  it("names images by id only: an address or storage key sent with one is dropped", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const { postImageId } = await uploadImage(h, actor, postId);

    const updated = await h.as(actor).updatePost({
      postId,
      kind: "blog",
      title: "Kinder skies in kite season",
      slug: "kite-season",
      excerpt: "Gujarat ran bird-care points.",
      cover: { postImageId },
      body: {
        blocks: [
          {
            type: "image",
            postImageId,
            caption: "Volunteers at work",
            src: "https://evil.test/x.png",
            url: "https://evil.test/y.png",
            key: `local/cms_image/${postImageId}`,
          },
          {
            type: "image",
            siteImageId: "dog-bengaluru-auto-rickshaw",
            src: "https://evil.test/z.png",
          },
        ],
        footnotes: [],
      },
    });

    expect(updated).toEqual({ ok: true, tags: [] });
    const [row] = await h.db
      .select({ body: cmsPost.body, coverImageId: cmsPost.coverImageId })
      .from(cmsPost)
      .where(eq(cmsPost.id, postId));
    expect(row).toEqual({
      coverImageId: postImageId,
      body: {
        blocks: [
          { type: "image", postImageId, caption: "Volunteers at work" },
          { type: "image", siteImageId: "dog-bengaluru-auto-rickshaw" },
        ],
        footnotes: [],
      },
    });
  });

  it("refuses an image that isn't this post's, in the body or as the cover, and changes nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const otherPost = await draft(h, actor, "another-post");
    const { postImageId: othersImage } = await uploadImage(h, actor, otherPost);
    const fields = {
      kind: "blog",
      title: "Kinder skies in kite season",
      slug: "kite-season",
      excerpt: "Gujarat ran bird-care points.",
    } as const;

    for (const attempt of [
      {
        ...fields,
        body: {
          blocks: [{ type: "image", postImageId: othersImage }],
          footnotes: [],
        },
      },
      {
        ...fields,
        body: {
          blocks: [{ type: "image", postImageId: uuidv7(h.clock.now()) }],
          footnotes: [],
        },
      },
      {
        ...fields,
        body: { blocks: [], footnotes: [] },
        cover: { postImageId: othersImage },
      },
    ]) {
      expect(await h.as(actor).updatePost({ postId, ...attempt })).toEqual({
        ok: false,
        error: "unknown_image",
      });
    }
    expect(
      await h.as(actor).createPost({
        ...fields,
        slug: "a-third-post",
        body: { blocks: [], footnotes: [] },
        cover: { postImageId: othersImage },
      })
    ).toEqual({ ok: false, error: "unknown_image" });

    const [row] = await h.db
      .select({ body: cmsPost.body, coverImageId: cmsPost.coverImageId })
      .from(cmsPost)
      .where(eq(cmsPost.id, postId));
    expect(row).toEqual({
      coverImageId: null,
      body: { blocks: [], footnotes: [] },
    });
  });
});
