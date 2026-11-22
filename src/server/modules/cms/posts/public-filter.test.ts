import { describe, expect, it } from "vitest";

import { cmsPost } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { createTestDb } from "@/test/db";

import { isPostPublic, type PostStatus } from "../domain/post-status";
import { publicPostFilter } from "./public-filter";

const NOW = new Date("2027-01-15T04:30:00Z");
const MINUTE = 60_000;

function post(
  slug: string,
  status: PostStatus,
  dates: { publishAt?: Date; publishedAt?: Date } = {}
) {
  return {
    id: uuidv7(NOW),
    slug,
    kind: "blog" as const,
    title: slug,
    excerpt: "An excerpt.",
    body: { blocks: [], footnotes: [] },
    status,
    publishAt: dates.publishAt ?? null,
    publishedAt: dates.publishedAt ?? null,
    archivedAt: status === "archived" ? NOW : null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("publicPostFilter", () => {
  it("shows published posts and scheduled posts that are due, and nothing else", async () => {
    const db = await createTestDb();
    const world = [
      post("a-draft", "draft"),
      post("live", "published", { publishedAt: new Date(+NOW - 60 * MINUTE) }),
      post("due", "scheduled", { publishAt: NOW }),
      post("future", "scheduled", { publishAt: new Date(+NOW + MINUTE) }),
      post("archived", "archived", {
        publishedAt: new Date(+NOW - 120 * MINUTE),
      }),
      post("published-later", "published", {
        publishedAt: new Date(+NOW + MINUTE),
      }),
    ];
    await db.insert(cmsPost).values(world);

    const shown = await db
      .select({ slug: cmsPost.slug })
      .from(cmsPost)
      .where(publicPostFilter(NOW))
      .orderBy(cmsPost.slug);

    expect(shown.map((row) => row.slug)).toEqual(["due", "live"]);
    // The same rule as the one the use cases and pages apply in code.
    expect(
      world
        .filter((p) => isPostPublic(p, NOW))
        .map((p) => p.slug)
        .sort()
    ).toEqual(["due", "live"]);
  });
});
