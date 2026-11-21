// The current consent document, cached for the pages that show it: the
// legal pages, the sign-up form and the consent settings. Publishing a
// version calls `updateTag(consentDocumentTag(purpose))` from its Server
// Action, so this server shows the new version on the next request.
//
// Call it after `await connection()`, inside <Suspense>: the build has no
// database, so it must never run while prerendering.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import type { Actor } from "../../actor";
import { as } from "../../app";
import type { PublishedConsentDocument } from "./documents";
import type { ConsentPurpose } from "./domain/purposes";

/** The tag on a purpose's cached current document. */
export function consentDocumentTag(purpose: ConsentPurpose): string {
  return `consent-document:${purpose}`;
}

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
 * The latest published version of a purpose's document, or null. With
 * the default in-memory cache handler each server instance keeps its own
 * entry; the "hours" profile bounds how long an instance that missed a
 * publish's updateTag can show the old version.
 */
export async function cachedConsentDocument(
  purpose: ConsentPurpose
): Promise<PublishedConsentDocument | null> {
  "use cache";
  cacheTag(consentDocumentTag(purpose));
  cacheLife("hours");
  return as(PUBLIC_READER).currentConsentDocument({ purpose });
}
