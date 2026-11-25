// The public URL segment, /events/<slug> (#125). Made from the title when
// the event is created and kept after that, so shared links keep working
// when the title is edited. Events repeat ("Beach clean-up" every month), so
// the start date in India is the first tie-breaker and a number the next.
// The use case takes the first candidate no other event holds.
//
// Pure: no I/O, no "server-only", no `@/` imports.

/** The pattern the public route and the proxy's slug check accept. */
export const EVENT_SLUG_PATTERN = /^[a-z0-9-]{3,80}$/;

const MAX_LENGTH = 80;
const CANDIDATES = 5;
/** India has one time zone and no daylight saving. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

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

/** `YYYY-MM-DD` of `at` in India. */
function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Slugs to try in order. A title with fewer than 3 usable characters, such
 * as one written in Devanagari, uses `event-<date>` instead.
 */
export function eventSlugCandidates(title: string, startsAt: Date): string[] {
  const date = istDate(startsAt);
  const base = slugify(title);
  const numbered = (stem: string, from: number) =>
    Array.from({ length: CANDIDATES }, (_, i) => {
      const suffix = `-${from + i}`;
      return `${fit(stem, MAX_LENGTH - suffix.length)}${suffix}`;
    });

  if (base.length < 3) {
    const stem = `event-${date}`;
    return [stem, ...numbered(stem, 2)].slice(0, CANDIDATES);
  }
  const dated = `${fit(base, MAX_LENGTH - date.length - 1)}-${date}`;
  return [fit(base, MAX_LENGTH), dated, ...numbered(dated, 2)].slice(
    0,
    CANDIDATES
  );
}
