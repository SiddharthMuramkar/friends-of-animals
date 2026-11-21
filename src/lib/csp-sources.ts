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

export const CSP_SOURCES: readonly CspSources[] = [];

/** The policy context for this process, from its environment. */
export function cspContext(
  env: Record<string, string | undefined> = process.env
): CspContext {
  return { appEnv: env.APP_ENV, nodeEnv: env.NODE_ENV, sources: CSP_SOURCES };
}
