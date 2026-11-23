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

import { CHECKOUT_ROUTES, CONSENT_LINK_PREFIX } from "./app-routes";
import type { HeaderRule } from "./csp";

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

/** Bearer paths are never cached, indexed or sent as a referrer. */
export function consentLinkHeaders(): HeaderRule[] {
  return [
    {
      source: `${CONSENT_LINK_PREFIX}/:path*`,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
  ];
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
    // The pay page also allows payment (checkoutPageHeaders).
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
