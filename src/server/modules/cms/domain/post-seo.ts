// A published post's metadata and structured data: the page title and
// description within the search limits, the canonical URL, the social card
// and the BlogPosting JSON-LD. Every image here comes from the PostView, so
// it is a site photo or a public derivative, never an original upload.
//
// Pure: no I/O, so tests can call it without Next.js.

import type { Metadata } from "next";

import { metaDescription } from "@/content/stories/text";
import { slugHref, ROUTES } from "@/lib/routes";
import {
  breadcrumbJsonLd,
  DEFAULT_SOCIAL_IMAGE,
  pageMetadata,
} from "@/lib/seo";
import { SITE } from "@/lib/site";

import { postMetaTitle } from "./post-fields";
import type { PostView } from "./post-view";

/** The post's canonical path, `/blog/<slug>`. */
export function postPath(slug: string): string {
  return slugHref("story", slug);
}

/**
 * The image social cards show: an uploaded cover's public derivative with
 * its own size and alt, else the site's logo card. Site photos aren't
 * resized for cards, so they keep the logo card too.
 */
function socialImage(post: PostView) {
  const cover = post.cover;
  if (cover?.source !== "public") return DEFAULT_SOCIAL_IMAGE;
  return {
    url: cover.url,
    width: cover.width,
    height: cover.height,
    alt: cover.alt,
  };
}

/** Title, description, canonical URL and article social cards. */
export function postMetadata(post: PostView): Metadata {
  const title = postMetaTitle({
    title: post.title,
    seoTitle: post.seoTitle ?? undefined,
  });
  const base = pageMetadata({
    title,
    description: metaDescription(post.excerpt),
    path: postPath(post.slug),
    image: socialImage(post),
  });
  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      type: "article",
      publishedTime: post.publishedAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      ...(post.authorName ? { authors: [post.authorName] } : {}),
    },
  };
}

/**
 * BlogPosting structured data. `siteImageSrc` is the built URL of a site
 * photo cover, which only the page can resolve (it is a bundled file).
 */
export function blogPostingJsonLd(
  post: PostView,
  base: URL,
  { siteImageSrc }: { siteImageSrc?: string } = {}
) {
  const url = new URL(postPath(post.slug), base).href;
  const image =
    post.cover?.source === "site" && siteImageSrc
      ? siteImageSrc
      : socialImage(post).url;
  const organization = { "@type": "Organization", name: SITE.name };
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    inLanguage: "en-IN",
    mainEntityOfPage: url,
    url,
    image: new URL(image, base).href,
    keywords: post.topics.join(", "),
    author: post.authorName
      ? { "@type": "Person", name: post.authorName }
      : organization,
    publisher: { ...organization, logo: new URL(SITE.logo.src, base).href },
    citation: post.body.footnotes.map((f) => f.url),
  };
}

/** The breadcrumb the page shows, as a BreadcrumbList. */
export function postBreadcrumbJsonLd(
  post: PostView,
  base: URL,
  names: { home: string; index: string }
) {
  return breadcrumbJsonLd(base, [
    { name: names.home, path: "/" },
    { name: names.index, path: ROUTES.stories.path },
    { name: post.title, path: postPath(post.slug) },
  ]);
}
