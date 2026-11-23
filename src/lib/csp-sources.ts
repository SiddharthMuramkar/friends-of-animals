/**
 * The origins each feature adds to the Content-Security-Policy. A feature
 * that loads from, posts to or frames another origin (error tracking, file
 * storage, checkout, analytics) appends one entry here; ./csp.ts checks
 * each source and merges it into the right directives.
 *
 * Keep this file free of Next.js, `@/` and server-only imports:
 * next.config.ts loads it under plain Node.
 */

import { CHECKOUT_ROUTES } from "./app-routes";
import type { CspContext, CspSources } from "./csp";
import { r2Origin } from "./r2-origin";

export const CSP_SOURCES: readonly CspSources[] = [];

/**
 * File storage (#63): browsers PUT uploads to the R2 account's origin, and
 * an <img> of /api/files/[id] follows the redirect there. Its host is the
 * account id, so this source comes from the environment.
 */
function fileStorageSources(
  env: Record<string, string | undefined>
): CspSources[] {
  const origin = env.R2_ACCOUNT_ID ? r2Origin(env.R2_ACCOUNT_ID) : null;
  if (!origin) return [];
  return [
    {
      feature: "file storage",
      directives: { "connect-src": [origin], "img-src": [origin] },
    },
  ];
}

/**
 * Public post images (#112): pages show uploaded images' resized copies
 * from the public bucket's own domain, PUBLIC_ASSET_BASE_URL. Images only.
 */
function publicAssetSources(
  env: Record<string, string | undefined>
): CspSources[] {
  const origin = httpsOrigin(env.PUBLIC_ASSET_BASE_URL);
  if (!origin) return [];
  return [
    { feature: "public post images", directives: { "img-src": [origin] } },
  ];
}

/**
 * Razorpay Checkout (#77), on the pay pages alone (a school's, and an
 * adult's own, #78) and only while Razorpay
 * keys are set (the fallback's test checkout is on our own origin). The
 * page's nonce'd island loads checkout.js ('strict-dynamic' then trusts
 * it; the script origin is only for browsers without 'strict-dynamic'),
 * which frames Razorpay's checkout, calls its API, sends telemetry and
 * shows its images. Razorpay publishes no CSP list: these are the hosts
 * Standard Checkout uses, checked against staging's violation reports
 * once its keys are set (HR-09, HR-27).
 */
function razorpayCheckoutSources(
  env: Record<string, string | undefined>
): CspSources[] {
  if (!env.RAZORPAY_KEY_ID) return [];
  return [
    {
      feature: "Razorpay Checkout",
      areas: ["signedIn"],
      routes: CHECKOUT_ROUTES,
      directives: {
        "script-src": ["https://checkout.razorpay.com"],
        "frame-src": ["https://api.razorpay.com"],
        "connect-src": [
          "https://api.razorpay.com",
          "https://lumberjack.razorpay.com",
        ],
        "img-src": ["https://cdn.razorpay.com"],
      },
    },
  ];
}

/** The origin of an https URL, or null for anything else. */
function httpsOrigin(value: string | undefined): string | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === "https:" ? url.origin : null;
}

/** The policy context for this process, from its environment. */
export function cspContext(
  env: Record<string, string | undefined> = process.env
): CspContext {
  return {
    appEnv: env.APP_ENV,
    nodeEnv: env.NODE_ENV,
    sources: [
      ...CSP_SOURCES,
      ...fileStorageSources(env),
      ...publicAssetSources(env),
      ...razorpayCheckoutSources(env),
    ],
  };
}
