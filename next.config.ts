import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { umamiRewrites } from "./src/lib/analytics/umami";
import { CONSENT_LINK_PREFIX, SIGNED_IN_PREFIXES } from "./src/lib/app-routes";
import { cspHeaderRules } from "./src/lib/csp";
import { cspContext } from "./src/lib/csp-sources";
import { robotsHeaders } from "./src/lib/indexing";
import {
  checkoutPageHeaders,
  consentLinkHeaders,
  securityHeaders,
} from "./src/lib/security-headers";
import { unconfirmedFactsWarning } from "./src/lib/site";

// Production ships without the organisation facts FOA hasn't confirmed
// (owner's decision, 2026-11-21): pages leave them out, and the build log
// names them.
const factsWarning = unconfirmedFactsWarning();
if (factsWarning) console.warn(factsWarning);

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
  // The security headers on every route, HTML and static assets alike,
  // with the pay page's two overrides after them (#77); the public CSP
  // outside the signed-in tree, whose nonce CSP comes from src/proxy.ts
  // (#65); and X-Robots-Tag: noindex on every response outside production
  // (#29). All are evaluated at build time, so APP_ENV must be set for
  // `next build` (Vercel sets it).
  headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.APP_ENV) },
      ...checkoutPageHeaders(),
      ...consentLinkHeaders(),
      ...cspHeaderRules(cspContext(), [
        ...SIGNED_IN_PREFIXES,
        CONSENT_LINK_PREFIX,
      ]),
      ...robotsHeaders(),
    ];
  },
  // Umami's tracker script and collect endpoint, proxied under /stats/ so
  // analytics stays same-origin for the CSP (#118). Only those two paths,
  // and none while UMAMI_ORIGIN is unset.
  rewrites() {
    return Promise.resolve(umamiRewrites(process.env.UMAMI_ORIGIN));
  },
};

export default withNextIntl(nextConfig);
