// The public pages' CMS content (#111): the home page, about and impact read
// their published document through here, typed by its kind and sanitised
// again on render.
//
// The source is each kind's seed body (the repo's copy) until the CMS core's
// cached loader is merged in; the pages don't change when it is.

import "server-only";

import { isSampleContentEnabled } from "@/lib/site";

import { homeKind, type HomeBody } from "./kinds/home";
import { impactKind, type ImpactBody } from "./kinds/impact";
import { pageKind, type AboutPageBody } from "./kinds/page";

export async function loadHome(): Promise<HomeBody> {
  return homeKind.seedBody();
}

export async function loadAbout(): Promise<AboutPageBody> {
  return pageKind.seedBody();
}

/**
 * The published counters, or null before any are. The seed counters are
 * sample numbers, so they show off production only.
 */
export async function loadImpact(): Promise<ImpactBody | null> {
  return isSampleContentEnabled() ? impactKind.seedBody() : null;
}
