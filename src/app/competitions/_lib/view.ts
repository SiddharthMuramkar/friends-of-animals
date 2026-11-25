import {
  type CompetitionView,
  DISCIPLINES,
  type StatusLabel,
  statusChip,
} from "@/components/competitions/model";
import { AGE_BOUNDS } from "@/server/modules/competitions/domain/age-groups";
import { COMPETITION_SLUG_PATTERN } from "@/server/modules/competitions/domain/slug";

import type { SlugLookup } from "./slug-lookup";

/**
 * Age bands for the /competitions age filter. Fixed, so the filter's CSS can
 * name each one; a category matches every band its age group overlaps.
 */
export const AGE_BANDS = [
  { key: "a3", min: AGE_BOUNDS.min, max: 8 },
  { key: "a9", min: 9, max: 12 },
  { key: "a13", min: 13, max: 17 },
  { key: "a18", min: 18, max: AGE_BOUNDS.max },
] as const;
export type AgeBandKey = (typeof AGE_BANDS)[number]["key"];

/**
 * Space-separated tokens for the CSS filters. Both a discipline and an age
 * must be offered in the same category: a competition can offer drawing to
 * children and photography to adults, without offering adult drawing.
 */
export function filterTokens(
  c: Pick<CompetitionView, "status" | "ageGroups" | "categories">
): {
  status: StatusLabel;
  disciplines: string;
  ages: string;
  pairs: string;
} {
  const ageGroups = new Map(
    c.ageGroups.map((g) => [g.label.trim().toLowerCase(), g])
  );
  const pairs = new Set<string>();
  const disciplines = new Set<string>();
  const ages = new Set<AgeBandKey>();
  for (const cat of c.categories) {
    const group = ageGroups.get(cat.ageGroup.trim().toLowerCase());
    if (!group) continue;
    for (const band of AGE_BANDS) {
      if (group.minAge <= band.max && group.maxAge >= band.min) {
        disciplines.add(cat.discipline);
        ages.add(band.key);
        pairs.add(`${cat.discipline}-${band.key}`);
      }
    }
  }
  return {
    status: statusChip(c.status)?.label ?? "upcoming",
    disciplines: DISCIPLINES.filter((d) => disciplines.has(d)).join(" "),
    ages: AGE_BANDS.filter((b) => ages.has(b.key))
      .map((b) => b.key)
      .join(" "),
    pairs: [...pairs].join(" "),
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
