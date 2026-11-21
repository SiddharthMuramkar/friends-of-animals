// The public URL segment, /competitions/<slug>. Made from the name when the
// competition is created and kept after that, so shared links keep working
// when the name is edited.

/** The same pattern the public pages and the proxy accept. */
export const COMPETITION_SLUG_PATTERN = /^[a-z0-9-]{3,80}$/;

const MAX_LENGTH = 80;

function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Cuts at the last hyphen that keeps `slug` within `max` characters. */
function fit(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max + 1).lastIndexOf("-");
  return (cut > 0 ? slug.slice(0, cut) : slug.slice(0, max)).replace(/-+$/, "");
}

/**
 * Slugs to try in order: the name's, then the name's with the code (codes are
 * unique). A name with fewer than 3 usable characters, such as one written
 * in Devanagari, uses the code alone.
 */
export function competitionSlugCandidates(
  name: string,
  code: string
): string[] {
  const codePart = slugify(code);
  const base = slugify(name);
  if (base.length < 3) return [codePart];
  const withCode = `${fit(base, MAX_LENGTH - codePart.length - 1)}-${codePart}`;
  return [...new Set([fit(base, MAX_LENGTH), withCode])];
}
