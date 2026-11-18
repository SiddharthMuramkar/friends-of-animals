import type { MetadataRoute } from "next";

import { siteUrl } from "@/env";
import { sitemapRoutes } from "@/lib/routes";

// Static public pages from the routes registry, with fixed dates (no clock
// at build). Competitions and stories add their own entries when they land.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return sitemapRoutes().map((route) => ({
    url: new URL(route.path, base).href,
    lastModified: route.updated,
    priority: route.priority,
  }));
}
