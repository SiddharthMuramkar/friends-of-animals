// The published CMS documents, cached for the public pages (#111). Each
// document caches under its own tag; publishing returns the tags and its
// Server Action calls `updateTag` on each, so this server shows the new
// version on the next request.
//
// Call it after `await connection()`, inside <Suspense>: the build has no
// database. The page's fallback is the repo's copy, which is also what the
// seed publishes as version 1. A static shell may read it too (the home
// page's), but never in `next build` (isNextBuild()), so only when the
// server regenerates the page.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

import type { Actor } from "../../actor";
import { as } from "../../app";
import { cmsTag, type CmsDocumentKey } from "./domain/documents";
import type { LegalVersion } from "./legal";
import type { PublishedCmsDocument } from "./reading";

/**
 * Who reads a published document for everyone. A cached function can't
 * read the request, and the read is public and writes nothing, so it
 * needs no address or user agent.
 */
export const PUBLIC_READER: Actor = {
  kind: "visitor",
  meta: { ip: "", userAgent: "" },
};

/**
 * The published revision of `key`, sanitised, or null. With the default
 * in-memory cache handler each server instance keeps its own entry; the
 * "hours" profile bounds how long an instance that missed a publish's
 * updateTag can show the old version.
 */
export async function loadPublishedDocument(
  key: CmsDocumentKey
): Promise<PublishedCmsDocument | null> {
  "use cache";
  cacheTag(cmsTag(key));
  cacheLife("hours");
  return as(PUBLIC_READER).getPublishedDocument({ key });
}

/**
 * Whether this is `next build`. A static shell never reads published
 * documents then: the build has no runtime config and must pass with
 * `DATABASE_URL` unset, even when it happens to have database settings.
 * The server reads them when it regenerates the page (and `next dev` on
 * each request).
 *
 * Next sets NEXT_PHASE in the build's own process and reads it there the
 * same way; it never inlines it into the bundle, so the running server
 * sees its own environment, without it.
 */
export function isNextBuild(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
}

/**
 * The cache life of the shell `next build` leaves without the published
 * documents: revalidated after a second, so the server regenerates the
 * page with them on its first request after the build, rather than in 5
 * minutes. `stale` and `expire` keep the shell prerendered and in the App
 * Shell (see the cacheLife docs).
 */
export const BUILD_SHELL_LIFE = { stale: 300, revalidate: 1, expire: 3600 };

/**
 * The cache life of a shell whose read of the published documents failed:
 * like BUILD_SHELL_LIFE, but retried after 15 seconds, so a database
 * outage costs each server one read attempt and one logged error per 15
 * seconds, not one a second.
 */
export const FAILED_READ_SHELL_LIFE = {
  stale: 300,
  revalidate: 15,
  expire: 3600,
};

/**
 * The version and date a policy page shows now, or null before version 1:
 * the consent screens link to the page with it. Cached under the page's
 * tag, so a publish refreshes it with the page.
 */
export async function loadLegalVersion(
  key: CmsDocumentKey
): Promise<LegalVersion | null> {
  "use cache";
  cacheTag(cmsTag(key));
  cacheLife("hours");
  return as(PUBLIC_READER).currentLegalVersion({ key });
}
