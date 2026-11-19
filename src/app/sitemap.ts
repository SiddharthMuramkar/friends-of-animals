import type { MetadataRoute } from "next";

import { siteUrl } from "@/env";
import { STORIES } from "@/content/stories";
import { sitemapRoutes, slugHref } from "@/lib/routes";

// Static public pages from the routes registry, with fixed dates (no clock
// at build). Stories add one entry each; competitions add theirs when they land.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    ...sitemapRoutes().map((route) => ({
      url: new URL(route.path, base).href,
      lastModified: route.updated,
      priority: route.priority,
    })),
    ...STORIES.map((story) => ({
      url: new URL(slugHref("story", story.slug), base).href,
      lastModified: story.publishedOn,
      priority: 0.6,
    })),
  ];
}
