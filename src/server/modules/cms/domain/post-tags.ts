// Cache tags for the public posts. The public loaders tag what they read;
// publishing, archiving or editing a public post returns these tags for the
// Server Action's `updateTag`, and the scheduled-publish job revalidates
// them from the worker. So a change goes live without a deploy.
//
// Pure: no I/O.

/** Every list of posts: the index, the home stories, the sitemap, slugs. */
export const POSTS_TAG = "posts";

/** One post's page. */
export function postTag(slug: string): string {
  return `post:${slug}`;
}

/** What to revalidate when the post at `slug` changes publicly. */
export function postTags(slug: string): string[] {
  return [POSTS_TAG, postTag(slug)];
}
