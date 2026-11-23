// A post's address on the public site: /blog/<slug>. Slugs are lower-case
// ASCII words joined by single hyphens, 3 to 80 characters, so they never
// need escaping in a URL and the stories already published keep theirs.
//
// Pure: no I/O, no "server-only", so the worker and tests can load it.

import type { Check } from "./post-schedule";

export const POST_SLUG_MIN = 3;
export const POST_SLUG_MAX = 80;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PostSlugRefusal = "too_short" | "too_long" | "invalid_format";

/** Whether `slug` may be a post's address. Uniqueness is the database's. */
export function checkPostSlug(slug: string): Check<PostSlugRefusal> {
  if (slug.length < POST_SLUG_MIN) return { ok: false, refusal: "too_short" };
  if (slug.length > POST_SLUG_MAX) return { ok: false, refusal: "too_long" };
  if (!SLUG.test(slug)) return { ok: false, refusal: "invalid_format" };
  return { ok: true };
}

/**
 * A slug suggested from a title: accents dropped, every run of other
 * characters made one hyphen, cut at a word boundary within the maximum.
 * Null when too little of the title is Latin letters or digits (a title in
 * Hindi, say): the editor then asks for a slug.
 */
export function postSlugFrom(title: string): string | null {
  let slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > POST_SLUG_MAX) {
    const cut = slug.slice(0, POST_SLUG_MAX);
    const endsOnWord = slug[POST_SLUG_MAX] === "-";
    const lastHyphen = cut.lastIndexOf("-");
    slug = endsOnWord || lastHyphen < 1 ? cut : cut.slice(0, lastHyphen);
    slug = slug.replace(/-+$/, "");
  }
  return checkPostSlug(slug).ok ? slug : null;
}
