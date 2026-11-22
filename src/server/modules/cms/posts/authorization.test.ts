// Who may run the post use cases (#112): content managers with a global
// grant who have passed their second factor, and nobody else. Super admin
// is not a wildcard. Every refused call writes nothing.

import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Role } from "@/server/access/domain/roles";
import type { Actor } from "@/server/actor";
import {
  auditLog,
  cmsPost,
  cmsPostImage,
  fileAsset,
  outbox,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const global = { type: "global" } as const;

const FIELDS = {
  kind: "blog",
  title: "Kinder skies in kite season",
  excerpt: "Gujarat ran bird-care points.",
  body: { blocks: [], footnotes: [] },
} as const;

const REFUSED_ROLES: { who: string; roles: Role[] }[] = [
  { who: "a member", roles: [] },
  { who: "a staff admin", roles: ["staff_admin"] },
  { who: "a competition manager", roles: ["competition_manager"] },
  { who: "a super admin", roles: ["super_admin"] },
];

async function contentManager(h: Harness) {
  const account = await h.seed.member();
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

async function holding(h: Harness, ...roles: Role[]) {
  const account = await h.seed.member();
  for (const role of roles)
    await h.seed.grant(account, { role, scope: global });
  return h.signIn(account);
}

/** A draft and a published post, and one image of the draft. */
async function world(h: Harness) {
  const editor = await contentManager(h);
  const drafted = await h.as(editor).createPost({ ...FIELDS, slug: "a-draft" });
  const live = await h
    .as(editor)
    .createPost({ ...FIELDS, slug: "a-live-post" });
  if (!drafted.ok || !live.ok) throw new Error("not created");
  await h.as(editor).publishPost({ postId: live.postId });
  const image = await h.as(editor).uploadPostImage({
    postId: drafted.postId,
    contentType: "image/jpeg",
    sizeBytes: 1000,
  });
  if (!image.ok) throw new Error("not presigned");
  return {
    draftId: drafted.postId,
    liveId: live.postId,
    postImageId: image.postImageId,
  };
}

type World = Awaited<ReturnType<typeof world>>;

function attempts(h: Harness, actor: Actor, w: World) {
  const publishAt = new Date(h.clock.now().getTime() + 60 * 60_000);
  return {
    checkPostWriter: () => h.as(actor).checkPostWriter(),
    listPosts: () => h.as(actor).listPosts(),
    getPostForEdit: () => h.as(actor).getPostForEdit({ postId: w.draftId }),
    createPost: () =>
      h.as(actor).createPost({ ...FIELDS, slug: "someone-elses-post" }),
    updatePost: () =>
      h.as(actor).updatePost({ postId: w.draftId, ...FIELDS, slug: "a-draft" }),
    uploadPostImage: () =>
      h.as(actor).uploadPostImage({
        postId: w.draftId,
        contentType: "image/jpeg",
        sizeBytes: 1000,
      }),
    describePostImage: () =>
      h.as(actor).describePostImage({
        postImageId: w.postImageId,
        alt: "Someone's words",
      }),
    schedulePost: () =>
      h.as(actor).schedulePost({ postId: w.draftId, publishAt }),
    unschedulePost: () => h.as(actor).unschedulePost({ postId: w.draftId }),
    publishPost: () => h.as(actor).publishPost({ postId: w.draftId }),
    archivePost: () => h.as(actor).archivePost({ postId: w.liveId }),
    restorePost: () => h.as(actor).restorePost({ postId: w.liveId }),
  };
}

async function rowCounts(h: Harness) {
  const counts: Record<string, number | undefined> = {};
  for (const [name, table] of Object.entries({
    cmsPost,
    cmsPostImage,
    fileAsset,
    auditLog,
    outbox,
  })) {
    const [row] = await h.db.select({ n: count() }).from(table);
    counts[name] = row?.n;
  }
  return counts;
}

describe("the post use cases", () => {
  for (const { who, roles } of REFUSED_ROLES) {
    it(`refuse ${who} everything, and write nothing`, async () => {
      const h = await createHarness();
      const w = await world(h);
      const actor = await holding(h, ...roles);
      const before = await rowCounts(h);

      for (const [name, attempt] of Object.entries(attempts(h, actor, w))) {
        await expect(attempt(), name).rejects.toMatchObject({
          code: "forbidden",
        });
      }
      expect(await rowCounts(h)).toEqual(before);
    });
  }

  it("refuse a visitor everything", async () => {
    const h = await createHarness();
    const w = await world(h);

    for (const [name, attempt] of Object.entries(attempts(h, h.visitor(), w))) {
      await expect(attempt(), name).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("ask a content manager for their second factor first", async () => {
    const h = await createHarness();
    const w = await world(h);
    const account = await h.seed.member();
    await h.seed.grant(account, { role: "content_manager", scope: global });
    await h.seed.authenticator(account);
    const actor = await h.signIn(account, undefined, { secondFactor: false });

    for (const [name, attempt] of Object.entries(attempts(h, actor, w))) {
      await expect(attempt(), name).rejects.toMatchObject({
        code: "second_factor_required",
      });
    }
  });

  it("let a content manager with a second factor do everything", async () => {
    const h = await createHarness();
    const w = await world(h);
    const actor = await contentManager(h);
    const allowed = attempts(h, actor, w);

    await expect(allowed.checkPostWriter()).resolves.toBeUndefined();
    expect(await allowed.listPosts()).toHaveLength(2);
    expect(await allowed.getPostForEdit()).toMatchObject({ ok: true });
    expect(await allowed.createPost()).toMatchObject({ ok: true });
    expect(await allowed.updatePost()).toMatchObject({ ok: true });
    expect(await allowed.uploadPostImage()).toMatchObject({ ok: true });
    expect(await allowed.describePostImage()).toMatchObject({ ok: true });
    expect(await allowed.schedulePost()).toMatchObject({ ok: true });
    expect(await allowed.unschedulePost()).toMatchObject({ ok: true });
    expect(await allowed.publishPost()).toMatchObject({ ok: true });
    expect(await allowed.archivePost()).toMatchObject({ ok: true });
    expect(await allowed.restorePost()).toMatchObject({ ok: true });
  });
});
