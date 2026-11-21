import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { SIGNED_IN_PREFIXES } from "./src/lib/app-routes";
import { cspHeaderRules } from "./src/lib/csp";
import { cspContext } from "./src/lib/csp-sources";
import { robotsHeaders } from "./src/lib/indexing";
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
  // §13.1 headers on every route, HTML and static assets alike; the public
  // CSP outside the signed-in tree, whose nonce CSP comes from src/proxy.ts
  // (#65); and X-Robots-Tag: noindex on every response outside production
  // (#29). All are evaluated at build time, so APP_ENV must be set for
  // `next build` (Vercel sets it).
  headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.APP_ENV) },
      ...cspHeaderRules(cspContext(), SIGNED_IN_PREFIXES),
      ...robotsHeaders(),
    ];
  },
};

export default withNextIntl(nextConfig);
