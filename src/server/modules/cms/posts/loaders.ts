// The public pages' cached reads of published posts (#112b). Each is a
// `use cache` function tagged `posts` (and `post:<slug>` for one post), so
// it is read once into the prerendered page and read again when a hand
// publish, edit or archive refreshes the tag (the Server Action's
// updateTag), or when the next scheduled post goes live (postsCacheLife:
// nothing refreshes the tags at a scheduled instant).
//
// `next build` has no database, so the build prerenders the repo stories
// (the same PostView mapping) with a one-second life: the server reads the
// database when it regenerates the page on its first request. A failed read
// keeps the repo stories too, and tries again 15 seconds later.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { as } from "../../../app";
import { errorSummaryForLogs } from "../../../errors";
import {
  BUILD_SHELL_LIFE,
  FAILED_READ_SHELL_LIFE,
  isNextBuild,
  PUBLIC_READER,
} from "../cached";
import { latestPosts } from "../domain/post-listing";
import { postsCacheLife } from "../domain/post-cache-life";
import type { PostCard, PostView } from "../domain/post-view";
import { POST_TAGS } from "./cache-tags";
import { repoStoryCards, repoStoryView } from "./repo-stories";

/**
 * `read` from the database with the cache life it allows, or `fallback`
 * (the repo stories) while the app is built or when the read fails.
 */
async function readOr<T>(
  what: string,
  read: (reader: ReturnType<typeof as>) => Promise<T>,
  fallback: () => T | Promise<T>
): Promise<T> {
  if (isNextBuild()) {
    cacheLife(BUILD_SHELL_LIFE);
    return fallback();
  }
  try {
    const reader = as(PUBLIC_READER);
    const [value, nextAt] = await Promise.all([
      read(reader),
      reader.nextPostGoingLive(),
    ]);
    cacheLife(postsCacheLife(nextAt, new Date()));
    return value;
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `Blog: could not read ${what}: ${errorSummaryForLogs(error)}`
    );
    cacheLife(FAILED_READ_SHELL_LIFE);
    return fallback();
  }
}

/** Every public post's card, newest first. */
export async function loadPublishedPosts(): Promise<PostCard[]> {
  "use cache";
  cacheTag(POST_TAGS.list);
  return readOr(
    "the published posts",
    (reader) => reader.listPublishedPosts(),
    repoStoryCards
  );
}

/** The home page's stories: featured first, then the newest. */
export async function loadLatestPublishedPosts(
  limit: number
): Promise<PostCard[]> {
  "use cache";
  cacheTag(POST_TAGS.list);
  return readOr(
    "the latest posts",
    (reader) => reader.latestPublishedPosts({ limit }),
    () => latestPosts(repoStoryCards(), limit)
  );
}

/** One public post, or null if no public post has this slug. */
export async function loadPublishedPost(
  slug: string
): Promise<PostView | null> {
  "use cache";
  cacheTag(POST_TAGS.list, POST_TAGS.slug(slug));
  return readOr(
    "a post",
    (reader) => reader.getPublishedPostBySlug({ slug }),
    () => repoStoryView(slug)
  );
}
