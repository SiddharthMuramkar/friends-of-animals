// Public addresses for listings: /ngos/<slug>. The slug is made once, from
// the name at registration, and never changes, so links people share keep
// working after a rename. The unique index decides collisions: the caller
// retries with the next candidate inside a savepoint.
//
// Loads under plain Node: no "server-only", no `@/` imports.

export const SLUG_MAX_LENGTH = 60;

/** Path segments under /ngos that are pages, not listings. */
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "register",
  "search",
  "new",
]);

/**
 * Lower-case ASCII words joined by hyphens. Names in other scripts give
 * "listing" (numbered on collision) until FOA wants transliteration.
 */
export function listingSlugBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
  if (slug === "") return "listing";
  return RESERVED_SLUGS.has(slug) ? `${slug}-listing` : slug;
}

/** The slug to try on `attempt` (from 1): the base, then base-2, base-3… */
export function listingSlugCandidate(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
