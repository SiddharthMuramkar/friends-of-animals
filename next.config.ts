import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { securityHeaders } from "./src/lib/security-headers";
import { assertNoPlaceholdersInProduction } from "./src/lib/site";

// A production build must not ship "To be confirmed" organisation facts.
assertNoPlaceholdersInProduction();

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone, used by the Docker image.
  output: "standalone",
  // No `X-Powered-By: Next.js` (the standalone server sends it by default).
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // AVIF first, WebP fallback; next/image picks per the Accept header.
    formats: ["image/avif", "image/webp"],
    qualities: [75, 85],
  },
  experimental: {
    // lucide-react is optimised by default; radix-ui is not.
    optimizePackageImports: ["radix-ui"],
  },
  // §13.1 headers on every route, HTML and static assets alike. Evaluated at
  // build time, so APP_ENV must be set for `next build` (Vercel sets it).
  headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.APP_ENV) },
    ];
  },
};

export default withNextIntl(nextConfig);
