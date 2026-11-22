// The orders the public pages list posts in. Each takes the published
// posts newest first, as the public reads return them.
//
// Pure: no I/O.

import type { PostCard } from "./post-view";

/** Featured first, then newest; ties keep the list's order. */
export function latestPosts(
  posts: readonly PostCard[],
  limit: number
): PostCard[] {
  return posts
    .toSorted(
      (a, b) =>
        Number(b.featured) - Number(a.featured) ||
        b.publishedAt.getTime() - a.publishedAt.getTime()
    )
    .slice(0, limit);
}

/** The index page: the latest post wide, then the rest in list order. */
export function splitFeatured(posts: readonly PostCard[]): {
  lead: PostCard | null;
  rest: PostCard[];
} {
  const [lead] = latestPosts(posts, 1);
  if (!lead) return { lead: null, rest: [] };
  return { lead, rest: posts.filter((p) => p.slug !== lead.slug) };
}

/** Up to two other posts, those for the same audience first. */
export function relatedPosts(
  posts: readonly PostCard[],
  post: PostCard
): PostCard[] {
  const others = posts.filter((p) => p.slug !== post.slug);
  return [
    ...others.filter((p) => p.audience === post.audience),
    ...others.filter((p) => p.audience !== post.audience),
  ].slice(0, 2);
}
