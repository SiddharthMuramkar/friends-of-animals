import { describe, expect, it } from "vitest";

import { latestPosts, relatedPosts, splitFeatured } from "./post-listing";
import type { PostCard } from "./post-view";

function card(
  slug: string,
  publishedOn: string,
  extra: Partial<PostCard> = {}
): PostCard {
  const at = new Date(`${publishedOn}T00:00:00+05:30`);
  return {
    slug,
    kind: "story",
    title: slug,
    seoTitle: null,
    excerpt: `About ${slug}.`,
    audience: "everyone",
    topics: ["birds"],
    featured: false,
    readingMinutes: 3,
    cover: null,
    publishedAt: at,
    updatedAt: at,
    ...extra,
  };
}

// Newest first, as the public list returns them.
const LIST = [
  card("newest", "2026-11-20", { audience: "kids" }),
  card("featured", "2026-11-10", { featured: true, audience: "families" }),
  card("middle", "2026-11-15", { audience: "families" }),
  card("oldest", "2026-11-01", { audience: "kids" }),
];

describe("latestPosts", () => {
  it("puts featured posts first, then the newest", () => {
    expect(latestPosts(LIST, 3).map((p) => p.slug)).toEqual([
      "featured",
      "newest",
      "middle",
    ]);
  });

  it("keeps the list's order between posts published at the same time", () => {
    const tied = [card("b", "2026-11-18"), card("a", "2026-11-18")];
    expect(latestPosts(tied, 2).map((p) => p.slug)).toEqual(["b", "a"]);
  });
});

describe("splitFeatured", () => {
  it("leads with the latest post and keeps the rest in list order", () => {
    const { lead, rest } = splitFeatured(LIST);
    expect(lead?.slug).toBe("featured");
    expect(rest.map((p) => p.slug)).toEqual(["newest", "middle", "oldest"]);
  });

  it("has no lead when nothing is published", () => {
    expect(splitFeatured([])).toEqual({ lead: null, rest: [] });
  });
});

describe("relatedPosts", () => {
  it("offers two other posts, same audience first", () => {
    const post = LIST[3]!; // "oldest", for kids
    expect(relatedPosts(LIST, post).map((p) => p.slug)).toEqual([
      "newest",
      "featured",
    ]);
  });
});
