/**
 * The origins each feature adds to the Content-Security-Policy. A feature
 * that loads from, posts to or frames another origin (error tracking, file
 * storage, checkout, analytics) appends one entry here; ./csp.ts checks
 * each source and merges it into the right directives.
 *
 * Keep this file free of Next.js, `@/` and server-only imports:
 * next.config.ts loads it under plain Node.
 */

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
    ],
  };
}
