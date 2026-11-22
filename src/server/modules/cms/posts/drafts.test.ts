// Writing posts (#112): drafts at the use-case seam. A content manager
// creates and edits drafts; the body is sanitised on every save and every
// read, so a stored body never holds markup, whatever was sent or written
// to the row behind the use case's back.

import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { cmsPost } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import {
  LOOKS_LIKE_MARKUP,
  stringsIn,
  XSS_CORPUS,
} from "@/server/rich-text/xss-corpus";
import { createHarness, type Harness } from "@/test/harness";

const global = { type: "global" } as const;

/** A signed-in content manager who has passed their second factor. */
async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

const BODY = {
  blocks: [
    { type: "heading", level: 2, text: "Kite season" },
    { type: "paragraph", text: ["Gujarat ran bird-care points."] },
  ],
  footnotes: [],
};

const DRAFT = {
  kind: "blog",
  title: "Kinder skies in kite season",
  excerpt: "Gujarat ran over 1,000 bird-care points for kite season.",
  body: BODY,
} as const;

/** Every string field and block of a body, each holding XSS payloads. */
function unsafeBody() {
  return {
    blocks: [
      ...XSS_CORPUS.map((payload) => ({
        type: "paragraph",
        text: [`Before ${payload} after`],
      })),
      { type: "heading", level: 2, text: "<svg onload=alert(1)>Title" },
      {
        type: "paragraph",
        text: [{ link: "Report here", href: "javascript:alert(1)" }],
      },
      { type: "raw_html", html: "<script>alert(1)</script>" },
      { type: "list", style: "bullet", items: [["<img src=x onerror=1>a"]] },
    ],
    footnotes: [],
  };
}

async function postCount(h: Harness) {
  const [row] = await h.db.select({ n: count() }).from(cmsPost);
  return row?.n;
}

async function storedBody(h: Harness, postId: string) {
  const [row] = await h.db
    .select({ body: cmsPost.body })
    .from(cmsPost)
    .where(eq(cmsPost.id, postId));
  return row?.body;
}

describe("createPost", () => {
  it("saves a draft at the address its title suggests", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const created = await h.as(actor).createPost(DRAFT);

    expect(created).toEqual({
      ok: true,
      postId: expect.any(String),
      slug: "kinder-skies-in-kite-season",
    });
    if (!created.ok) return;
    const found = await h.as(actor).getPostForEdit({ postId: created.postId });
    expect(found).toMatchObject({
      ok: true,
      post: {
        id: created.postId,
        status: "draft",
        kind: "blog",
        slug: "kinder-skies-in-kite-season",
        title: DRAFT.title,
        excerpt: DRAFT.excerpt,
        body: BODY,
        cover: null,
        publishAt: null,
        publishedAt: null,
        images: [],
      },
    });
    expect(await h.as(actor).listPosts()).toEqual([
      expect.objectContaining({
        id: created.postId,
        status: "draft",
        title: DRAFT.title,
      }),
    ]);
  });

  it("takes an address the editor chose, and lets a draft leave its excerpt for later", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const created = await h.as(actor).createPost({
      ...DRAFT,
      slug: "kite-season",
      excerpt: "",
    });

    expect(created).toMatchObject({ ok: true, slug: "kite-season" });
  });

  it("refuses an address another post has, and writes nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    await h.as(actor).createPost({ ...DRAFT, slug: "kite-season" });

    const again = await h.as(actor).createPost({
      ...DRAFT,
      title: "Another post",
      slug: "kite-season",
    });

    expect(again).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["slug"],
      errors: { slug: "taken" },
    });
    expect(await postCount(h)).toBe(1);
  });

  it("refuses a bad address, or a title it can't make one from, and writes nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    expect(
      await h.as(actor).createPost({ ...DRAFT, slug: "Not A Slug" })
    ).toMatchObject({
      error: "invalid_input",
      errors: { slug: "invalid_format" },
    });
    expect(
      await h.as(actor).createPost({ ...DRAFT, slug: "ab" })
    ).toMatchObject({ error: "invalid_input", errors: { slug: "too_short" } });
    expect(
      await h.as(actor).createPost({ ...DRAFT, title: "पतंग का मौसम" })
    ).toMatchObject({ error: "invalid_input", errors: { slug: "required" } });
    expect(await postCount(h)).toBe(0);
  });

  it("refuses fields over their limits, each one named, and writes nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const refused = await h.as(actor).createPost({
      ...DRAFT,
      slug: "kite-season",
      title: " ",
      excerpt: "e".repeat(301),
      authorName: "a".repeat(81),
    });

    expect(refused).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["title", "excerpt", "authorName"],
      errors: {
        title: "required",
        excerpt: "too_long",
        authorName: "too_long",
      },
    });
    expect(await postCount(h)).toBe(0);
  });

  it("refuses an unknown kind or audience", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const refused = await h.as(actor).createPost({
      ...DRAFT,
      kind: "press_release" as "blog",
      audience: "adults" as "everyone",
    });

    expect(refused).toMatchObject({
      ok: false,
      error: "invalid_input",
      fields: ["kind", "audience"],
    });
    expect(await postCount(h)).toBe(0);
  });

  it("strips scripts, handlers, javascript: links and unknown blocks before storing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const created = await h.as(actor).createPost({
      ...DRAFT,
      body: unsafeBody(),
    });

    if (!created.ok) throw new Error(JSON.stringify(created));
    const stored = await storedBody(h, created.postId);
    const strings = stringsIn(stored);
    expect(strings.length).toBeGreaterThan(0);
    for (const value of strings) expect(value).not.toMatch(LOOKS_LIKE_MARKUP);
    expect(JSON.stringify(stored)).not.toContain("raw_html");
    expect(stored?.blocks).toContainEqual({
      type: "paragraph",
      text: ["Report here"],
    });
  });

  it("names the post's fields only by markup-free text", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const created = await h.as(actor).createPost({
      ...DRAFT,
      title: "Kite <b>season</b>",
      excerpt: "Birds <script>alert(1)</script>first.",
      authorName: "<img src=x onerror=1>Asha",
    });

    if (!created.ok) throw new Error(JSON.stringify(created));
    const [row] = await h.db
      .select()
      .from(cmsPost)
      .where(eq(cmsPost.id, created.postId));
    expect(row).toMatchObject({
      title: "Kite season",
      excerpt: "Birds first.",
      authorName: "Asha",
    });
  });
});

describe("getPostForEdit", () => {
  it("cleans a body that was stored unsafe behind the use cases' back", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const id = uuidv7(h.clock.now());
    await h.db.insert(cmsPost).values({
      id,
      slug: "written-raw",
      kind: "blog",
      title: "Written raw",
      excerpt: "",
      body: unsafeBody() as never,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    });

    const found = await h.as(actor).getPostForEdit({ postId: id });

    if (!found.ok) throw new Error(JSON.stringify(found));
    for (const value of stringsIn(found.post.body)) {
      expect(value).not.toMatch(LOOKS_LIKE_MARKUP);
    }
    expect(JSON.stringify(found.post.body)).not.toContain("raw_html");
  });

  it("says when there is no such post", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    expect(
      await h.as(actor).getPostForEdit({ postId: uuidv7(h.clock.now()) })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await h.as(actor).getPostForEdit({ postId: "not-a-uuid" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("updatePost", () => {
  it("edits a draft in place, sanitising the new body", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const created = await h.as(actor).createPost(DRAFT);
    if (!created.ok) throw new Error(JSON.stringify(created));
    h.clock.advance({ minutes: 5 });

    const updated = await h.as(actor).updatePost({
      postId: created.postId,
      ...DRAFT,
      slug: "kite-season-2027",
      title: "Kite season, 2027",
      body: {
        blocks: [{ type: "paragraph", text: ["New <script>x</script>words."] }],
        footnotes: [],
      },
    });

    expect(updated).toEqual({ ok: true, tags: [] });
    const found = await h.as(actor).getPostForEdit({ postId: created.postId });
    expect(found).toMatchObject({
      ok: true,
      post: {
        status: "draft",
        slug: "kite-season-2027",
        title: "Kite season, 2027",
        body: {
          blocks: [{ type: "paragraph", text: ["New words."] }],
          footnotes: [],
        },
        updatedAt: h.clock.now(),
      },
    });
    expect(await postCount(h)).toBe(1);
  });

  it("refuses another post's address, and changes nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    await h.as(actor).createPost({ ...DRAFT, slug: "first-post" });
    const second = await h.as(actor).createPost({
      ...DRAFT,
      slug: "second-post",
    });
    if (!second.ok) throw new Error(JSON.stringify(second));

    const refused = await h.as(actor).updatePost({
      postId: second.postId,
      ...DRAFT,
      slug: "first-post",
    });

    expect(refused).toMatchObject({
      error: "invalid_input",
      errors: { slug: "taken" },
    });
    expect(
      await h.as(actor).getPostForEdit({ postId: second.postId })
    ).toMatchObject({ post: { slug: "second-post" } });
  });

  it("says when there is no such post", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);

    expect(
      await h.as(actor).updatePost({
        postId: uuidv7(h.clock.now()),
        ...DRAFT,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
