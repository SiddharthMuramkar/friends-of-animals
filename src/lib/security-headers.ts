/**
 * The security response headers other than the CSP, sent on every route
 * (HTML and static assets) by `headers()` in next.config.ts. That applies on
 * Vercel and in the standalone server alike. The CSP is built in ./csp.ts.
 * X-Frame-Options stays: browsers ignore the CSP's `frame-ancestors 'none'`
 * while the policy is report-only on staging and production (HR-19).
 *
 * Keep this file free of Next.js and server-only imports: next.config.ts
 * loads it under plain Node.
 */

import {
  CHECKOUT_ROUTES,
  CERTIFICATE_VERIFY_PREFIX,
  CONSENT_LINK_PREFIX,
  DONATION_CHECKOUT_PREFIX,
  FEEDBACK_PREFIX,
  DONATION_THANK_YOU,
  RECEIPTS_PREFIX,
} from "./app-routes";
import type { HeaderRule } from "./csp";
import { DIRECTORY_SEARCH_PATH } from "./document-navigation";

export { DIRECTORY_SEARCH_PATH } from "./document-navigation";

export type SecurityHeader = { key: string; value: string };

/**
 * HSTS for production covers every subdomain for two years. Other
 * deployments (staging, previews, local) skip includeSubDomains, so a
 * subdomain that is not yet HTTPS keeps working. Never `preload`: submit to
 * hstspreload.org only once the production domain is final.
 */
export function strictTransportSecurity(appEnv: string | undefined): string {
  return appEnv === "production"
    ? "max-age=63072000; includeSubDomains"
    : "max-age=31536000";
}

const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";

/**
 * The pay pages' overrides of two headers above (#77), listed after them
 * in next.config.ts so they win there. Razorpay Checkout's frame may use
 * the Payment Request API (wallets), and Checkout opens bank and wallet
 * pages in popups that it watches, which COOP same-origin would cut off.
 * Every other page keeps the stricter values.
 */
export function checkoutPageHeaders(): HeaderRule[] {
  return CHECKOUT_ROUTES.map((route) => ({
    // The routes the CSP scopes Razorpay's origins to (./csp-sources.ts),
    // as a headers() source: each [name] segment becomes :name.
    source: route.replaceAll(/\[(\w+)\]/g, ":$1"),
    headers: [
      {
        key: "Permissions-Policy",
        value: `${PERMISSIONS_POLICY}, payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com")`,
      },
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin-allow-popups",
      },
    ],
  }));
}

/**
 * The directory search's override (#128): its "Use my location" button may
 * ask the browser for the visitor's position, on this page only and for
 * this origin only. Listed after securityHeaders in next.config.ts.
 */
export function directorySearchHeaders(): HeaderRule[] {
  return [
    {
      source: DIRECTORY_SEARCH_PATH,
      headers: [
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(self)",
        },
      ],
    },
  ];
}

const BEARER_HEADERS: SecurityHeader[] = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "private, no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

/**
 * Bearer paths are never cached, indexed or sent as a referrer: consent
 * links, and a donation's checkout, thank-you and receipt pages (#106),
 * whose URLs carry a token.
 */
export function consentLinkHeaders(): HeaderRule[] {
  return [
    `${CONSENT_LINK_PREFIX}/:path*`,
    `${FEEDBACK_PREFIX}/:path*`,
    CERTIFICATE_VERIFY_PREFIX,
    `${CERTIFICATE_VERIFY_PREFIX}/:path*`,
    `${DONATION_CHECKOUT_PREFIX}/:path*`,
    DONATION_THANK_YOU,
    RECEIPTS_PREFIX,
    `${RECEIPTS_PREFIX}/:path*`,
  ].map((source) => ({ source, headers: BEARER_HEADERS }));
}

/** The headers for one deployment, from its APP_ENV. */
export function securityHeaders(appEnv: string | undefined): SecurityHeader[] {
  return [
    {
      key: "Strict-Transport-Security",
      value: strictTransportSecurity(appEnv),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The pay page also allows payment (checkoutPageHeaders), and the
    // directory search geolocation (directorySearchHeaders).
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
