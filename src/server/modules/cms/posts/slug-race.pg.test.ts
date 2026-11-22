// Two saves racing for one post address, from separate connections on real
// PostgreSQL (`pnpm test:pg`). The use cases check the address first, but a
// save that commits between that check and the insert is caught by the
// unique index: the later save is refused as `slug: taken`, the same as if
// it had seen the other post, never thrown as a failure.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cmsPost } from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

async function contentManager() {
  const account = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(account, {
    role: "content_manager",
    scope: { type: "global" },
  });
  await world.seed.authenticator(account);
  return world.signedIn(account, { secondFactor: true });
}

/** An address no earlier run of this file has used. */
function freshSlug(): string {
  return `race-${randomUUID().slice(0, 8)}`;
}

const FIELDS = {
  kind: "blog",
  title: "Kinder skies in kite season",
  excerpt: "Gujarat ran bird-care points.",
  body: { blocks: [], footnotes: [] },
} as const;

/**
 * Runs `save` while another connection holds an uncommitted post at
 * `slug`, so the save gets past its own check and waits at the insert;
 * then commits the other post and returns what the save answered.
 */
async function raceAgainstAnotherPost(
  slug: string,
  save: () => Promise<unknown>
) {
  const other = await world.sql.reserve();
  try {
    await other`begin`;
    await other`
      insert into cms_post (id, slug, kind, title, excerpt, body, created_at, updated_at)
      values (${randomUUID()}, ${slug}, 'blog', 'Another post', '', '{"blocks":[],"footnotes":[]}', now(), now())
    `;
    const saved = save();
    saved.catch(() => {});
    const first = await Promise.race([
      saved.then(
        () => "save finished" as const,
        () => "save finished" as const
      ),
      world.waitForLockWaiters(1).then(() => "save waits" as const),
    ]);
    expect(first).toBe("save waits");
    await other`commit`;
    return await saved;
  } finally {
    await other`rollback`.catch(() => {});
    other.release();
  }
}

const TAKEN = {
  ok: false,
  error: "invalid_input",
  fields: ["slug"],
  errors: { slug: "taken" },
};

describe("two saves racing for one address", () => {
  it("refuses the later new post as taken", async () => {
    const actor = await contentManager();
    const slug = freshSlug();

    expect(
      await raceAgainstAnotherPost(slug, () =>
        world.as(actor).createPost({ ...FIELDS, slug })
      )
    ).toEqual(TAKEN);
    expect(
      await world.db
        .select({ title: cmsPost.title })
        .from(cmsPost)
        .where(eq(cmsPost.slug, slug))
    ).toEqual([{ title: "Another post" }]);
  });

  it("refuses the later change of address as taken, and changes nothing", async () => {
    const actor = await contentManager();
    const created = await world
      .as(actor)
      .createPost({ ...FIELDS, slug: freshSlug() });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const slug = freshSlug();

    expect(
      await raceAgainstAnotherPost(slug, () =>
        world.as(actor).updatePost({ ...FIELDS, postId: created.postId, slug })
      )
    ).toEqual(TAKEN);
    expect(
      await world.db
        .select({ slug: cmsPost.slug })
        .from(cmsPost)
        .where(eq(cmsPost.id, created.postId))
    ).toEqual([{ slug: created.slug }]);
  });
});
