// The published CMS documents, cached for the public pages (#111). Each
// document caches under its own tag; publishing returns the tags and its
// Server Action calls `updateTag` on each, so this server shows the new
// version on the next request.
//
// Call it after `await connection()`, inside <Suspense>: the build has no
// database, so it must never run while prerendering. The page's fallback
// is the repo's copy, which is also what the seed publishes as version 1.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import type { Actor } from "../../actor";
import { as } from "../../app";
import { cmsTag, type CmsDocumentKey } from "./domain/documents";
import type { PublishedCmsDocument } from "./reading";

/**
 * Who reads a published document for everyone. A cached function can't
 * read the request, and the read is public and writes nothing, so it
 * needs no address or user agent.
 */
const PUBLIC_READER: Actor = {
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
