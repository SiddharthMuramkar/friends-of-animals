import type { Metadata } from "next";

import {
  type OrgFacts,
  unconfirmedOrgFacts,
} from "../server/modules/cms/domain/org-facts";
import { isPlaceholder, SITE } from "./site";

type SocialImage = { url: string; width: number; height: number; alt: string };

/** The default Open Graph / Twitter image: the registered logo card. */
export const DEFAULT_SOCIAL_IMAGE: SocialImage = {
  url: SITE.socialImage,
  width: 1200,
  height: 630,
  alt: SITE.name,
};

/** Root layout's title template: "About us · Friends of Animals". */
export const TITLE_TEMPLATE = `%s · ${SITE.name}`;

/** Longest rendered `<title>` and meta description, in characters. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

/** The `<title>` a page title renders as, template applied unless absolute. */
export function renderedTitle(title: string, absolute = false): string {
  return absolute ? title : TITLE_TEMPLATE.replace("%s", title);
}

type PageMetadataInput = {
  /**
   * Translated page title; the layout's template adds the site name. With
   * it, ≤ TITLE_MAX characters (seo.test.ts checks every page).
   */
  title: string;
  /** Translated description, ≤ DESCRIPTION_MAX characters. */
  description: string;
  /** Path from the routes registry, e.g. "/about". */
  path: string;
  image?: SocialImage;
  /** Use the title as-is (home page): no " · Friends of Animals". */
  absoluteTitle?: boolean;
};

/** Title, description, canonical URL and social cards for one page. */
export function pageMetadata({
  title,
  description,
  path,
  image = DEFAULT_SOCIAL_IMAGE,
  absoluteTitle = false,
}: PageMetadataInput): Metadata {
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    // Relative: resolved against metadataBase (APP_URL) in the root layout.
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE.name,
      locale: "en_IN",
      title,
      description,
      url: path,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

/**
 * JSON-LD for a plain <script type="application/ld+json">. "<" is escaped so
 * no value can close the script tag.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** A BreadcrumbList matching a page's visual breadcrumb, first crumb first. */
export function breadcrumbJsonLd(
  base: URL,
  crumbs: readonly { name: string; path: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: new URL(c.path, base).href,
    })),
  };
}

/**
 * Site-wide NGO structured data. Unconfirmed facts are left out, never sent
 * as placeholders; with no facts passed, none are confirmed.
 */
export function organizationJsonLd(
  base: URL,
  description: string,
  facts: OrgFacts = unconfirmedOrgFacts()
) {
  const { email, legalName, socials } = facts;
  return {
    "@context": "https://schema.org",
    "@type": "NGO",
    name: SITE.name,
    url: new URL("/", base).href,
    logo: new URL(SITE.logo.src, base).href,
    description,
    ...(isPlaceholder(legalName) ? {} : { legalName }),
    ...(isPlaceholder(email) ? {} : { email }),
    ...(isPlaceholder(socials) ? {} : { sameAs: socials }),
  };
}
