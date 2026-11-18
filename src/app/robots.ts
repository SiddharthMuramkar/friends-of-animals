import type { MetadataRoute } from "next";

import { siteUrl } from "@/env";

// SPEC §13.6. Non-production noindex is issue #29.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/dashboard",
        "/institution",
        "/judge",
        "/api",
        "/verify",
      ],
    },
    sitemap: new URL("/sitemap.xml", siteUrl()).href,
  };
}
