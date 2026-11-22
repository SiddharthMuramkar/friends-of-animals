// The public pages' CMS content (#111): the home page, about and impact
// show their document through here, typed by its kind: the published
// revision, or in Draft Mode the open draft for a content manager (111a's
// loadShownDocument); the contact page shows the facts' preview status.
// Call the loaders at request time, inside <Suspense>
// (the Live component), with the matching seed as the static shell's
// fallback: the build has no database. The home page also gives Live its
// published read for the shell (loadPublishedHomePage), which the server
// makes when it regenerates the page.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { isSampleContentEnabled } from "@/lib/site";

import { errorSummaryForLogs } from "../../errors";
import {
  BUILD_SHELL_LIFE,
  FAILED_READ_SHELL_LIFE,
  isNextBuild,
  loadPublishedDocument,
} from "./cached";
import { cmsPublicPath, cmsTag, type CmsDocumentKey } from "./domain/documents";
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

/**
 * The body of a shown or published document, or `fallback` while there is
 * none (the repo's copy).
 */
function bodyOf<Body>(
  shown: { body: unknown } | null,
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

/**
 * The published home page for the static shell (Live's `published`), so
 * the hero and its buttons are painted once and never streamed over. Null
 * while `next build` prerenders the page, or when the read fails: the page
 * then keeps the seed in its shell and streams loadHomePage over it, and
 * the server regenerates the shell with this read on its next request
 * (after a failed read, its next request 15 seconds later).
 *
 * Cached, so each request that resumes a shell gets the answer that shell
 * was rendered with (Next keeps a shell's cached values with it): a
 * request after the build must take the seed-and-stream branch the build
 * took, not read the database and leave the build's hole unfilled.
 */
export async function loadPublishedHomePage(): Promise<HomePage | null> {
  "use cache";
  if (isNextBuild()) {
    cacheLife(BUILD_SHELL_LIFE);
    return null;
  }
  try {
    const [home, impact] = await Promise.all([
      loadPublishedDocument("home"),
      loadPublishedDocument("impact"),
    ]);
    cacheTag(cmsTag("home"), cmsTag("impact"));
    cacheLife("hours");
    return {
      home: bodyOf(home, homeKind, homeKind.seedBody),
      impact: bodyOf(impact, impactKind, unpublishedImpact),
      preview: null,
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `CMS home page: the static shell could not read the published copy: ${errorSummaryForLogs(error)}`
    );
    cacheLife(FAILED_READ_SHELL_LIFE);
    return null;
  }
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
