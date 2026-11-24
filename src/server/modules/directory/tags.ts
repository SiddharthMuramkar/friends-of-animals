// Cache tags for the public directory pages (#127). A Server Action that
// changes what the public sees of a listing (staff's decision, an edit, a
// withdrawal) refreshes its tag with updateTag(). Loads anywhere.

export const DIRECTORY_TAGS = {
  /** One listing's public page, by its slug. */
  listing: (slug: string) => `directory-listing:${slug}`,
} as const;
