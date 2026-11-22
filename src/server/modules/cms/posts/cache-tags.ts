// Cache tags for the public blog's reads (the contract with 112b's cached
// loaders). A Server Action that changes what the public site shows of a
// post calls updateTag with the tags its use case returns; the use cases
// stay free of the framework. Loads under plain Node: no imports.

export const POST_TAGS = {
  /** The blog list, the home page's stories and the sitemap. */
  list: "posts",
  /** One post's public page, by its address. */
  slug: (slug: string) => `post:${slug}`,
} as const;

/** The tags to refresh when the post at each of `slugs` changes publicly. */
export function postTags(...slugs: string[]): string[] {
  return [POST_TAGS.list, ...[...new Set(slugs)].map(POST_TAGS.slug)];
}
