// Scheduling and publishing posts (#112). A scheduled post goes live at
// its instant through one delayed outbox delivery: the fake clock is moved
// and the outbox drained, as the worker would. Stale deliveries (after an
// unschedule, a reschedule or "publish now") do nothing.

import { and, asc, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, cmsPost, cmsPostImage, outbox } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { createHarness, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import { publicPostFilter } from "./public-filter";

const JPEG = readMediaFixture("gpsJpeg");
const global = { type: "global" } as const;
const MINUTE = 60_000;

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

type Actor = Awaited<ReturnType<typeof contentManager>>;

const FIELDS = {
  kind: "blog",
  title: "Kinder skies in kite season",
  slug: "kite-season",
  excerpt: "Gujarat ran over 1,000 bird-care points for kite season.",
  body: {
    blocks: [{ type: "paragraph", text: ["Birds first."] }],
    footnotes: [],
  },
} as const;

async function draft(h: Harness, actor: Actor, fields: object = {}) {
  const created = await h.as(actor).createPost({ ...FIELDS, ...fields });
  if (!created.ok) throw new Error(JSON.stringify(created));
  return created.postId;
}

async function uploadImage(
  h: Harness,
  actor: Actor,
  postId: string,
  alt = "A kite over a rooftop"
) {
  const requested = await h.as(actor).uploadPostImage({
    postId,
    contentType: "image/jpeg",
    sizeBytes: JPEG.length,
    alt,
  });
  if (!requested.ok) throw new Error(JSON.stringify(requested));
  await h.storage.put(requested.uploadUrl, JPEG, requested.headers);
  await h.as(actor).completeUpload({ fileId: requested.fileId });
  return requested.postImageId;
}

async function postRow(h: Harness, postId: string) {
  const [row] = await h.db.select().from(cmsPost).where(eq(cmsPost.id, postId));
  return row!;
}

async function publicSlugs(h: Harness) {
  const rows = await h.db
    .select({ slug: cmsPost.slug })
    .from(cmsPost)
    .where(publicPostFilter(h.clock.now()));
  return rows.map((row) => row.slug);
}

async function auditOf(h: Harness, postId: string) {
  return h.db
    .select({
      action: auditLog.action,
      actorKind: auditLog.actorKind,
      actorProcess: auditLog.actorProcess,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(
      and(eq(auditLog.entityType, "cms_post"), eq(auditLog.entityId, postId))
    )
    .orderBy(asc(auditLog.occurredAt), asc(auditLog.id));
}

async function publishedEvents(h: Harness, postId: string) {
  const [row] = await h.db
    .select({ n: count() })
    .from(outbox)
    .where(
      and(
        eq(outbox.eventType, "cms.post_published"),
        eq(outbox.aggregateId, postId)
      )
    );
  return row?.n;
}

function later(h: Harness, minutes: number) {
  return new Date(h.clock.now().getTime() + minutes * MINUTE);
}

describe("schedulePost", () => {
  it("puts the post live at its instant, not a minute before", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const at = later(h, 60);

    // Not public yet, so no public page has anything to refresh.
    expect(await h.as(actor).schedulePost({ postId, publishAt: at })).toEqual({
      ok: true,
      publishAt: at,
      tags: [],
    });
    expect(await postRow(h, postId)).toMatchObject({
      status: "scheduled",
      publishAt: at,
    });

    h.clock.set(new Date(at.getTime() - MINUTE));
    await h.drain();
    expect(await postRow(h, postId)).toMatchObject({ status: "scheduled" });
    expect(await publicSlugs(h)).toEqual([]);

    h.clock.set(at);
    await h.drain();
    expect(await postRow(h, postId)).toMatchObject({
      status: "published",
      publishedAt: at,
      publishAt: null,
    });
    expect(await publicSlugs(h)).toEqual(["kite-season"]);
    expect(await publishedEvents(h, postId)).toBe(1);
    expect(await auditOf(h, postId)).toEqual([
      {
        action: "cms_post.scheduled",
        actorKind: "user",
        actorProcess: null,
        before: { status: "draft", publishAt: null, publishedAt: null },
        after: {
          status: "scheduled",
          publishAt: at.toISOString(),
          publishedAt: null,
        },
      },
      {
        action: "cms_post.published",
        actorKind: "system",
        actorProcess: "worker",
        before: {
          status: "scheduled",
          publishAt: at.toISOString(),
          publishedAt: null,
        },
        after: {
          status: "published",
          publishAt: null,
          publishedAt: at.toISOString(),
        },
      },
    ]);
  });

  it("refuses an instant that isn't in the future, and changes nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);

    for (const publishAt of [h.clock.now(), later(h, -1)]) {
      expect(await h.as(actor).schedulePost({ postId, publishAt })).toEqual({
        ok: false,
        error: "not_in_future",
      });
    }
    expect(await postRow(h, postId)).toMatchObject({ status: "draft" });
    expect(await auditOf(h, postId)).toEqual([]);
  });

  it("refuses an instant it can't read, and changes nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);

    for (const publishAt of [new Date(Number.NaN), "next Tuesday"]) {
      expect(await h.as(actor).schedulePost({ postId, publishAt })).toEqual({
        ok: false,
        error: "invalid_instant",
      });
    }
    expect(await postRow(h, postId)).toMatchObject({ status: "draft" });
    expect(await auditOf(h, postId)).toEqual([]);
  });

  it("asks who is scheduling before it reads the instant", async () => {
    const h = await createHarness();
    const postId = await draft(h, await contentManager(h));
    const member = await h.signIn(await h.seed.member());

    await expect(
      h.as(member).schedulePost({ postId, publishAt: new Date(Number.NaN) })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("publishes once, at the last instant, after two reschedules", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const [t1, t2, t3] = [later(h, 60), later(h, 120), later(h, 30)];

    for (const publishAt of [t1, t2, t3]) {
      expect(
        await h.as(actor).schedulePost({ postId, publishAt })
      ).toMatchObject({ ok: true });
    }
    h.clock.set(t3);
    await h.drain();
    expect(await postRow(h, postId)).toMatchObject({
      status: "published",
      publishedAt: t3,
    });
    h.clock.set(t2);
    await h.drain();

    expect(await postRow(h, postId)).toMatchObject({ publishedAt: t3 });
    expect(await publishedEvents(h, postId)).toBe(1);
    expect((await auditOf(h, postId)).map((entry) => entry.action)).toEqual([
      "cms_post.scheduled",
      "cms_post.scheduled",
      "cms_post.scheduled",
      "cms_post.published",
    ]);
  });

  it("takes a post already due, whose job hasn't run, off the public site when moved later, and returns the tags to refresh", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    await h.as(actor).schedulePost({ postId, publishAt: later(h, 1) });
    h.clock.advance({ seconds: 61 });
    expect(await publicSlugs(h)).toEqual(["kite-season"]);
    const moved = later(h, 60);

    expect(
      await h.as(actor).schedulePost({ postId, publishAt: moved })
    ).toEqual({
      ok: true,
      publishAt: moved,
      tags: ["posts", "post:kite-season"],
    });
    expect(await publicSlugs(h)).toEqual([]);
    expect(await postRow(h, postId)).toMatchObject({
      status: "scheduled",
      publishAt: moved,
    });
  });
});

describe("the scheduled publish", () => {
  it("takes the post back to a draft, instead of putting it up, if it no longer qualifies at its instant", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const cover = await uploadImage(h, actor, postId);
    await h.drain();
    await h
      .as(actor)
      .updatePost({ postId, ...FIELDS, cover: { postImageId: cover } });
    const at = later(h, 60);
    expect(
      await h.as(actor).schedulePost({ postId, publishAt: at })
    ).toMatchObject({ ok: true });
    // Written behind the use cases' back, which refuse it for a live post.
    await h.db
      .update(cmsPostImage)
      .set({ alt: "" })
      .where(eq(cmsPostImage.id, cover));

    h.clock.set(at);
    await h.drain();

    expect(await postRow(h, postId)).toMatchObject({
      status: "draft",
      publishAt: null,
      publishedAt: null,
    });
    expect(await publicSlugs(h)).toEqual([]);
    expect(await publishedEvents(h, postId)).toBe(0);
    expect((await auditOf(h, postId)).at(-1)).toEqual({
      action: "cms_post.unscheduled",
      actorKind: "system",
      actorProcess: "worker",
      before: {
        status: "scheduled",
        publishAt: at.toISOString(),
        publishedAt: null,
      },
      after: { status: "draft", publishAt: null, publishedAt: null },
    });
  });
});

describe("unschedulePost", () => {
  it("makes the post a draft again, and its delivery does nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const at = later(h, 60);
    await h.as(actor).schedulePost({ postId, publishAt: at });

    // Not public yet, so no public page has anything to refresh.
    expect(await h.as(actor).unschedulePost({ postId })).toEqual({
      ok: true,
      tags: [],
    });
    h.clock.set(at);
    await h.drain();

    expect(await postRow(h, postId)).toMatchObject({
      status: "draft",
      publishAt: null,
      publishedAt: null,
    });
    expect(await publicSlugs(h)).toEqual([]);
    expect(await auditOf(h, postId)).toMatchObject([
      { action: "cms_post.scheduled" },
      {
        action: "cms_post.unscheduled",
        before: { status: "scheduled", publishAt: at.toISOString() },
        after: { status: "draft", publishAt: null },
      },
    ]);
  });

  it("takes a post already due, whose job hasn't run, off the public site and returns the tags to refresh", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const at = later(h, 60);
    await h.as(actor).schedulePost({ postId, publishAt: at });
    h.clock.set(later(h, 75));
    expect(await publicSlugs(h)).toEqual(["kite-season"]);

    expect(await h.as(actor).unschedulePost({ postId })).toEqual({
      ok: true,
      tags: ["posts", "post:kite-season"],
    });
    expect(await publicSlugs(h)).toEqual([]);
  });
});

describe("publishPost", () => {
  it("puts a draft live now, and returns the tags to refresh", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);

    expect(await h.as(actor).publishPost({ postId })).toEqual({
      ok: true,
      publishedAt: h.clock.now(),
      tags: ["posts", "post:kite-season"],
    });
    expect(await publicSlugs(h)).toEqual(["kite-season"]);
    expect(await publishedEvents(h, postId)).toBe(1);
    expect(await auditOf(h, postId)).toEqual([
      {
        action: "cms_post.published",
        actorKind: "user",
        actorProcess: null,
        before: { status: "draft", publishAt: null, publishedAt: null },
        after: {
          status: "published",
          publishAt: null,
          publishedAt: h.clock.now().toISOString(),
        },
      },
    ]);
  });

  it("puts a scheduled post live now, and the scheduled delivery then does nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const at = later(h, 60);
    await h.as(actor).schedulePost({ postId, publishAt: at });
    h.clock.advance({ minutes: 10 });
    const now = h.clock.now();

    expect(await h.as(actor).publishPost({ postId })).toMatchObject({
      ok: true,
      publishedAt: now,
    });
    h.clock.set(at);
    await h.drain();

    expect(await postRow(h, postId)).toMatchObject({
      status: "published",
      publishedAt: now,
    });
    expect(await publishedEvents(h, postId)).toBe(1);
  });

  it("dates a scheduled post already due, whose job hasn't run, to its instant", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const at = later(h, 60);
    await h.as(actor).schedulePost({ postId, publishAt: at });
    h.clock.set(later(h, 75));

    // Public since `at` (publicPostFilter), so readers already saw that date.
    expect(await h.as(actor).publishPost({ postId })).toMatchObject({
      ok: true,
      publishedAt: at,
    });
    await h.drain();

    expect(await postRow(h, postId)).toMatchObject({
      status: "published",
      publishedAt: at,
    });
    expect(await publishedEvents(h, postId)).toBe(1);
  });

  it("waits for every image's public copy", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    const cover = await uploadImage(h, actor, postId);
    await h
      .as(actor)
      .updatePost({ postId, ...FIELDS, cover: { postImageId: cover } });

    expect(await h.as(actor).publishPost({ postId })).toEqual({
      ok: false,
      error: "image_not_ready",
    });
    expect(
      await h.as(actor).schedulePost({ postId, publishAt: later(h, 60) })
    ).toEqual({ ok: false, error: "image_not_ready" });
    expect(await postRow(h, postId)).toMatchObject({ status: "draft" });

    await h.drain();
    const inline = await uploadImage(h, actor, postId, "Volunteers at work");
    await h.as(actor).updatePost({
      postId,
      ...FIELDS,
      cover: { postImageId: cover },
      body: { blocks: [{ type: "image", postImageId: inline }], footnotes: [] },
    });
    expect(await h.as(actor).publishPost({ postId })).toEqual({
      ok: false,
      error: "image_not_ready",
    });

    await h.drain();
    expect(await h.as(actor).publishPost({ postId })).toMatchObject({
      ok: true,
    });
  });

  it("needs what a draft could leave out: an excerpt and the cover's alt text", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor, { excerpt: "" });
    const cover = await uploadImage(h, actor, postId, "");
    await h.drain();
    await h.as(actor).updatePost({
      postId,
      ...FIELDS,
      excerpt: "",
      cover: { postImageId: cover },
    });

    const refused = {
      ok: false,
      error: "invalid_input",
      fields: ["excerpt", "coverAlt"],
      errors: { excerpt: "required", coverAlt: "required" },
    };
    expect(await h.as(actor).publishPost({ postId })).toEqual(refused);
    expect(
      await h.as(actor).schedulePost({ postId, publishAt: later(h, 60) })
    ).toEqual(refused);
    expect(await postRow(h, postId)).toMatchObject({ status: "draft" });
  });
});

describe("the post lifecycle", () => {
  it("refuses moves the lifecycle forbids, and writes nothing", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const drafted = await draft(h, actor, { slug: "a-draft" });
    const scheduled = await draft(h, actor, { slug: "a-scheduled-post" });
    await h.as(actor).schedulePost({
      postId: scheduled,
      publishAt: later(h, 60),
    });
    const archived = await draft(h, actor, { slug: "an-archived-post" });
    await h.as(actor).publishPost({ postId: archived });
    await h.as(actor).archivePost({ postId: archived });
    const [audits] = await h.db.select({ n: count() }).from(auditLog);
    const refused = { ok: false, error: "invalid_transition" };

    expect(await h.as(actor).archivePost({ postId: drafted })).toEqual(refused);
    expect(await h.as(actor).archivePost({ postId: scheduled })).toEqual(
      refused
    );
    expect(await h.as(actor).publishPost({ postId: archived })).toEqual(
      refused
    );
    expect(
      await h.as(actor).schedulePost({
        postId: archived,
        publishAt: later(h, 60),
      })
    ).toEqual(refused);
    expect(await h.as(actor).unschedulePost({ postId: drafted })).toEqual(
      refused
    );
    expect(await h.as(actor).restorePost({ postId: drafted })).toEqual(refused);

    const [after] = await h.db.select({ n: count() }).from(auditLog);
    expect(after?.n).toBe(audits?.n);
    expect((await postRow(h, drafted)).status).toBe("draft");
    expect((await postRow(h, scheduled)).status).toBe("scheduled");
    expect((await postRow(h, archived)).status).toBe("archived");
  });

  it("archives a published post off the public site, and restores it as a draft", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    await h.as(actor).publishPost({ postId });

    expect(await h.as(actor).archivePost({ postId })).toEqual({
      ok: true,
      tags: ["posts", "post:kite-season"],
    });
    expect(await postRow(h, postId)).toMatchObject({
      status: "archived",
      archivedAt: h.clock.now(),
    });
    expect(await publicSlugs(h)).toEqual([]);
    expect(
      await h.as(actor).updatePost({ postId, ...FIELDS, title: "Edited" })
    ).toEqual({ ok: false, error: "archived" });

    expect(await h.as(actor).restorePost({ postId })).toEqual({ ok: true });
    expect(await postRow(h, postId)).toMatchObject({
      status: "draft",
      archivedAt: null,
    });
    expect(await publicSlugs(h)).toEqual([]);
    expect((await auditOf(h, postId)).map((entry) => entry.action)).toEqual([
      "cms_post.published",
      "cms_post.archived",
      "cms_post.restored",
    ]);
  });

  it("says when there is no such post", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = uuidv7(h.clock.now());
    const missing = { ok: false, error: "not_found" };

    expect(
      await h.as(actor).schedulePost({ postId, publishAt: later(h, 60) })
    ).toEqual(missing);
    expect(await h.as(actor).unschedulePost({ postId })).toEqual(missing);
    expect(await h.as(actor).publishPost({ postId })).toEqual(missing);
    expect(await h.as(actor).archivePost({ postId })).toEqual(missing);
    expect(await h.as(actor).restorePost({ postId })).toEqual(missing);
  });
});

describe("editing a live post", () => {
  it("returns the tags to refresh, and holds it to what going live needs", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const postId = await draft(h, actor);
    await h.as(actor).publishPost({ postId });

    expect(
      await h.as(actor).updatePost({
        postId,
        ...FIELDS,
        slug: "kite-season-2027",
      })
    ).toEqual({
      ok: true,
      tags: ["posts", "post:kite-season", "post:kite-season-2027"],
    });
    expect(
      await h.as(actor).updatePost({ postId, ...FIELDS, excerpt: "" })
    ).toMatchObject({
      error: "invalid_input",
      errors: { excerpt: "required" },
    });

    const image = await uploadImage(h, actor, postId);
    expect(
      await h.as(actor).updatePost({
        postId,
        ...FIELDS,
        cover: { postImageId: image },
      })
    ).toEqual({ ok: false, error: "image_not_ready" });
    expect(await postRow(h, postId)).toMatchObject({
      slug: "kite-season-2027",
      coverImageId: null,
    });
  });
});
