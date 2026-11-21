// The public URL segment, /adopt/<slug> (#129). Made from the animal's
// name, species and city when the listing is created, and kept after that
// so shared links keep working when details are edited. Many dogs are
// called Bruno, so numbered candidates follow, and the last one carries the
// end of the listing's id, which no other listing shares. The use case
// takes the first candidate no other listing holds.
//
// Pure: no I/O, no "server-only", no `@/` imports.

/** The pattern the public route accepts. */
export const ADOPTION_SLUG_PATTERN = /^[a-z0-9-]{3,80}$/;

const MAX_LENGTH = 80;
const NUMBERED = [2, 3, 4];

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
 * Slugs to try, in order. A name with fewer than 3 usable characters (one
 * written in Devanagari, say) leaves it out; if the city is unusable too,
 * the species and the id's end make the slug.
 */
export function adoptionSlugCandidates(
  name: string,
  species: string,
  city: string,
  listingId: string
): string[] {
  const tail = listingId.replace(/-/g, "").slice(-8).toLowerCase();
  const namePart = slugify(name);
  const cityPart = slugify(city);
  const parts = [
    namePart.length >= 3 ? namePart : "",
    slugify(species),
    cityPart.length >= 3 ? cityPart : "",
  ].filter(Boolean);

  if (parts.length === 1) {
    return [fit(`${parts[0]}-${tail}`, MAX_LENGTH)];
  }
  const withSuffix = (suffix: string) => {
    const stem = fit(parts.join("-"), MAX_LENGTH - suffix.length - 1);
    return `${stem}-${suffix}`;
  };
  return [
    fit(parts.join("-"), MAX_LENGTH),
    ...NUMBERED.map((n) => withSuffix(String(n))),
    withSuffix(tail),
  ];
}
