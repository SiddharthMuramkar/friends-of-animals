// The public pages' cached reads of published posts. Each is a `use cache`
// function tagged `posts` (and `post:<slug>` for one post), so it is read
// once into the prerendered page and read again only when a publish, edit
// or archive revalidates the tag.
//
// Without a database to read (./source.ts) they return the repo stories
// with a short cache life, so a page prerendered by a build without a
// database refreshes from the database a minute after it first serves.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { POSTS_TAG, postTag } from "../domain/post-tags";
import type { PostCard, PostView } from "../domain/post-view";
import { repoStoryCards, repoStoryView } from "./repo-stories";

/** Every published post's card, newest first. */
export async function loadPublishedPosts(): Promise<PostCard[]> {
  "use cache";
  cacheTag(POSTS_TAG);
  cacheLife("minutes");
  return repoStoryCards();
}

/** One published post, or null if no public post has this slug. */
export async function loadPublishedPost(
  slug: string
): Promise<PostView | null> {
  "use cache";
  cacheTag(POSTS_TAG, postTag(slug));
  cacheLife("minutes");
  return repoStoryView(slug);
}
