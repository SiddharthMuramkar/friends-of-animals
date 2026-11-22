// The public pages' CMS content (#111): the home page, about and impact
// show their document through here, typed by its kind: the published
// revision, or in Draft Mode the open draft for a content manager (111a's
// loadShownDocument); the contact page shows the facts' preview status.
// Call the loaders at request time, inside <Suspense>
// (the Live component), with the matching seed as the static shell's
// fallback: the build has no database.

import "server-only";

import { isSampleContentEnabled } from "@/lib/site";

import { cmsPublicPath, type CmsDocumentKey } from "./domain/documents";
import { type OrgFacts, unconfirmedOrgFacts } from "./domain/org-facts";
import type { CmsKind } from "./kinds";
import { homeKind, type HomeBody } from "./kinds/home";
import { impactKind, type ImpactBody } from "./kinds/impact";
import { pageKind, type AboutPageBody } from "./kinds/page";
import { loadShownOrgFacts } from "./org-facts";
import { loadShownDocument, type ShownCmsDocument } from "./shown";

/** Draft Mode's status line: which page, and whether a draft shows. */
export type CmsPreview = { path: `/${string}`; showingDraft: boolean };

export type HomePage = {
  home: HomeBody;
  impact: ImpactBody | null;
  preview: CmsPreview | null;
};
export type AboutPage = {
  about: AboutPageBody;
  facts: OrgFacts;
  preview: CmsPreview | null;
};
export type ImpactPage = {
  impact: ImpactBody | null;
  preview: CmsPreview | null;
};

/**
 * The seed counters are sample numbers: off production only, like every
 * other sample. Production shows none until counters are published.
 */
function unpublishedImpact(): ImpactBody | null {
  return isSampleContentEnabled() ? impactKind.seedBody() : null;
}

/** The body shown, or `fallback` while there is none (the repo's copy). */
function bodyOf<Body>(
  shown: ShownCmsDocument | null,
  kind: CmsKind<Body>,
  fallback: () => Body
): Body {
  return shown && shown.body !== null ? kind.sanitize(shown.body) : fallback();
}

function previewOf(
  key: CmsDocumentKey,
  shown: ShownCmsDocument | null
): CmsPreview | null {
  if (!shown?.previewing) return null;
  return {
    path: cmsPublicPath(key),
    showingDraft: shown.published === null && shown.body !== null,
  };
}

export function seedHomePage(): HomePage {
  return {
    home: homeKind.seedBody(),
    impact: unpublishedImpact(),
    preview: null,
  };
}

export async function loadHomePage(): Promise<HomePage> {
  const [home, impact] = await Promise.all([
    loadShownDocument("home"),
    loadShownDocument("impact"),
  ]);
  return {
    home: bodyOf(home, homeKind, homeKind.seedBody),
    impact: bodyOf(impact, impactKind, unpublishedImpact),
    preview: previewOf("home", home),
  };
}

export function seedAboutPage(): AboutPage {
  return {
    about: pageKind.seedBody(),
    facts: unconfirmedOrgFacts(),
    preview: null,
  };
}

export async function loadAboutPage(): Promise<AboutPage> {
  const [about, { facts }] = await Promise.all([
    loadShownDocument("about"),
    loadShownOrgFacts(),
  ]);
  return {
    about: bodyOf(about, pageKind, pageKind.seedBody),
    facts,
    preview: previewOf("about", about),
  };
}

/**
 * Draft Mode's status line on the contact page, where site facts preview:
 * whether the facts shown are the unpublished draft. Null outside Draft
 * Mode.
 */
export async function loadFactsPreview(): Promise<CmsPreview | null> {
  const shown = await loadShownOrgFacts();
  return shown.previewing
    ? { path: cmsPublicPath("site_facts"), showingDraft: shown.showingDraft }
    : null;
}

export function seedImpactPage(): ImpactPage {
  return { impact: unpublishedImpact(), preview: null };
}

/** The counters shown, or the seed's (off production) before any are. */
export async function loadImpactPage(): Promise<ImpactPage> {
  const impact = await loadShownDocument("impact");
  return {
    impact: bodyOf(impact, impactKind, unpublishedImpact),
    preview: previewOf("impact", impact),
  };
}
