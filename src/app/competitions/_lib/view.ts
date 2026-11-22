import {
  type CompetitionCardModel,
  type StatusLabel,
  statusChip,
} from "@/components/competitions/model";
import { COMPETITION_SLUG_PATTERN } from "@/server/modules/competitions/domain/slug";

import type { SlugLookup } from "./slug-lookup";

/**
 * Age bands for the /competitions age filter. Fixed, so the filter's CSS can
 * name each one; a competition matches every band its age groups overlap.
 */
export const AGE_BANDS = [
  { key: "a5", min: 5, max: 8 },
  { key: "a9", min: 9, max: 12 },
  { key: "a13", min: 13, max: 17 },
  { key: "a18", min: 18, max: 30 },
] as const;
export type AgeBandKey = (typeof AGE_BANDS)[number]["key"];

/** Space-separated tokens for a card's data-* attributes (CSS filters). */
export function filterTokens(
  c: Pick<CompetitionCardModel, "status" | "disciplines" | "ageGroups">
): {
  status: StatusLabel;
  disciplines: string;
  ages: string;
} {
  const chip = statusChip(c.status);
  const bands = AGE_BANDS.filter((b) =>
    c.ageGroups.some((g) => g.minAge <= b.max && g.maxAge >= b.min)
  ).map((b) => b.key);
  return {
    status: chip?.label ?? "upcoming",
    disciplines: c.disciplines.join(" "),
    ages: bands.join(" "),
  };
}

const PLACEHOLDER_SLUG = "__placeholder__";

/**
 * generateStaticParams for /competitions/[slug]. Published competitions
 * live in the database, which the build can't reach, so none is listed:
 * Cache Components needs at least one param, so this is a placeholder the
 * page answers with notFound(). A real slug gets the page's App Shell on
 * its first visit and a cached page after that.
 */
export function competitionParams(): { slug: string }[] {
  return [{ slug: PLACEHOLDER_SLUG }];
}

/**
 * Whether `/competitions/<raw>` is a published competition, for src/proxy.ts.
 * `raw` is the path segment as requested. A malformed escape or a segment
 * outside the slug pattern (the build's placeholder among them) can't be
 * one, so only well-formed slugs reach the lookup.
 */
export async function isListedCompetitionSlug(
  raw: string,
  lookup: SlugLookup
): Promise<boolean> {
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return false;
  }
  return COMPETITION_SLUG_PATTERN.test(slug) && lookup(slug);
}
