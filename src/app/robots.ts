import type { MetadataRoute } from "next";

import { siteUrl } from "@/env";
import { isIndexable } from "@/lib/indexing";

// Robots rules and, in production only, the sitemap link. Outside production
// every response carries X-Robots-Tag: noindex (next.config.ts), which keeps
// the deployment out of search results (#29). Crawling stays allowed there:
// a `Disallow: /` would stop crawlers fetching pages, so they would never see
// the noindex and could still list linked URLs.
export default function robots(): MetadataRoute.Robots {
  const rules: MetadataRoute.Robots["rules"] = {
    userAgent: "*",
    allow: "/",
    disallow: [
      "/admin",
      "/dashboard",
      "/institution",
      "/judge",
      "/api",
      "/verify",
      // Bearer pages of a donation (#106): their URLs carry a token.
      "/donate/checkout",
      "/donate/thank-you",
      "/receipts",
    ],
  };
  if (!isIndexable()) return { rules };
  return { rules, sitemap: new URL("/sitemap.xml", siteUrl()).href };
}
