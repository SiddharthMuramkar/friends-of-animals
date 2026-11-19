import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { robotsHeaders } from "./src/lib/indexing";
import { assertNoPlaceholdersInProduction } from "./src/lib/site";

// A production build must not ship "To be confirmed" organisation facts.
assertNoPlaceholdersInProduction();

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone, used by the Docker image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // AVIF first, WebP fallback; next/image picks per the Accept header.
    formats: ["image/avif", "image/webp"],
    qualities: [75, 85],
  },
  // X-Robots-Tag: noindex on every response outside production (#29).
  headers: () => robotsHeaders(),
  experimental: {
    // lucide-react is optimised by default; radix-ui is not.
    optimizePackageImports: ["radix-ui"],
  },
};

export default withNextIntl(nextConfig);
