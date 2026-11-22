// The public pages' CMS content (#111): the home page, about and impact
// read their published document through here, typed by its kind. Call the
// loaders at request time, inside <Suspense> (the Live component), with
// the matching seed as the static shell's fallback: the build has no
// database.

import "server-only";

import { isSampleContentEnabled } from "@/lib/site";

import { loadPublishedDocument } from "./cached";
import { type OrgFacts, unconfirmedOrgFacts } from "./domain/org-facts";
import { homeKind, type HomeBody } from "./kinds/home";
import { impactKind, type ImpactBody } from "./kinds/impact";
import { pageKind, type AboutPageBody } from "./kinds/page";
import { getOrgFacts } from "./org-facts";

export type HomePage = { home: HomeBody; impact: ImpactBody | null };
export type AboutPage = { about: AboutPageBody; facts: OrgFacts };

/**
 * The seed counters are sample numbers: off production only, like every
 * other sample. Production shows none until counters are published.
 */
function unpublishedImpact(): ImpactBody | null {
  return isSampleContentEnabled() ? impactKind.seedBody() : null;
}

export function seedHomePage(): HomePage {
  return { home: homeKind.seedBody(), impact: unpublishedImpact() };
}

export async function loadHomePage(): Promise<HomePage> {
  const [home, impact] = await Promise.all([
    loadPublishedDocument("home"),
    loadImpact(),
  ]);
  return {
    home: home ? homeKind.sanitize(home.body) : homeKind.seedBody(),
    impact,
  };
}

export function seedAboutPage(): AboutPage {
  return { about: pageKind.seedBody(), facts: unconfirmedOrgFacts() };
}

export async function loadAboutPage(): Promise<AboutPage> {
  const [about, facts] = await Promise.all([
    loadPublishedDocument("about"),
    getOrgFacts(),
  ]);
  return {
    about: about ? pageKind.sanitize(about.body) : pageKind.seedBody(),
    facts,
  };
}

export function seedImpact(): ImpactBody | null {
  return unpublishedImpact();
}

/** The published counters, or the seed's (off production) before any are. */
export async function loadImpact(): Promise<ImpactBody | null> {
  const impact = await loadPublishedDocument("impact");
  return impact ? impactKind.sanitize(impact.body) : unpublishedImpact();
}
