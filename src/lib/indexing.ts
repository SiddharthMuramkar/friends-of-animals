/**
 * Whether search engines may index this deployment (#29). Shared by
 * next.config.ts and src/app/robots.ts, so keep it free of server-only and
 * framework imports. Both run at build time, so APP_ENV at `next build`
 * decides.
 */

import { appEnv, type EnvLike } from "./site";

/**
 * Only production may be indexed. Staging, previews, local runs and an
 * unknown APP_ENV stay out. Reads APP_ENV, never VERCEL_ENV, which can't tell
 * the staging custom environment from a preview.
 */
export function isIndexable(env: EnvLike = process.env): boolean {
  return appEnv(env) === "production";
}

type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

/**
 * next.config.ts `headers()`: X-Robots-Tag: noindex, nofollow on every
 * response outside production, pages and files alike; nothing in production.
 */
export function robotsHeaders(env: EnvLike = process.env): HeaderRule[] {
  if (isIndexable(env)) return [];
  return [
    {
      source: "/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    },
  ];
}
