import type { MetadataRoute } from "next";

import { eventSitemapRows } from "./events/_lib/public-reads";
import { slugHref } from "@/lib/routes";
import { siteUrl } from "@/env";
import { ADOPTION_STORIES_PATH, TRANSPARENCY_PATH } from "@/lib/app-routes";
import { sitemapRoutes } from "@/lib/routes";
import { postSitemapEntries } from "@/server/modules/cms/domain/post-seo";
import { loadPublishedPosts } from "@/server/modules/cms/posts/loaders";

// Static public pages from the routes registry, with fixed dates (no clock
// at build). Published posts add one entry each, read from the CMS through
// the cached loader (tag "posts"); competitions add theirs when they land.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  return [
    ...sitemapRoutes().map((route) => ({
      url: new URL(route.path, base).href,
      lastModified: route.updated,
      priority: route.priority,
    })),
    // Adopters' stories (#130): not in ROUTES, which ships to the browser.
    {
      url: new URL(ADOPTION_STORIES_PATH, base).href,
      lastModified: "2026-11-25",
      priority: 0.5,
    },
    {
      url: new URL(TRANSPARENCY_PATH, base).href,
      lastModified: "2026-11-25",
      priority: 0.7,
    },
    ...(await eventSitemapRows()).map(({ slug }) => ({
      url: new URL(slugHref("event", slug), base).href,
      priority: 0.6,
    })),
    ...postSitemapEntries(await loadPublishedPosts(), base),
  ];
}
