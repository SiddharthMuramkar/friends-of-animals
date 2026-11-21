import type { PostCard } from "./post-view";

export function latestPosts(
  _posts: readonly PostCard[],
  _limit: number
): PostCard[] {
  return [];
}

export function splitFeatured(_posts: readonly PostCard[]): {
  lead: PostCard | null;
  rest: PostCard[];
} {
  return { lead: null, rest: [] };
}

export function relatedPosts(
  _posts: readonly PostCard[],
  _post: PostCard
): PostCard[] {
  return [];
}
