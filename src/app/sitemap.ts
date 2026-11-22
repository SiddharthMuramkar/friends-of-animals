import type { MetadataRoute } from "next";

import { siteUrl } from "@/env";
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
    ...postSitemapEntries(await loadPublishedPosts(), base),
  ];
}
