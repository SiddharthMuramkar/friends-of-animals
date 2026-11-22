// Cache tags for the public competition pages (the contract with 70b's
// cached reads). A server action that changes a competition calls
// updateTag with these after the use case succeeds; the use cases stay
// free of the framework. Loads under plain Node: no imports.

export const COMPETITION_TAGS = {
  /** The public list, the home page section and the proxy's slugs. */
  list: "competitions",
  /** One competition's public page. */
  slug: (slug: string) => `competition:${slug}`,
} as const;
