// The published CMS documents, cached for the public pages (#111). Each
// document caches under its own tag; publishing returns the tags and its
// Server Action calls `updateTag` on each, so this server shows the new
// version on the next request.
//
// Call it after `await connection()`, inside <Suspense>: the build has no
// database. The page's fallback is the repo's copy, which is also what the
// seed publishes as version 1. A static shell may read it too (the home
// page's), but only after canReadWhilePrerendering().

import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { env } from "@/env";

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
 * Whether a static shell can read published documents. A build may have no
 * database settings, and a cached read that fails while prerendering fails
 * the build even when its caller catches it, so the shell asks first. With
 * settings but no database to reach, the build fails.
 */
export function canReadWhilePrerendering(): boolean {
  try {
    env();
    return true;
  } catch {
    return false;
  }
}

/**
 * A shell's stand-in for the published documents it couldn't read: none,
 * kept a minute, so the server regenerates the page with them soon after a
 * deploy (the build has no database) rather than in 5 minutes.
 */
export async function notReadWhilePrerendering(): Promise<null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 60, expire: 3600 });
  return null;
}

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
